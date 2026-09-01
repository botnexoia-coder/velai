// Sustituye a window.confirm / window.prompt en TODO el panel (pedido de Juan: nada de
// diálogos comunes del navegador — todo con nuestra marca). Además de la estética, los
// nativos tienen problemas reales: bloquean el hilo, no se pueden traducir sus botones,
// Chrome los suprime dentro de iframes y tras ciertos gestos, y no distinguen una acción
// destructiva de una normal.
//
// Patrón TipHost: UN solo <dialog> para toda la app y una API imperativa de módulo, sin
// contexto — así se llama desde cualquier handler (incluidos helpers como confirmDiscard)
// con un import, y el diff sobre los 15 sitios que usaban el nativo es mínimo.
//
//   if (!(await confirmar({ titulo: '¿Borrar este lead?', peligro: true }))) return;
//   const texto = await pedirTexto({ titulo: 'Descripción del tema' }); // null = canceló
//
// Si el host no está montado (tests de vistas que no lo montan, o un fallo de arranque),
// se cae al diálogo nativo: feo pero NUNCA silencioso — resolver false a ciegas dejaría
// botones que "no hacen nada", que es peor que un confirm sin marca.
import { useEffect, useRef, useState } from 'react';

export interface ConfirmarOpts {
  titulo: string;
  cuerpo?: string;
  accion?: string;    // etiqueta del botón que ejecuta (por defecto «Continuar»)
  cancelar?: string;  // etiqueta del botón que no (por defecto «Cancelar»)
  peligro?: boolean;  // acción destructiva: botón rojo y el foco arranca en Cancelar
}

export interface PedirTextoOpts {
  titulo: string;
  cuerpo?: string;
  placeholder?: string;
  accion?: string;
  inicial?: string;
}

type Peticion =
  | { id: number; tipo: 'confirmar'; opts: ConfirmarOpts; resolve: (v: boolean) => void }
  | { id: number; tipo: 'texto'; opts: PedirTextoOpts; resolve: (v: string | null) => void };

let abrir: ((p: Peticion) => void) | null = null;
let siguienteId = 1;

export function confirmar(opts: ConfirmarOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!abrir) return resolve(window.confirm(opts.cuerpo ? `${opts.titulo}\n\n${opts.cuerpo}` : opts.titulo));
    abrir({ id: siguienteId++, tipo: 'confirmar', opts, resolve });
  });
}

export function pedirTexto(opts: PedirTextoOpts): Promise<string | null> {
  return new Promise((resolve) => {
    if (!abrir) return resolve(window.prompt(opts.titulo, opts.inicial ?? ''));
    abrir({ id: siguienteId++, tipo: 'texto', opts, resolve });
  });
}

export function ConfirmarHost() {
  // Cola, no valor único: dos confirmaciones seguidas (raro pero posible con toasts de
  // error de por medio) no pueden pisarse la promesa una a la otra.
  const [cola, setCola] = useState<Peticion[]>([]);
  // El campo de pedirTexto es NO CONTROLADO (defaultValue + key por petición + ref):
  // la versión controlada lo pre-rellenaba en un useEffect y existía un frame con el
  // input vacío — en el runner lento de CI, los tests llegaban justo a ese frame
  // (flaky real, run 33490470320). Sin estado no hay frame intermedio que cazar.
  const inputRef = useRef<HTMLInputElement>(null);
  const dlgRef = useRef<HTMLDialogElement>(null);
  const actual = cola[0];

  useEffect(() => {
    abrir = (p) => setCola((c) => [...c, p]);
    return () => { abrir = null; };
  }, []);

  useEffect(() => {
    const d = dlgRef.current;
    if (!actual || !d || d.open) return;
    // jsdom y navegadores viejos pueden no tener showModal: el atributo open pierde el
    // backdrop pero el diálogo funciona.
    try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }, [actual]);

  if (!actual) return null;

  const resolver = (positivo: boolean) => {
    if (actual.tipo === 'confirmar') actual.resolve(positivo);
    else actual.resolve(positivo ? (inputRef.current?.value ?? '').trim() : null);
    try { dlgRef.current?.close(); } catch { dlgRef.current?.removeAttribute('open'); }
    setCola((c) => c.slice(1));
  };

  const peligro = actual.tipo === 'confirmar' && actual.opts.peligro === true;
  const accion = actual.opts.accion ?? 'Continuar';
  const cancelarTxt = (actual.tipo === 'confirmar' && actual.opts.cancelar) || 'Cancelar';

  return (
    <dialog
      ref={dlgRef}
      className="cfm"
      aria-label={actual.opts.titulo}
      // Escape dispara 'cancel': se resuelve como NO y se cierra por nuestro camino, para
      // que la promesa jamás quede colgada.
      onCancel={(e) => { e.preventDefault(); resolver(false); }}
    >
      <form
        method="dialog"
        onSubmit={(e) => { e.preventDefault(); resolver(true); }}
      >
        <b className="cfm-titulo">{actual.opts.titulo}</b>
        {actual.opts.cuerpo ? <p className="cfm-cuerpo">{actual.opts.cuerpo}</p> : null}
        {actual.tipo === 'texto' ? (
          <input
            key={actual.id}
            ref={inputRef}
            className="cfm-input"
            defaultValue={actual.opts.inicial ?? ''}
            placeholder={actual.opts.placeholder ?? ''}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- es un diálogo modal de un solo campo
            autoFocus
          />
        ) : null}
        <div className="cfm-acciones">
          {/* En una acción destructiva el foco arranca en Cancelar: Enter por inercia no
              puede borrar nada. En las normales, en la acción — un solo Enter y sigues. */}
          <button type="button" className="btn alt" autoFocus={peligro} onClick={() => resolver(false)}>
            {cancelarTxt}
          </button>
          <button type="submit" className={peligro ? 'btn bad' : 'btn'} autoFocus={!peligro && actual.tipo !== 'texto'}>
            {accion}
          </button>
        </div>
      </form>
    </dialog>
  );
}
