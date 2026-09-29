// QR del enlace de reservas, con el logo del cliente en el centro.
//
// Por qué así:
//  · Con logo, corrección de errores 'H' (recupera ~30 % de módulos): el recuadro del
//    centro tapa ≈ 7-8 % del código, muy por debajo. Sin logo sigue en 'M' (el QR de
//    siempre, más pequeño y fácil de leer a distancia).
//  · El recuadro va ALINEADO a la rejilla de módulos y con un número impar de ellos, así
//    queda centrado exacto y no deja medios módulos asomando por los bordes. Los módulos
//    que caen dentro no se pintan (fondo blanco = margen blanco detrás del logo).
//  · El logo ocupa como mucho el 22 % del lado del código (recuadro ≈ 27 %: logo + un
//    módulo de margen blanco por lado).
//  · El SVG descargado es AUTOCONTENIDO: la imagen va embebida como data URI PNG (nunca
//    una URL externa, que una imprenta o Illustrator no podrían resolver). El PNG se
//    pinta directo en canvas con la misma geometría — no depende de rasterizar el SVG.
import qrcode from 'qrcode-generator';

export type QrModelo = {
  /** Módulos por lado (sin zona de silencio). */
  n: number;
  nivel: 'M' | 'H';
  dark: (fila: number, col: number) => boolean;
  /** Recuadro blanco del centro, en módulos (null sin logo). */
  hueco: { desde: number; lado: number } | null;
};

/** Zona de silencio: 4 módulos por lado, lo que pide la norma. */
export const MARGEN_QR = 4;
/** Fracción máxima del lado del código que ocupa el logo (sin su margen blanco). */
export const LOGO_MAX = 0.22;
/** …y el recuadro blanco entero (logo + margen): ≈ 7-8 % del área, con H sobra. */
export const HUECO_MAX = 0.3;

export function qrModelo(texto: string, conLogo: boolean): QrModelo {
  const nivel = conLogo ? 'H' : 'M';
  const code = qrcode(0, nivel);
  code.addData(texto);
  code.make();
  const n = code.getModuleCount();
  let hueco: QrModelo['hueco'] = null;
  if (conLogo) {
    // El mayor recuadro cuyo LOGO (recuadro menos un módulo de margen por lado) no pase
    // del 22 % del lado. Impar (n siempre lo es: 21 + 4·v) para centrarlo exacto; ≥ 5
    // para que el logo tenga al menos 3 módulos de ancho.
    let lado = Math.floor(n * LOGO_MAX + 2);
    if (lado % 2 === 0) lado -= 1;
    lado = Math.max(5, lado);
    hueco = { desde: (n - lado) / 2, lado };
  }
  const dentro = (f: number, c: number) => Boolean(hueco && f >= hueco.desde && f < hueco.desde + hueco.lado && c >= hueco.desde && c < hueco.desde + hueco.lado);
  return { n, nivel, hueco, dark: (f, c) => !dentro(f, c) && code.isDark(f, c) };
}

/** Rectángulo del logo (en unidades de celda, con la zona de silencio incluida). */
function rectLogo(m: QrModelo, celda: number) {
  if (!m.hueco) return null;
  const pad = 1; // un módulo de blanco alrededor del logo
  const x = (MARGEN_QR + m.hueco.desde + pad) * celda;
  const lado = (m.hueco.lado - 2 * pad) * celda;
  return { x, y: x, lado };
}

/**
 * SVG autocontenido. `logo` es un data URI (image/png, image/jpeg o image/webp); una
 * URL http(s) se ignora a propósito: el fichero descargado no puede depender de nada.
 */
export function qrSvg(texto: string, logo?: string | null, celda = 10): string {
  const embebido = typeof logo === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) ? logo : null;
  const m = qrModelo(texto, Boolean(embebido));
  const lado = (m.n + 2 * MARGEN_QR) * celda;
  let d = '';
  for (let f = 0; f < m.n; f++) {
    for (let c = 0; c < m.n; c++) {
      if (m.dark(f, c)) d += `M${(c + MARGEN_QR) * celda} ${(f + MARGEN_QR) * celda}h${celda}v${celda}h-${celda}z`;
    }
  }
  const r = embebido ? rectLogo(m, celda) : null;
  const img = r && embebido
    ? `<image x="${r.x}" y="${r.y}" width="${r.lado}" height="${r.lado}" preserveAspectRatio="xMidYMid meet" href="${embebido}" xlink:href="${embebido}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">`
    + `<rect width="${lado}" height="${lado}" fill="#ffffff"/>`
    + `<path d="${d}" fill="#000000" shape-rendering="crispEdges"/>${img}</svg>`;
}

