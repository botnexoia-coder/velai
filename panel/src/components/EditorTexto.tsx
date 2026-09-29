// Editor del TEXTO de una plantilla de citas (SPEC-NOTIFICACION-CITA): el cliente
// reescribe el mensaje a su gusto, pero las variables van con NOMBRE y se insertan con
// chips ({{nombre}}, {{fecha}}…) — el worker las traduce a {{1}}..{{n}} al crear la
// plantilla en Twilio. Las REGLAS (obligatorias, reglas de Meta, longitud) viven solo
// en el worker: el editor le pregunta con validar:true mientras se escribe, así no hay
// dos copias que puedan discrepar. Aquí solo hay presentación.
//
// Guardar = plantilla nueva + revisión de WhatsApp. Si ya hay una aprobada, se sigue
// enviando esa hasta que la nueva se apruebe (lo dice el propio diálogo).
import { useEffect, useRef, useState } from 'react';
import { traducir } from '../api/errors';
import { confirmar } from './Confirmar';
import { useToast } from './Toasts';
import { usePlantillaTextoGuardar, usePlantillaTextoValidar } from '../hooks/queries';
import { insertarVariable, mensajeTexto, renderTextoLocal, variablesUsadas } from '../lib/plantillas';
import type { PlantillaCelda, PlantillaKind, TextoValidado } from '../api/types';

