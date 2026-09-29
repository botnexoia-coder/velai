// El diálogo de alta configurable: tres bloques (antelación, botones curados, vista
// previa), el radio por defecto, la preview que sigue a la pareja elegida y el envío
// explícito con las opciones — o el cierre sin tocar nada.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from './Toasts';
import { CrearPlantilla } from './CrearPlantilla';
import type { PlantillaKind } from '../api/types';

const KIND: PlantillaKind = {
  kind: 'recordatorio_cita',
  label: 'Recordatorio de cita (Confirmaciones)',
  fuente: 'registro',
  categoria: 'UTILITY',
  descripcion: 'Recuerda la cita.',
  config: {
    preview: 'Hola María, te escribimos de Clínica Ejemplo para recordarte tu cita del jueves, 4 de septiembre a las 10:00 (consulta). ¿Podrás venir?',
    antelaciones: [1, 2, 6, 8, 12, 24, 48],
    antelacionDefault: 24,
    botones: [
      { id: 'confirmo_cancelar', confirmar: 'Confirmo', cancelar: 'Cancelar' },
      { id: 'si_voy_no_puedo', confirmar: 'Sí, voy', cancelar: 'No puedo ir' },
      { id: 'asistire_no_asistire', confirmar: 'Asistiré', cancelar: 'No asistiré' },
    ],
    botonesDefault: 'confirmo_cancelar',
  },
};

describe('CrearPlantilla (diálogo de alta configurable)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderDialogo(onClose = () => {}) {
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, kind: 'recordatorio_cita', sid: 'HX1', status: 'pending' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <CrearPlantilla tenantId="t-1" tenantName="Clínica Alfa" kind={KIND} onClose={onClose} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    return posts;
  }

  it('los tres bloques, el default 24 h con su aclaración y el radio por defecto marcado', () => {
    renderDialogo();
    // 1. Antelación: select curado con default 24 y la aclaración honesta.
    const sel = screen.getByLabelText('Antelación del recordatorio') as HTMLSelectElement;
    expect(sel.value).toBe('24');
    expect(sel.options.length).toBe(7);
    expect(screen.getByText('Se puede cambiar después sin nueva aprobación.')).toBeInTheDocument();
    // 2. Botones: tarjetas-radio con la pareja por defecto marcada y la advertencia.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(3);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/exige crear una plantilla nueva y otra revisión de Meta/)).toBeInTheDocument();
    // 3. Vista previa: el cuerpo real con ejemplos y los botones por defecto pintados.
    expect(screen.getByText(/Hola María, te escribimos de Clínica Ejemplo/)).toBeInTheDocument();
    const prevBtns = document.querySelectorAll('.wapre-btns span');
    expect([...prevBtns].map((e) => e.textContent)).toEqual(['Confirmo', 'Cancelar']);
    // Pie: envío explícito.
    expect(screen.getByRole('button', { name: 'Enviar a aprobación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('cambiar la pareja actualiza la preview, y el envío manda las opciones elegidas', async () => {
    const user = userEvent.setup();
    const cerrado = vi.fn();
    const posts = renderDialogo(cerrado);
    await user.click(screen.getByRole('radio', { name: /Sí, voy/ }));
    expect([...document.querySelectorAll('.wapre-btns span')].map((e) => e.textContent)).toEqual(['Sí, voy', 'No puedo ir']);
    const sel = screen.getByLabelText('Antelación del recordatorio');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)[0]).toBe('1 h antes de la cita');
    await user.selectOptions(sel, '1');
    await user.click(screen.getByRole('button', { name: 'Enviar a aprobación' }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]!.url).toContain('/api/admin/tenants/t-1/provision/plantillas/recordatorio_cita');
    expect(posts[0]!.body).toEqual({ botones: 'si_voy_no_puedo', antelacion: 1 });
    await waitFor(() => expect(cerrado).toHaveBeenCalled());
  });

  it('Cancelar cierra sin enviar nada', async () => {
    const user = userEvent.setup();
    const cerrado = vi.fn();
    const posts = renderDialogo(cerrado);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(posts.length).toBe(0);
    await waitFor(() => expect(cerrado).toHaveBeenCalled());
  });

  it('confirmación de reserva: el texto se edita con variables y el envío lo manda, sin antelación', async () => {
    const user = userEvent.setup();
    const KIND_CONF: PlantillaKind = {
      kind: 'confirmacion_reserva',
      label: 'Confirmación de reserva online',
      fuente: 'registro',
      categoria: 'UTILITY',
      descripcion: 'Datos de la reserva.',
      config: {
        preview: 'Hola María, tu cita con Clínica Ejemplo está reservada.',
        texto: {
          defecto: 'Hola {{nombre}}, tu cita es el {{fecha}} a las {{hora}}. Gestiónala aquí: {{enlace}} ¡Te esperamos!',
          max: 1024,
          campos: [
            { clave: 'nombre', label: 'Nombre', obligatoria: false, ejemplo: 'María' },
            { clave: 'fecha', label: 'Fecha', obligatoria: true, ejemplo: 'jueves, 4 de septiembre' },
            { clave: 'hora', label: 'Hora', obligatoria: true, ejemplo: '10:00' },
            { clave: 'enlace', label: 'Enlace', obligatoria: true, ejemplo: 'https://citas.hirevai.com/x' },
          ],
        },
      },
    };
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.validar) {
        const ok = String(body.texto).includes('{{enlace}}');
        return Response.json({ ok, errores: ok ? [] : [{ code: 'texto_falta_variable', clave: 'enlace' }], preview: '', longitud: 60 });
      }
      posts.push({ url, body });
      return new Response(JSON.stringify({ ok: true, kind: 'confirmacion_reserva', sid: 'HX1', status: 'pending' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <CrearPlantilla tenantId="t-1" tenantName="Clínica Alfa" kind={KIND_CONF} onClose={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const area = screen.getByLabelText('Texto de Confirmación de reserva online') as HTMLTextAreaElement;
    expect(screen.queryByLabelText('Antelación del recordatorio')).toBeNull();
    // Sin el enlace obligatorio el envío queda bloqueado.
    await user.clear(area);
    await user.type(area, 'Hola, tu cita del {{{{}fecha}} a las {{{{}hora}} está lista, gracias');
    const enviar = screen.getByRole('button', { name: 'Enviar a aprobación' });
    await waitFor(() => expect(enviar).toBeDisabled());
    // El chip inserta la variable y la vista previa usa el ejemplo.
    await user.click(screen.getByRole('button', { name: /\{\{enlace\}\}/ }));
    await waitFor(() => expect(enviar).toBeEnabled());
    expect(document.querySelector('.wapre-body')?.textContent).toContain('https://citas.hirevai.com/x');
    await user.click(enviar);
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]!.url).toContain('/provision/plantillas/confirmacion_reserva');
    expect(posts[0]!.body).toEqual({ texto: area.value });
    expect(String(posts[0]!.body.texto)).toContain('{{enlace}}');
  });
});
