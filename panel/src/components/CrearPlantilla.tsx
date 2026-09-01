// Diálogo de alta de una plantilla configurable (SPEC-CONFIRMACIONES, evolución
// 2026-09-01): «Crear plantilla» deja de ser un confirmar a ciegas — se elige la
// antelación y la pareja de botones VIENDO el mensaje que Meta va a revisar, y el
// envío es explícito («Enviar a aprobación»).
//
// No usa Confirmar.tsx a propósito: aquello es para confirmaciones simples de sí/no;
// esto es un formulario con vista previa. Sí comparte el molde de los <dialog> del
// sistema (modal-h/modal-b, showModal).
//
// TODO lo configurable viene del catálogo vía el endpoint (kind.config): parejas
// CURADAS — nunca texto libre hacia Twilio (decisión de Juan) —, antelaciones y la
// preview renderizada. Aquí no vive ni un literal del cuerpo.
import { useEffect, useRef, useState } from 'react';
import { traducir } from '../api/errors';
import { useToast } from './Toasts';
import { useTemplateCreate } from '../hooks/queries';
import type { PlantillaKind } from '../api/types';

export function CrearPlantilla({
  tenantId,
  tenantName,
  kind,
  onClose,
}: {
  tenantId: string;
  tenantName: string;
  kind: PlantillaKind;
  onClose: () => void;
}) {
  const toast = useToast();
  const crear = useTemplateCreate();
  const ref = useRef<HTMLDialogElement>(null);
  const config = kind.config;
  const [antelacion, setAntelacion] = useState<number>(config?.antelacionDefault ?? 24);
  const [pareja, setPareja] = useState<string>(config?.botonesDefault ?? '');

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
  }, []);

  if (!config) return null;
  const parejas = config.botones ?? [];
  const elegida = parejas.find((b) => b.id === pareja) ?? parejas[0] ?? null;

  return (
    <dialog ref={ref} onClose={onClose} aria-label={`Crear plantilla ${kind.label}`}>
      <div className="modal-h">
        <strong>
          {kind.label} — {tenantName}
        </strong>
        <button className="btn alt" type="button" onClick={() => ref.current?.close()}>
          Cerrar
        </button>
      </div>
      <div className="modal-b">
        {config.antelaciones?.length ? (
          <div className="crp-bloque">
            <b>Antelación del recordatorio</b>
            <div className="mt6">
              <span className="sel">
                <select value={antelacion} onChange={(e) => setAntelacion(Number(e.target.value))} aria-label="Antelación del recordatorio">
                  {config.antelaciones.map((h) => (
                    <option key={h} value={h}>
                      {h} h antes de la cita
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {/* Honestidad sobre qué compromete cada elección: la antelación es config
                del addon y se cambia luego; los botones van DENTRO de la plantilla. */}
            <p className="muted mt6">Se puede cambiar después sin nueva aprobación.</p>
          </div>
        ) : null}
        {parejas.length ? (
          <div className="crp-bloque">
            <b>Botones de respuesta</b>
            <div className="crp-parejas" role="radiogroup" aria-label="Botones de respuesta">
              {parejas.map((b) => (
                <label key={b.id} className={`crp-pareja${(elegida?.id ?? '') === b.id ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="crp-pareja"
                    value={b.id}
                    checked={(elegida?.id ?? '') === b.id}
                    onChange={() => setPareja(b.id)}
                  />
                  <span className="crp-btnprev">{b.confirmar}</span>
                  <span className="crp-btnprev">{b.cancelar}</span>
                </label>
              ))}
            </div>
            <p className="muted mt6">
              Cambiar los botones después exige crear una plantilla nueva y otra revisión de Meta.
            </p>
          </div>
        ) : null}
        {config.preview ? (
          <div className="crp-bloque">
            <b>Vista previa del mensaje</b>
            <div className="wapre mt6">
              <div className="wapre-body">{config.preview}</div>
              {elegida ? (
                <div className="wapre-btns">
                  <span>{elegida.confirmar}</span>
                  <span>{elegida.cancelar}</span>
                </div>
              ) : null}
            </div>
            <p className="muted mt6">Con datos de ejemplo: al enviarse llevará el nombre, la fecha y el motivo reales de cada cita.</p>
          </div>
        ) : null}
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={crear.isPending}
            onClick={() =>
              crear.mutate(
                { id: tenantId, kind: kind.kind, opciones: { ...(elegida ? { botones: elegida.id } : {}), antelacion } },
                {
                  onSuccess: () => {
                    toast('Plantilla creada y enviada a aprobación de Meta ✓');
                    ref.current?.close();
                  },
                  onError: (e) => toast(`No se pudo crear la plantilla: ${traducir(e)}`, false),
                },
              )
            }
          >
            Enviar a aprobación
          </button>
          <button className="btn alt" type="button" onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </div>
    </dialog>
  );
}
