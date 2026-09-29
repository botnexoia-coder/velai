// Diálogo del QR: qué logo se elige por defecto, que lo externo se explica en vez de
// fallar en silencio y que subir/quitar hablan con la ruta propia del tenant.
// (Que el QR con logo ESCANEA lo demuestra src/lib/qr.test.ts con un lector real.)
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from './Toasts';
import { QrReservas, fuentePorDefecto, type QrLogoInfo } from './QrReservas';

const TID = '11111111-1111-4111-8111-111111111111';
const PATH = `/api/admin/tenants/${TID}/booking/qr-logo`;
const URL_RESERVAS = 'https://citas.hirevai.com/dialogos/reservas';
const info = (over: Partial<QrLogoInfo> = {}): QrLogoInfo => ({ qr_logo_url: null, logo_url: null, max_bytes: 2 * 1024 * 1024, storage_ready: true, ...over });

function montar(respuestas: QrLogoInfo[], llamadas: { method: string; url: string }[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    llamadas.push({ method, url });
    if (url === PATH) return new Response(JSON.stringify(method === 'GET' ? respuestas[0] : respuestas[1] ?? respuestas[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    // Medios: 404 — en jsdom no hay canvas, así que la carga del logo no se prueba aquí.
    return new Response('', { status: 404 });
  }));
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider><QrReservas tenantId={TID} url={URL_RESERVAS} onClose={() => {}} /></ToastProvider>
    </QueryClientProvider>,
  );
  return llamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe('QR de reservas', () => {
  it('preferencia: el logo propio del QR > el del negocio > ninguno', () => {
    expect(fuentePorDefecto(info({ qr_logo_url: 'https://api.hirevai.com/media/qr/x?v=1', logo_url: 'https://api.hirevai.com/media/logos/x.png' }))).toBe('propio');
    expect(fuentePorDefecto(info({ logo_url: 'https://api.hirevai.com/media/logos/x.png' }))).toBe('negocio');
    expect(fuentePorDefecto(info())).toBe('ninguno');
    expect(fuentePorDefecto(undefined)).toBe('ninguno');
  });

  it('con logo del negocio alojado fuera de Velai lo dice y ofrece subir otro; el QR sigue descargable', async () => {
    montar([info({ logo_url: 'https://zoetravelspain.com/img/logo.png' })]);
    expect(await screen.findByRole('button', { name: 'Logo del negocio' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Logo del QR' })).toBeNull();
    expect(await screen.findByText(/alojado fuera de Velai/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Vista previa del código QR' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml/));
    expect(screen.getByRole('button', { name: 'Descargar SVG' })).toBeEnabled();
    expect(screen.getByText('Subir logo para el QR')).toBeInTheDocument();
  });

  it('subir manda los bytes a SU ruta y pasa a usar el logo del QR; quitar vuelve atrás', async () => {
    const propio = info({ qr_logo_url: 'https://api.hirevai.com/media/qr/' + TID + '?v=5' });
    const llamadas = montar([info(), propio]);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Sin logo' });
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Subir logo para el QR'), file);
    await waitFor(() => expect(llamadas.some((l) => l.method === 'POST' && l.url === PATH)).toBe(true));
    expect(await screen.findByRole('button', { name: 'Logo del QR' })).toHaveAttribute('aria-pressed', 'true');
    // El medio se pide por ruta RELATIVA (mismo origen que el panel, CSP connect-src 'self').
    await waitFor(() => expect(llamadas.some((l) => l.url === `/media/qr/${TID}?v=5`)).toBe(true));
    expect(await screen.findByText(/No se encontró la imagen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(llamadas.some((l) => l.method === 'DELETE' && l.url === PATH)).toBe(true));
  });

  it('rechaza en el navegador lo que el worker rechazaría (tipo y tamaño), sin subir nada', async () => {
    const llamadas = montar([info()]);
    const user = userEvent.setup({ applyAccept: false });
    await screen.findByRole('button', { name: 'Sin logo' });
    await user.upload(screen.getByLabelText('Subir logo para el QR'), new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText('Solo PNG, JPG o WebP.')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Subir logo para el QR'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }));
    expect(await screen.findByText('La imagen pesa más de 2 MB.')).toBeInTheDocument();
    expect(llamadas.filter((l) => l.method !== 'GET')).toEqual([]);
  });
});
