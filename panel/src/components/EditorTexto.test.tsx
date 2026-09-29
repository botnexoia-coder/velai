// Editor del texto de las plantillas de citas (SPEC-NOTIFICACION-CITA): chips que
// insertan variables con nombre, vista previa inmediata, validación DEL WORKER mientras
// se escribe, envío con confirmación y bloqueo mientras WhatsApp revisa.
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ConfirmarHost } from './Confirmar';
import { ToastProvider } from './Toasts';
import { EditorTexto } from './EditorTexto';
import { insertarVariable, mensajeTexto, renderTextoLocal, variablesUsadas } from '../lib/plantillas';
import type { PlantillaCelda, PlantillaKind } from '../api/types';

const CAMPOS = [
  { clave: 'nombre', label: 'Nombre del cliente', obligatoria: false, ejemplo: 'María' },
  { clave: 'negocio', label: 'Tu negocio', obligatoria: false, ejemplo: 'Clínica Ejemplo' },
  { clave: 'fecha', label: 'Fecha', obligatoria: true, ejemplo: 'jueves, 4 de septiembre' },
  { clave: 'hora', label: 'Hora', obligatoria: true, ejemplo: '10:00' },
  { clave: 'enlace', label: 'Enlace para gestionar la cita', obligatoria: true, ejemplo: 'https://citas.hirevai.com/x' },
];
const DEFECTO = 'Hola {{nombre}}, tu cita con {{negocio}} es el {{fecha}} a las {{hora}}. Gestiónala: {{enlace}} ¡Gracias!';
const KIND: PlantillaKind = {
  kind: 'confirmacion_reserva', label: 'Cita agendada (confirmación)', fuente: 'registro', categoria: 'UTILITY',
  config: { preview: null, texto: { defecto: DEFECTO, max: 1024, campos: CAMPOS } },
};
const TID = '11111111-1111-4111-8111-111111111111';

describe('lib del texto editable', () => {
  it('pinta la preview, inserta en el cursor y pone los errores en palabras', () => {
    expect(renderTextoLocal('Hola {{nombre}} de {{negocio}} {{raro}}', CAMPOS, 'Barbería López')).toBe('Hola María de Barbería López {{raro}}');
    expect(insertarVariable('Hola,te espero', 5, 5, 'nombre')).toEqual({ texto: 'Hola, {{nombre}} te espero', cursor: 16 });
    expect(insertarVariable('Hola ', 5, 5, 'fecha').texto).toBe('Hola {{fecha}}');
    expect(variablesUsadas('a {{fecha}} b {{hora}}')).toEqual(['fecha', 'hora']);
    expect(mensajeTexto({ code: 'falta_variable', clave: 'enlace' }, CAMPOS)).toBe('Falta {{enlace}} (enlace para gestionar la cita): es obligatoria.');
    expect(mensajeTexto({ code: 'termina_con_variable' }, CAMPOS)).toMatch(/no admite que el mensaje termine/);
  });
});

