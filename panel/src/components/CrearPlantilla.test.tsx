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
    antelaciones: [12, 24, 48],
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
    expect(sel.options.length).toBe(3);
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
    await user.selectOptions(screen.getByLabelText('Antelación del recordatorio'), '12');
    await user.click(screen.getByRole('button', { name: 'Enviar a aprobación' }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]!.url).toContain('/api/admin/tenants/t-1/provision/plantillas/recordatorio_cita');
    expect(posts[0]!.body).toEqual({ botones: 'si_voy_no_puedo', antelacion: 12 });
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
});