export function EditorTexto({
  tenantId,
  kind,
  celda,
  botones,
  quien = 'tu cliente',
  negocio,
}: {
  tenantId: string;
  kind: PlantillaKind;
  celda: PlantillaCelda | undefined;
  /** Textos de los botones vigentes (solo el recordatorio): se pintan en la preview. */
  botones?: { confirmar: string; cancelar: string } | null;
  /** A quién le llega, para el rótulo de la vista previa. */
  quien?: string;
  /** Nombre real del negocio para la vista previa de {{negocio}}. */
  negocio?: string;
}) {
  const cfg = kind.config?.texto;
  const toast = useToast();
  const validar = usePlantillaTextoValidar();
  const guardar = usePlantillaTextoGuardar();
  const ref = useRef<HTMLTextAreaElement>(null);
  const vigente = celda?.texto ?? cfg?.defecto ?? '';
  const revision = celda?.revision ?? null;
  const enRevision = revision?.status === 'pending' || (Boolean(celda?.status) && celda?.status !== 'approved' && celda?.status !== 'rejected');
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState(vigente);
  const [check, setCheck] = useState<(TextoValidado & { de: string }) | null>(null);
  useEffect(() => setBorrador(revision?.status === 'rejected' && revision.texto ? revision.texto : vigente), [vigente, revision?.status, revision?.texto]);

  // Validación en el worker, con respiro de 400 ms entre pulsaciones.
  const { mutate: validarMutate } = validar;
  useEffect(() => {
    if (!abierto || !cfg) return;
    const texto = borrador;
    const t = setTimeout(() => {
      validarMutate({ id: tenantId, kind: kind.kind, texto }, { onSuccess: (r) => setCheck({ ...r, de: texto }) });
    }, 400);
    return () => clearTimeout(t);
  }, [abierto, borrador, cfg, kind.kind, tenantId, validarMutate]);

  if (!cfg) return null;
  const actual = check && check.de === borrador ? check : null;
  const usadas = variablesUsadas(borrador);
  const cambiado = borrador.trim() !== vigente.trim();
  const crear = !celda?.status;
  const puedeEnviar = Boolean(actual?.ok) && (cambiado || crear) && !enRevision && !guardar.isPending;
  // Lo que enseña la preview: con el editor abierto, el borrador; si hay una revisión
  // pendiente, el texto que está revisando WhatsApp; si no, el vigente.
  const mostrado = abierto ? borrador : revision?.status === 'pending' && revision.texto ? revision.texto : vigente;

  function insertar(clave: string) {
    const el = ref.current;
    const inicio = el?.selectionStart ?? borrador.length;
    const fin = el?.selectionEnd ?? borrador.length;
    const r = insertarVariable(borrador, inicio, fin, clave);
    setBorrador(r.texto);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(r.cursor, r.cursor);
    });
  }

  async function enviar() {
    if (
      !(await confirmar({
        titulo: crear ? '¿Crear la plantilla y enviarla a WhatsApp?' : '¿Enviar el texto nuevo a revisión?',
        cuerpo: crear
          ? 'WhatsApp revisa cada plantilla antes de poder usarla; suele tardar de minutos a unas horas. Te avisamos aquí del resultado.'
          : 'Se crea una versión nueva y WhatsApp la revisa (de minutos a unas horas). Mientras tanto se sigue enviando el texto aprobado.',
        accion: 'Enviar a revisión',
      }))
    )
      return;
    guardar.mutate(
      { id: tenantId, kind: kind.kind, texto: borrador },
      {
        onSuccess: () => {
          toast('Texto enviado a revisión de WhatsApp ✓');
          setAbierto(false);
        },
        onError: (e) => {
          // Sin WhatsApp aprovisionado no hay dónde crear la plantilla: el mensaje del
          // paso de aprovisionamiento («crea la subcuenta») es de Velai, no del cliente.
          const code = e instanceof Error ? e.message : '';
          const sinWhatsApp = code === 'subaccount_required' || code === 'twilio_auth_token_missing';
          toast(sinWhatsApp ? 'Tu WhatsApp aún no está conectado a Velai: escríbenos y lo dejamos listo.' : `No se pudo enviar: ${traducir(e)}`, false);
        },
      },
    );
  }

  return (
    <div className="tx">
      <p className="muted mt6">Así le llega a {quien}:</p>
      <div className="wapre">
        <div className="wapre-body">{renderTextoLocal(mostrado, cfg.campos, negocio)}</div>
        {botones ? (
          <div className="wapre-btns">
            <span>{botones.confirmar}</span>
            <span>{botones.cancelar}</span>
          </div>
        ) : null}
      </div>
      {revision?.status === 'pending' ? (
        <p className="tx-aviso mt6">
          <span className="flag">Texto nuevo en revisión por WhatsApp</span> Mientras tanto se sigue enviando el texto aprobado.
        </p>
      ) : null}
      {revision?.status === 'rejected' ? (
        <p className="tx-aviso bad mt6">
          WhatsApp rechazó el último texto{revision.motivo ? ` («${revision.motivo}»)` : ''}. Se sigue enviando el aprobado; puedes corregirlo y
          volver a enviarlo.
        </p>
      ) : null}
      {!abierto ? (
        <div className="actions actions0">
          <button className="btn btnsm alt" type="button" disabled={enRevision} onClick={() => setAbierto(true)}>
            {crear ? 'Personalizar y crear' : 'Editar el texto'}
          </button>
          {enRevision ? <span className="muted">Podrás editarlo cuando WhatsApp termine de revisarlo.</span> : null}
        </div>
      ) : (
        <div className="tx-edit mt6">
          <div className="tx-chips" role="group" aria-label="Insertar variable">
            {cfg.campos.map((c) => (
              <button
                key={c.clave}
                type="button"
                className={`tx-chip${usadas.includes(c.clave) ? ' on' : ''}`}
                title={`${c.label}${c.obligatoria ? ' (obligatoria)' : ''} — ejemplo: ${c.ejemplo}`}
                onClick={() => insertar(c.clave)}
              >
                {`{{${c.clave}}}`}
                {c.obligatoria ? <span aria-label="obligatoria">*</span> : null}
              </button>
            ))}
          </div>
          <textarea
              ref={ref}
              value={borrador}
              rows={6}
              maxLength={2000}
              aria-label={`Texto de ${kind.label}`}
              aria-invalid={actual ? !actual.ok : undefined}
              onChange={(e) => setBorrador(e.target.value)}
            />
          <div className="tx-meta">
            <span className="muted">
              Pulsa una variable para insertarla donde está el cursor. * = obligatoria.
            </span>
            <span className={`tx-count${actual && actual.longitud > cfg.max ? ' bad' : ''}`}>
              {actual ? actual.longitud : borrador.length}/{cfg.max}
            </span>
          </div>
          {actual && actual.errores.length ? (
            <ul className="tx-errores" aria-live="polite">
              {actual.errores.map((e) => (
                <li key={e.code + (e.clave ?? '')}>{mensajeTexto(e, cfg.campos)}</li>
              ))}
            </ul>
          ) : actual?.ok ? (
            <p className="tx-ok" aria-live="polite">
              {cambiado || crear ? 'Cumple las reglas de WhatsApp ✓' : 'Es el texto que ya tienes.'}
            </p>
          ) : null}
          <div className="actions actions0">
            <button className="btn btnsm" type="button" disabled={!puedeEnviar} onClick={() => void enviar()}>
              {guardar.isPending ? 'Enviando…' : crear ? 'Crear y enviar a WhatsApp' : 'Enviar a revisión'}
            </button>
            {borrador !== cfg.defecto ? (
              <button className="btn btnsm alt" type="button" onClick={() => setBorrador(cfg.defecto)}>
                Texto por defecto
              </button>
            ) : null}
            <button
              className="btn btnsm alt"
              type="button"
              onClick={() => {
                setBorrador(vigente);
                setAbierto(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