describe('EditorTexto', () => {
  afterEach(() => vi.unstubAllGlobals());

  function montar(celda: PlantillaCelda | undefined, responder?: (body: { texto: string; validar?: boolean }) => unknown) {
    const posts: { url: string; body: { texto: string; validar?: boolean } }[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = JSON.parse(String(init?.body ?? '{}'));
      posts.push({ url, body });
      const out = responder?.(body) ?? (body.validar
        ? { ok: true, errores: [], preview: 'x', longitud: body.texto.length }
        : { ok: true, kind: 'confirmacion_reserva', status: 'pending', modo: 'revision' });
      return new Response(JSON.stringify(out), { status: body.validar ? 200 : 201, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditorTexto tenantId={TID} kind={KIND} celda={celda} negocio="Barbería López" />
          <ConfirmarHost />
        </ToastProvider>
      </QueryClientProvider>,
    );
    return posts;
  }

  it('enseña el texto vigente del cliente y, al editar, valida en el worker y envía lo escrito', async () => {
    const user = userEvent.setup();
    const propio = 'Te esperamos el {{fecha}} a las {{hora}}. Si no puedes venir: {{enlace}} Un saludo.';
    const posts = montar({ status: 'approved', updated_at: null, texto: propio, revision: null });
    expect(screen.getByText(/Te esperamos el jueves, 4 de septiembre a las 10:00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar el texto' }));
    const area = screen.getByLabelText(/Texto de Cita agendada/) as HTMLTextAreaElement;
    expect(area.value).toBe(propio);
    // Mismo texto que el vigente: no hay nada que enviar.
    await waitFor(() => expect(screen.getByText('Es el texto que ya tienes.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeDisabled();
    // Inserta {{nombre}} al principio con su chip (el cursor manda).
    area.setSelectionRange(0, 0);
    fireEvent.change(area, { target: { value: 'Hola, ' + propio } });
    area.setSelectionRange(5, 5);
    await user.click(screen.getByRole('button', { name: '{{nombre}}' }));
    expect(area.value).toBe('Hola, {{nombre}} ' + propio);
    expect(screen.getByText(/Hola, María Te esperamos/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cumple las reglas de WhatsApp ✓')).toBeInTheDocument());
    const validaciones = posts.filter((p) => p.body.validar);
    expect(validaciones.at(-1)!.url).toBe(`/api/admin/tenants/${TID}/plantillas/confirmacion_reserva`);
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }));
    await waitFor(() => expect(document.querySelector('dialog.cfm')).not.toBeNull());
    expect(screen.getByText(/se sigue enviando el texto aprobado/)).toBeInTheDocument();
    await user.click(within(document.querySelector('dialog.cfm') as HTMLElement).getByRole('button', { name: 'Enviar a revisión' }));
    await waitFor(() => expect(posts.some((p) => !p.body.validar)).toBe(true));
    expect(posts.find((p) => !p.body.validar)!.body).toEqual({ texto: 'Hola, {{nombre}} ' + propio });
  });

  it('los errores del worker se ven con la variable concreta y bloquean el envío', async () => {
    const user = userEvent.setup();
    montar({ status: 'approved', updated_at: null, texto: null, revision: null }, (b) =>
      b.validar ? { ok: false, errores: [{ code: 'falta_variable', clave: 'enlace' }, { code: 'termina_con_variable' }], preview: '', longitud: 50 } : null,
    );
    await user.click(screen.getByRole('button', { name: 'Editar el texto' }));
    const area = screen.getByLabelText(/Texto de Cita agendada/) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Hola, tu cita es el {{fecha}} a las {{hora}}' } });
    await waitFor(() => expect(screen.getByText('Falta {{enlace}} (enlace para gestionar la cita): es obligatoria.')).toBeInTheDocument());
    expect(area).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeDisabled();
    // «Texto por defecto» restaura el del catálogo.
    await user.click(screen.getByRole('button', { name: 'Texto por defecto' }));
    expect(area.value).toBe(DEFECTO);
  });

  it('sin plantilla, el cliente puede crearla con su texto', async () => {
    const user = userEvent.setup();
    montar(undefined);
    await user.click(screen.getByRole('button', { name: 'Personalizar y crear' }));
    await waitFor(() => expect(screen.getByText('Cumple las reglas de WhatsApp ✓')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Crear y enviar a WhatsApp' })).toBeEnabled();
  });

  it('con una revisión pendiente no se edita y se enseña el texto que revisa WhatsApp', async () => {
    const pendiente = 'Tu cita del {{fecha}} a las {{hora}} ya está. Cámbiala aquí: {{enlace}} Gracias.';
    montar({ status: 'approved', updated_at: null, texto: null, revision: { status: 'pending', texto: pendiente, motivo: null, at: null } });
    expect(screen.getByText('Texto nuevo en revisión por WhatsApp')).toBeInTheDocument();
    expect(screen.getByText(/Tu cita del jueves, 4 de septiembre/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar el texto' })).toBeDisabled();
  });

  it('un rechazo de WhatsApp enseña el motivo y deja corregir desde el texto rechazado', async () => {
    const user = userEvent.setup();
    const rechazado = 'Tu cita del {{fecha}} a las {{hora}}: {{enlace}} ok.';
    montar({ status: 'approved', updated_at: null, texto: null, revision: { status: 'rejected', texto: rechazado, motivo: 'INVALID_FORMAT', at: null } });
    expect(screen.getByText(/WhatsApp rechazó el último texto \(«INVALID_FORMAT»\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar el texto' }));
    expect((screen.getByLabelText(/Texto de Cita agendada/) as HTMLTextAreaElement).value).toBe(rechazado);
  });
});
