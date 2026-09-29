// QR con logo: que SIGA ESCANEANDO es la única propiedad que importa. jsdom no tiene
// canvas, así que el QR se rasteriza aquí a mano (mismo modelo que usan el SVG y el
// PNG) con el hueco del logo relleno del PEOR logo posible — ruido o negro total — y
// lo decodifica jsQR, un lector real.
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { HUECO_MAX, LOGO_MAX, MARGEN_QR, mediaMismoOrigen, qrModelo, qrSvg } from './qr';

const URLS = [
  'https://citas.hirevai.com/dialogos/reservas',
  'https://citas.hirevai.com/dialogos-que-ensenan-bcn/reservas?s=sesion-presencial-de-orientacion',
  'https://citas-staging.hirevai.com/un-negocio-con-un-slug-muy-largo-de-verdad/reservas?s=primera-consulta-gratuita-online',
];
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Rasteriza el modelo (px por módulo) y pinta el rectángulo del logo con `relleno`. */
function rasterizar(texto: string, conLogo: boolean, relleno: 'ruido' | 'negro', px = 6) {
  const m = qrModelo(texto, conLogo);
  const lado = (m.n + 2 * MARGEN_QR) * px;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  const pinta = (x: number, y: number, v: number) => { const i = (y * lado + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; };
  for (let f = 0; f < m.n; f++) for (let c = 0; c < m.n; c++) if (m.dark(f, c))
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) pinta((c + MARGEN_QR) * px + x, (f + MARGEN_QR) * px + y, 0);
  if (m.hueco) {
    // El logo va dentro del hueco con un módulo de margen blanco por lado.
    const a = (MARGEN_QR + m.hueco.desde + 1) * px, b = (MARGEN_QR + m.hueco.desde + m.hueco.lado - 1) * px;
    let semilla = 7;
    for (let y = a; y < b; y++) for (let x = a; x < b; x++) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      pinta(x, y, relleno === 'negro' ? 0 : (semilla >> 16) & 1 ? 0 : 255);
    }
  }
  return { m, data, lado };
}

describe('QR de reservas con logo', () => {
  it.each(URLS)('escanea con el peor logo posible en el centro: %s', (url) => {
    for (const relleno of ['ruido', 'negro'] as const) {
      const { m, data, lado } = rasterizar(url, true, relleno);
      expect(m.nivel).toBe('H');
      expect(m.hueco!.lado / m.n).toBeLessThanOrEqual(HUECO_MAX);
      // el logo en sí (hueco menos su margen) ≤ 22 % del lado
      expect((m.hueco!.lado - 2) / m.n).toBeLessThanOrEqual(LOGO_MAX);
      expect((m.hueco!.lado - 2) / m.n).toBeGreaterThan(0.15); // y no un sello diminuto
      expect(jsQR(data, lado, lado)?.data).toBe(url);
    }
  });

  it('escanea en todas las versiones que puede dar un enlace de reservas (25-200 caracteres)', () => {
    const versiones = new Set<number>();
    for (let len = 25; len <= 200; len += 5) {
      const url = ('https://citas.hirevai.com/' + 'x'.repeat(len)).slice(0, len);
      const { m, data, lado } = rasterizar(url, true, 'negro', 4);
      versiones.add(m.n);
      expect(jsQR(data, lado, lado)?.data, `longitud ${len}, ${m.n} módulos`).toBe(url);
    }
    expect(versiones.size).toBeGreaterThan(5);
  });

  it('sin logo sigue siendo el QR de siempre (nivel M, sin hueco) y escanea', () => {
    const { m, data, lado } = rasterizar(URLS[0]!, false, 'ruido');
    expect(m.nivel).toBe('M');
    expect(m.hueco).toBeNull();
    expect(jsQR(data, lado, lado)?.data).toBe(URLS[0]);
  });

  it('el hueco está centrado exacto en la rejilla y no deja módulos dentro', () => {
    const m = qrModelo(URLS[1]!, true);
    const h = m.hueco!;
    expect(h.lado % 2).toBe(1);
    expect(h.desde * 2 + h.lado).toBe(m.n);
    for (let f = h.desde; f < h.desde + h.lado; f++) for (let c = h.desde; c < h.desde + h.lado; c++) expect(m.dark(f, c)).toBe(false);
  });

  it('el SVG es autocontenido: el logo va embebido y nunca como URL externa', () => {
    const svg = qrSvg(URLS[0]!, PNG_1PX);
    expect(svg).toContain(`href="${PNG_1PX}"`);
    expect(svg).toContain(`xlink:href="${PNG_1PX}"`);
    expect(svg).not.toMatch(/href="https?:/);
    // Una URL en lugar de data URI no se embebe: sale el QR sin logo (nivel M).
    const conUrl = qrSvg(URLS[0]!, 'https://api.hirevai.com/media/logos/x.png');
    expect(conUrl).not.toContain('<image');
    expect(conUrl).toBe(qrSvg(URLS[0]!, null));
    // Y nada que no sea imagen raster se cuela en el atributo.
    expect(qrSvg(URLS[0]!, 'data:image/svg+xml;base64,PHN2Zz4=')).not.toContain('<image');
    expect(qrSvg(URLS[0]!, 'data:image/png;base64,AAA" onload="x')).not.toContain('<image');
  });
});

describe('mediaMismoOrigen', () => {
  it('convierte los medios del worker en ruta relativa (mismo origen que el panel)', () => {
    expect(mediaMismoOrigen('https://api.hirevai.com/media/qr/abc?v=1')).toBe('/media/qr/abc?v=1');
    expect(mediaMismoOrigen('https://vai-worker-staging.botnexo-ia.workers.dev/media/logos/t.png?v=2')).toBe('/media/logos/t.png?v=2');
    expect(mediaMismoOrigen('/media/logos/t.png')).toBe('/media/logos/t.png');
  });
  it('rechaza lo externo o lo que no es /media', () => {
    for (const u of ['https://zoetravelspain.com/img/logo.png', 'https://api.hirevai.com/api/admin/me', 'https://user:pw@api.hirevai.com/media/x.png', 'javascript:alert(1)', '', null]) expect(mediaMismoOrigen(u)).toBeNull();
  });
});