export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Pinta el QR en un canvas de ~`px` de lado (múltiplo exacto de módulos: bordes nítidos). */
export function qrCanvas(texto: string, logo: HTMLImageElement | null, px = 1200): HTMLCanvasElement {
  const m = qrModelo(texto, Boolean(logo));
  const total = m.n + 2 * MARGEN_QR;
  const celda = Math.max(4, Math.floor(px / total));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = total * celda;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_no_disponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let f = 0; f < m.n; f++) for (let c = 0; c < m.n; c++) if (m.dark(f, c)) ctx.fillRect((c + MARGEN_QR) * celda, (f + MARGEN_QR) * celda, celda, celda);
  const r = logo ? rectLogo(m, celda) : null;
  if (r && logo) {
    // «meet»: el logo entero, centrado, sin deformarlo.
    const k = Math.min(r.lado / logo.naturalWidth, r.lado / logo.naturalHeight);
    const w = logo.naturalWidth * k, h = logo.naturalHeight * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, r.x + (r.lado - w) / 2, r.y + (r.lado - h) / 2, w, h);
  }
  return canvas;
}

// ── Carga del logo ────────────────────────────────────────────────────────────
// Los logos viven en /media del worker. El panel se sirve desde OTRO host
// (admin.hirevai.com) con CSP connect-src 'self', pero el worker atiende /media en
// todos sus hosts: se pide por ruta relativa, mismo origen, sin CORS.
const ORIGENES_MEDIA = new Set(['https://api.hirevai.com', 'https://vai-worker-staging.botnexo-ia.workers.dev', 'https://vai-worker.botnexo-ia.workers.dev']);

/** Ruta relativa /media/... si la URL es un medio del worker; null si es externa. */
export function mediaMismoOrigen(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'https://panel.invalid');
    const propio = u.origin === 'https://panel.invalid' || ORIGENES_MEDIA.has(u.origin);
    if (!propio || u.username || u.password || !/^\/media\/[a-z0-9][a-z0-9/_.-]{0,120}$/i.test(u.pathname) || u.pathname.includes('..')) return null;
    return u.pathname + u.search;
  } catch { return null; }
}

export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
/** Lado máximo del logo embebido: de sobra para imprimir el QR a 10 cm. */
const LOGO_PX = 512;

function leerDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('logo_ilegible'));
    r.readAsDataURL(blob);
  });
}
function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('logo_ilegible')));
    img.onerror = () => reject(new Error('logo_ilegible'));
    img.src = src;
  });
}

export type LogoListo = { img: HTMLImageElement; dataUri: string };

/**
 * Normaliza cualquier imagen admitida a PNG ≤ 512 px: el SVG embebe siempre PNG (WebP
 * dentro de un SVG no lo abre todo el software de maquetación) y se quitan metadatos.
 * Se lee con FileReader → data: (la CSP del panel admite data: en img-src, no blob:).
 */
export async function prepararLogo(blob: Blob): Promise<LogoListo> {
  if (!LOGO_TIPOS.includes(blob.type)) throw new Error('logo_tipo');
  const original = await cargarImagen(await leerDataUri(blob));
  const k = Math.min(1, LOGO_PX / Math.max(original.naturalWidth, original.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(original.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(original.naturalHeight * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('logo_ilegible');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
  const dataUri = canvas.toDataURL('image/png');
  return { img: await cargarImagen(dataUri), dataUri };
}

/** Descarga un medio del worker (mismo origen) y lo prepara. Externo = error explícito. */
export async function logoDesdeUrl(url: string, signal?: AbortSignal): Promise<LogoListo> {
  const rel = mediaMismoOrigen(url);
  if (!rel) throw new Error('logo_externo');
  const res = await fetch(rel, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error('logo_no_encontrado');
  return prepararLogo(await res.blob());
}

export function descargar(blob: Blob, nombre: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
