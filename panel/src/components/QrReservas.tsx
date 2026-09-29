// Diálogo «QR del enlace de reservas»: vista previa, logo del centro y descarga.
//
// De dónde sale el logo (en este orden de preferencia, y el cliente puede cambiarlo):
//  1. el que subió ESPECÍFICAMENTE para el QR (R2, clave fija por tenant — sin columna
//     en D1: lo que exista en qr/<tenant> es su elección);
//  2. el logo del negocio de la ficha (el mismo que la página de reservas);
//  3. sin logo — el QR de siempre, en nivel M.
// El QR se genera aquí (el worker solo guarda la imagen); los ficheros descargados son
// autocontenidos (el logo va embebido en el SVG como PNG en data URI).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { traducir } from '../api/errors';
import { useToast } from './Toasts';
import { LOGO_TIPOS, descargar, logoDesdeUrl, prepararLogo, qrCanvas, qrSvg, svgDataUri, type LogoListo } from '../lib/qr';

export type QrLogoInfo = { qr_logo_url: string | null; logo_url: string | null; max_bytes: number; storage_ready: boolean };
type Fuente = 'propio' | 'negocio' | 'ninguno';

const MOTIVO: Record<string, string> = {
  logo_externo: 'Ese logo está alojado fuera de Velai y el navegador no puede incrustarlo. Sube una imagen para el QR.',
  logo_no_encontrado: 'No se encontró la imagen del logo. Vuelve a subirla.',
  logo_tipo: 'Solo PNG, JPG o WebP.',
  logo_ilegible: 'No se pudo leer la imagen del logo.',
};

export function fuentePorDefecto(info: QrLogoInfo | undefined): Fuente {
  if (info?.qr_logo_url) return 'propio';
  if (info?.logo_url) return 'negocio';
  return 'ninguno';
}

