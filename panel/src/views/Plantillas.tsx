// Plantillas (solo velai): la matriz operativa clientes × kinds del catálogo de
// plantillas de WhatsApp (worker/plantillas.js). Pedido de Juan con la primera
// plantilla real en pending: «validar qué plantillas tenemos, cuáles en validación,
// aprobadas, rechazadas» — de un vistazo y con el botón de crear donde falte.
//
// La celda de aviso_lead (legacy-columnas) NO tiene botón: esa plantilla se crea en el
// paso 2 del aprovisionamiento de la ficha del cliente, y aquí solo se LEE su estado.
import { confirmar } from '../components/Confirmar';
import { traducir } from '../api/errors';
import { useToast } from '../components/Toasts';
import { TenantChip } from '../components/Pills';
import { chipPlantilla, cuentaPlantillas } from '../lib/plantillas';
import { useMe, usePlantillas, useTemplateCreate } from '../hooks/queries';
import type { PlantillasResponse } from '../api/types';

export function Plantillas() {
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  // La defensa real es del worker (403 al rol cliente); el enabled solo evita una
  // llamada que sabemos condenada si alguien teclea la URL a mano.
  const { data, error } = usePlantillas(isVelai === true);
  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Plantillas</h1>
          <p>Las plantillas de WhatsApp de cada cliente y su aprobación en Meta</p>
        </div>
        {data ? <Recuento data={data} /> : null}
      </div>
      <p className="muted">
        El cuerpo de cada plantilla vive en el código (es un contrato con quien la envía); aquí se gestiona su alta y
        su estado por cliente. El worker revisa la aprobación de Meta cada 5 minutos y avisa por Telegram cuando una
        plantilla pasa a aprobada o rechazada.
      </p>
      {error ? <p className="error">{traducir(error)}</p> : null}
      {data ? <Matriz data={data} /> : null}
    </div>
  );
}

function Recuento({ data }: { data: PlantillasResponse }) {
  const n = cuentaPlantillas(data);
  return (
    <span className={`stpill ${n.rechazadas ? 'warn' : 'ok'}`}>
      <i />
      {n.aprobadas} aprobadas · {n.pendientes} pendientes · {n.rechazadas} rechazadas · {n.sinCrear} sin crear
    </span>
  );
}

function Matriz({ data }: { data: PlantillasResponse }) {
  return (
    <div className="table mt12">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            {data.kinds.map((k) => (
              <th key={k.kind}>{k.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.tenants.length ? (
            data.tenants.map((t) => (
              <tr key={t.id}>
                <td>
                  <TenantChip id={t.id} name={t.name} />
                  {t.active ? null : <span className="muted"> · inactivo</span>}
                </td>
                {data.kinds.map((k) => (
                  <td key={k.kind}>
                    <Celda
                      tenantId={t.id}
                      tenantName={t.name}
                      kind={k.kind}
                      kindLabel={k.label}
                      fuente={k.fuente}
                      celda={t.plantillas[k.kind]}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={1 + data.kinds.length} className="muted">
                Sin clientes todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Celda({
  tenantId,
  tenantName,
  kind,
  kindLabel,
  fuente,
  celda,
}: {
  tenantId: string;
  tenantName: string;
  kind: string;
  kindLabel: string;
  fuente: 'registro' | 'columnas';
  celda: PlantillasResponse['tenants'][number]['plantillas'][string];
}) {
  const toast = useToast();
  const crear = useTemplateCreate();
  const chip = chipPlantilla(celda);
  if (celda?.status) {
    return (
      <span className={`flag ${chip.cls}`.trim()} title={celda.sid ?? undefined}>
        {chip.emoji} {chip.label}
      </span>
    );
  }
  // Sin crear. La legacy de columnas no se crea desde aquí: se remite a su paso.
  if (fuente === 'columnas') {
    return <span className="muted">— se crea en el paso 2 del aprovisionamiento (ficha del cliente)</span>;
  }
  return (
    <>
      <span className={`flag ${chip.cls}`.trim()}>
        {chip.emoji} {chip.label}
      </span>{' '}
      <button
        className="btn alt btnsm"
        type="button"
        disabled={crear.isPending}
        onClick={async () => {
          if (
            !(await confirmar({
              titulo: `¿Crear la plantilla «${kindLabel}» para ${tenantName}?`,
              cuerpo: 'Se crea en su subcuenta de Twilio y se envía a aprobación de Meta (categoría Utility). Suele tardar de minutos a horas; el estado se actualiza solo.',
              accion: 'Crear y enviar',
            }))
          )
            return;
          crear.mutate(
            { id: tenantId, kind },
            {
              onSuccess: () => toast('Plantilla creada y enviada a aprobación de Meta ✓'),
              onError: (e) => toast(`No se pudo crear la plantilla: ${traducir(e)}`, false),
            },
          );
        }}
      >
        Crear
      </button>
    </>
  );
}