export function QrReservas({ tenantId, url, onClose }: { tenantId: string; url: string; onClose: () => void }) {
  const path = `/api/admin/tenants/${tenantId}/booking/qr-logo`;
  const client = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const info = useQuery({ queryKey: ['qr-logo', tenantId], queryFn: () => api<QrLogoInfo>(path) });
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [logo, setLogo] = useState<LogoListo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // jsdom y navegadores viejos pueden no tener showModal: el atributo open basta.
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }, []);

  const elegida: Fuente = fuente ?? fuentePorDefecto(info.data);
  const origen = elegida === 'propio' ? info.data?.qr_logo_url ?? null : elegida === 'negocio' ? info.data?.logo_url ?? null : null;

  useEffect(() => {
    setAviso('');
    if (!origen) { setLogo(null); return; }
    const ctrl = new AbortController();
    setCargando(true);
    logoDesdeUrl(origen, ctrl.signal)
      .then((l) => { if (!ctrl.signal.aborted) setLogo(l); })
      .catch((e: Error) => { if (!ctrl.signal.aborted) { setLogo(null); setAviso(MOTIVO[e.message] ?? MOTIVO.logo_ilegible!); } })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [origen]);

  const svg = useMemo(() => qrSvg(url, logo?.dataUri ?? null), [url, logo]);
  const nombre = 'reservas-qr' + (logo ? '-logo' : '');

  async function subir(file: File | undefined) {
    if (!file) return;
    const max = info.data?.max_bytes ?? 2 * 1024 * 1024;
    if (!LOGO_TIPOS.includes(file.type)) { setAviso(MOTIVO.logo_tipo!); return; }
    if (file.size > max) { setAviso(traducir('image_too_large')); return; }
    setSubiendo(true);
    try {
      const d = await api<QrLogoInfo>(path, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      client.setQueryData(['qr-logo', tenantId], d);
      setFuente('propio');
      toast('Logo del QR guardado');
    } catch (e) { setAviso(`No se pudo subir: ${traducir(e)}`); }
    finally { setSubiendo(false); }
  }
  async function quitar() {
    setSubiendo(true);
    try {
      const d = await api<QrLogoInfo>(path, { method: 'DELETE' });
      client.setQueryData(['qr-logo', tenantId], d);
      setFuente(null);
      toast('Logo del QR quitado');
    } catch (e) { setAviso(`No se pudo quitar: ${traducir(e)}`); }
    finally { setSubiendo(false); }
  }
  function bajarPng() {
    const canvas = qrCanvas(url, logo?.img ?? null, 1200);
    canvas.toBlob((b) => { if (b) descargar(b, nombre + '.png'); else toast('No se pudo generar el PNG', false); }, 'image/png');
  }

  const opciones: [Fuente, string, boolean][] = [
    ['propio', 'Logo del QR', Boolean(info.data?.qr_logo_url)],
    ['negocio', 'Logo del negocio', Boolean(info.data?.logo_url)],
    ['ninguno', 'Sin logo', true],
  ];

  return (
    <dialog ref={ref} aria-label="Código QR de reservas" className="svcdlg qrdlg" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="modal-h"><strong>Código QR de reservas</strong><button className="btn alt" type="button" onClick={onClose}>Cerrar</button></div>
      <div className="modal-b qrbody">
        <div className="qrprev">
          {/* El QR se ve SIEMPRE sobre blanco, también en tema oscuro: es como se imprime. */}
          <img src={svgDataUri(svg)} alt={logo ? 'Vista previa del código QR con el logo en el centro' : 'Vista previa del código QR'} width={220} height={220} />
          <small className="muted">{cargando ? 'Cargando logo…' : logo ? 'Con logo · corrección de errores alta' : 'Sin logo'}</small>
        </div>
        <div className="qrside">
          <p className="muted qrurl">{url.replace(/^https:\/\//, '')}</p>
          {info.error ? <p className="flag" role="alert">No se pudo cargar el logo guardado. <button className="btn alt btnsm" type="button" onClick={() => void info.refetch()}>Reintentar</button></p> : null}
          <fieldset className="modes"><legend>Logo en el centro</legend>
            {opciones.filter(([, , ok]) => ok).map(([k, label]) => (
              <button key={k} type="button" className={`modebtn${elegida === k ? ' is-on' : ''}`} aria-pressed={elegida === k} disabled={info.isLoading} onClick={() => setFuente(k)}>{label}</button>
            ))}
          </fieldset>
          <div className="qrup mt12">
            <input type="file" id={`qrLogo-${tenantId}`} accept={LOGO_TIPOS.join(',')} className="filein" disabled={subiendo || info.data?.storage_ready === false}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void subir(f); }} />
            <label className="btn alt btnsm" htmlFor={`qrLogo-${tenantId}`} aria-disabled={subiendo || info.data?.storage_ready === false}>{subiendo ? 'Guardando…' : info.data?.qr_logo_url ? 'Cambiar logo del QR' : 'Subir logo para el QR'}</label>
            {info.data?.qr_logo_url ? <button className="btn alt btnsm" type="button" disabled={subiendo} onClick={() => void quitar()}>Quitar</button> : null}
          </div>
          <small className="muted mt6 qrhint">PNG, JPG o WebP de hasta 2 MB; mejor cuadrado y con fondo. Se queda guardado para la próxima vez.</small>
          {aviso ? <p className="flag mt6" role="status">{aviso}</p> : null}
          <div className="actions actions0 mt12">
            <button className="btn" type="button" disabled={cargando} onClick={() => descargar(new Blob([svg], { type: 'image/svg+xml' }), nombre + '.svg')}>Descargar SVG</button>
            <button className="btn alt" type="button" disabled={cargando} onClick={bajarPng}>Descargar PNG</button>
          </div>
          <small className="muted mt6 qrhint">SVG para imprenta (escala sin perder calidad); PNG para redes y documentos. Prueba a escanearlo antes de imprimir.</small>
        </div>
      </div>
    </dialog>
  );
}
