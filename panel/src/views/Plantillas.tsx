// Plantillas (solo velai) — rediseño «por plantilla» (lienzo aprobado por Juan,
// 2026-09-01): una TARJETA por kind del catálogo con chips-píldora por cliente, en
// vez de la matriz clientes×kinds (que no escalaba al crecer los tipos).
//
// Dos gestos absorben lo que hacían las otras direcciones del ejercicio de diseño:
//  · el BUSCADOR filtra los chips de todas las tarjetas por cliente (una tarjeta sin
//    coincidencias se atenúa pero no desaparece: el catálogo siempre se ve entero);
//  · los CONTADORES-FILTRO de la cabecera dejan en cada tarjeta solo los chips de ese
//    estado y pliegan el resto en un «+N más» que restaura «Todas». Componen entre sí
//    y los recuentos de las pills son globales — no cambian al filtrar.
//
// Todo lo que se pinta de un kind (label, categoría, descripción, fuente) viene del
// catálogo vía el endpoint: el kind nº 5 será una tarjeta más sin tocar esta vista.
// La celda sin crear de un kind legacy-columnas (aviso_lead) no lleva botón: esa
// plantilla se crea en el paso 2 del aprovisionamiento de la ficha del cliente.
import { useEffect, useState } from 'react';
import { confirmar, pedirTexto } from '../components/Confirmar';
import { CrearPlantilla } from '../components/CrearPlantilla';
import { traducir } from '../api/errors';
import { useToast } from '../components/Toasts';
import { IcoClock, IcoTick, IcoX } from '../components/icons';
import { categoriaReal, chipsDeKind, cuentaPlantillas, filtraChips, resumenKind, resumenSolicitud, type ChipCliente, type EstadoPlantilla } from '../lib/plantillas';
import { useMe, usePlantillas, useSolicitudCreate, useSolicitudes, useSolicitudResolve, useTemplateCreate } from '../hooks/queries';
import type { PlantillaKind, PlantillasResponse, Solicitud } from '../api/types';

// Presentación de cada estado: clase de la píldora e icono (11px, dimensiona el CSS).
const CHIP: Record<Exclude<EstadoPlantilla, 'sin'>, { cls: string; icon: React.ReactNode; label: string }> = {
  approved: { cls: 'ok', icon: <IcoTick />, label: 'aprobada' },
  pending: { cls: 'wait', icon: <IcoClock />, label: 'pendiente' },
  rejected: { cls: 'bad', icon: <IcoX />, label: 'rechazada' },
};

export function Plantillas() {
  const { data: me } = useMe();
  const isCliente = me?.role === 'cliente';
  // La ruta sirve a AMBOS roles (decisión de Juan): la defensa real es del worker,
  // que al cliente le devuelve SOLO su fila y sin sids.
  const { data, error } = usePlantillas(Boolean(me?.role));
  if (isCliente) return <PlantillasCliente data={data} error={error} />;
  return <PlantillasVelai data={data} error={error} />;
}

// ── Vista del CLIENTE: solo lectura — sus plantillas y lo que ve su cliente final ──
// Estados en su idioma, y la pieza central: la vista previa estilo WhatsApp del
// mensaje real, con LOS BOTONES QUE ÉL TIENE elegidos (tenant_templates.opciones de
// su fila; sin opciones o sin plantilla, la pareja por defecto del catálogo).
// SIN botones de crear ni interruptores: la gestión sigue siendo de Velai.
function PlantillasCliente({ data, error }: { data: PlantillasResponse | undefined; error: unknown }) {
  const mio = data?.tenants[0] ?? null;
  const { data: sols } = useSolicitudes(Boolean(data));
  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Plantillas</h1>
          <p>Los mensajes automáticos que enviamos por WhatsApp en tu nombre</p>
        </div>
      </div>
      {error ? <p className="error">{traducir(error)}</p> : null}
      {data && mio
        ? data.kinds.map((k) => (
            <KindCardCliente key={k.kind} k={k} celda={mio.plantillas[k.kind]} hours={mio.hours ?? 24} solicitudes={sols?.solicitudes ?? []} />
          ))
        : null}
      <p className="muted mt12">
        Estas plantillas las gestiona el equipo de Velai y las revisa WhatsApp antes de poder enviarse. ¿Quieres
        activar alguna o cambiar algo más? Escríbenos y lo dejamos listo.
      </p>
    </div>
  );
}

// El estado, en palabras del cliente — nada de jerga de aprobaciones de Meta.
function estadoCliente(celda: PlantillasResponse['tenants'][number]['plantillas'][string]): { cls: string; label: string } {
  const status = celda?.status ?? null;
  if (!status) return { cls: 'off', label: 'Aún no creada' };
  if (status === 'approved') return { cls: 'ok', label: 'Activa ✓' };
  if (status === 'rejected') return { cls: 'bad', label: 'Rechazada — estamos en ello' };
  return { cls: '', label: 'En revisión por WhatsApp' };
}

function KindCardCliente({
  k,
  celda,
  hours,
  solicitudes,
}: {
  k: PlantillaKind;
  celda: PlantillasResponse['tenants'][number]['plantillas'][string];
  hours: number;
  solicitudes: Solicitud[];
}) {
  const toast = useToast();
  const solicitar = useSolicitudCreate();
  const estado = estadoCliente(celda);
  // La categoría REAL de Twilio, sin el matiz de coste (eso es de Velai): solo el hecho.
  const cat = categoriaReal(celda, k);
  // Los botones VIGENTES de su plantilla: lo elegido al crearla; sin opciones (o aún
  // sin plantilla), la pareja por defecto del catálogo.
  const parejas = k.config?.botones ?? [];
  const actualId = celda?.opciones?.botones ?? k.config?.botonesDefault ?? parejas[0]?.id ?? '';
  // Lo que el cliente ELIGE (y ve en la preview). Se re-ancla si cambian los vigentes.
  const [pareja, setPareja] = useState(actualId);
  const [antelacion, setAntelacion] = useState(hours);
  useEffect(() => setPareja(actualId), [actualId]);
  useEffect(() => setAntelacion(hours), [hours]);
  // Solo el recordatorio es solicitable hoy (tipo 'plantilla_recordatorio').
  const solicitable = k.kind === 'recordatorio_cita' && parejas.length > 0;
  const pendiente = solicitudes.find((s) => s.tipo === 'plantilla_recordatorio' && s.status === 'pending') ?? null;
  // La nota de un rechazo se enseña SOLO si es lo último que pasó (la lista llega DESC).
  const ultima = solicitudes.find((s) => s.tipo === 'plantilla_recordatorio') ?? null;
  const rechazada = !pendiente && ultima && ultima.status === 'rejected' ? ultima : null;
  const cambios: { botones?: string; antelacion?: number } = {};
  if (solicitable && pareja && pareja !== actualId) cambios.botones = pareja;
  if (solicitable && antelacion !== hours) cambios.antelacion = antelacion;
  const textos = parejas.find((b) => b.id === (pareja || actualId)) ?? celda?.opciones?.textos ?? null;
  return (
    <div className="panelcard plk">
      <div className="plk-head">
        <b>{k.label}</b>
        <span className={`flag ${estado.cls}`.trim()}>{estado.label}</span>
        {cat ? <span className="flag off">{cat.label}</span> : null}
        {k.descripcion ? <span className="plk-desc">{k.descripcion}</span> : null}
      </div>
      {k.config?.preview ? (
        <>
          <p className="muted mt6">Así le llega a tu cliente{k.kind === 'aviso_lead' ? ' (a tu equipo)' : ''}:</p>
          <div className="wapre">
            <div className="wapre-body">{k.config.preview}</div>
            {parejas.length && textos ? (
              <div className="wapre-btns">
                <span>{textos.confirmar}</span>
                <span>{textos.cancelar}</span>
              </div>
            ) : null}
          </div>
          {!celda?.status ? <p className="muted mt6">Así se verá cuando se cree. ¿Quieres activarla? Escríbenos.</p> : null}
        </>
      ) : null}
      {solicitable ? (
        <div className="mt6">
          {/* El cliente ELIGE aquí, pero nada se aplica sin aprobación de Velai:
              esto crea una SOLICITUD (tenant_solicitudes) — las opciones son las
              curadas del catálogo, las mismas del alta. */}
          <b>¿Quieres cambiarla?</b>
          <div className="mt6">
            <span className="sel">
              <select
                value={antelacion}
                disabled={Boolean(pendiente)}
                aria-label="Antelación del recordatorio"
                onChange={(e) => setAntelacion(Number(e.target.value))}
              >
                {(k.config?.antelaciones ?? []).map((h) => (
                  <option key={h} value={h}>
                    Recordar {h} h antes
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="crp-parejas" role="radiogroup" aria-label="Botones de respuesta">
            {parejas.map((b) => (
              <label key={b.id} className={`crp-pareja${pareja === b.id ? ' on' : ''}`}>
                <input
                  type="radio"
                  name={`sol-${k.kind}`}
                  value={b.id}
                  checked={pareja === b.id}
                  disabled={Boolean(pendiente)}
                  onChange={() => setPareja(b.id)}
                />
                <span className="crp-btnprev">{b.confirmar}</span>
                <span className="crp-btnprev">{b.cancelar}</span>
              </label>
            ))}
          </div>
          {pendiente ? (
            <p className="muted mt6">
              <span className="flag">Solicitud enviada — pendiente de Velai</span> Te avisamos en cuanto se revise.
            </p>
          ) : (
            <>
              {rechazada ? (
                <p className="muted mt6">
                  Tu última solicitud se rechazó{rechazada.nota ? `: «${rechazada.nota}»` : ''}. Puedes pedir otro
                  cambio cuando quieras.
                </p>
              ) : null}
              <div className="actions actions0">
                <button
                  className="btn btnsm"
                  type="button"
                  disabled={solicitar.isPending || !Object.keys(cambios).length}
                  onClick={async () => {
                    if (
                      !(await confirmar({
                        titulo: '¿Enviar la solicitud de cambio?',
                        cuerpo: 'El equipo de Velai la revisa y la aplica si todo está bien. Si cambian los botones, WhatsApp vuelve a revisar la plantilla.',
                        accion: 'Solicitar cambio',
                      }))
                    )
                      return;
                    solicitar.mutate(
                      { tipo: 'plantilla_recordatorio', ...cambios },
                      {
                        onSuccess: () => toast('Solicitud enviada: Velai la revisará en breve ✓'),
                        onError: (e) => toast(`No se pudo enviar la solicitud: ${traducir(e)}`, false),
                      },
                    );
                  }}
                >
                  Solicitar cambio
                </button>
                {!Object.keys(cambios).length ? <span className="muted">Elige arriba lo que quieras cambiar.</span> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Vista de VELAI: la matriz global, tal cual (ni un píxel cambia) ───────────
function PlantillasVelai({ data, error }: { data: PlantillasResponse | undefined; error: unknown }) {
  const [clienteId, setClienteId] = useState('');
  const [estado, setEstado] = useState<EstadoPlantilla | ''>('');

  const n = data ? cuentaPlantillas(data) : null;
  const pills: { valor: EstadoPlantilla | ''; label: string; n: number }[] = n
    ? [
        { valor: '', label: 'Todas', n: n.todas },
        { valor: 'approved', label: 'Aprobadas', n: n.aprobadas },
        { valor: 'pending', label: 'Pendientes', n: n.pendientes },
        { valor: 'rejected', label: 'Rechazadas', n: n.rechazadas },
        { valor: 'sin', label: 'Sin crear', n: n.sinCrear },
      ]
    : [];

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Plantillas</h1>
          <p>Las plantillas de WhatsApp de cada cliente y su aprobación en Meta</p>
        </div>
        {data ? (
          <div className="plctrl">
            {/* Desplegable y no texto libre (pedido de Juan): es el patrón de cliente del
                resto del panel (Leads, Conversaciones) y con un conjunto CERRADO de
                clientes, elegir gana a teclear. */}
            <span className="sel">
              <select aria-label="Filtrar por cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">Todos los clientes</option>
                {data.tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </span>
            <div className="plpills" role="group" aria-label="Filtrar por estado">
              {pills.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`plpill${estado === p.valor ? ' on' : ''}`}
                  aria-pressed={estado === p.valor}
                  onClick={() => setEstado(p.valor)}
                >
                  {p.label} <b>{p.n}</b>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className="error">{traducir(error)}</p> : null}
      {data ? <SolicitudesBlock data={data} /> : null}
      {data ? data.kinds.map((k) => <KindCard key={k.kind} k={k} data={data} clienteId={clienteId} estado={estado} onTodas={() => setEstado('')} />) : null}
      <p className="muted mt12">
        El cuerpo de cada plantilla vive en el código (es un contrato con quien la envía); aquí se gestiona su alta y
        su estado por cliente. El worker revisa la aprobación de Meta cada 5 minutos y avisa por Telegram cuando una
        plantilla pasa a aprobada o rechazada. La categoría junto a cada cliente es la REAL de Twilio («—» mientras no
        se haya leído); en ámbar cuando difiere de la del catálogo — Marketing es más cara y con topes.
      </p>
    </div>
  );
}

// ── Solicitudes pendientes de los clientes: arriba de la matriz, solo si hay ──
// El cliente pidió un cambio desde SU vista; aquí se decide. Aprobar APLICA (la
// antelación al momento; botones distintos recrean la plantilla → nueva revisión de
// Meta). Rechazar exige una nota breve, que el cliente ve en su panel.
function SolicitudesBlock({ data }: { data: PlantillasResponse }) {
  const toast = useToast();
  const { data: sols } = useSolicitudes(true);
  const resolver = useSolicitudResolve();
  const pendientes = sols?.solicitudes ?? [];
  if (!pendientes.length) return null; // vacío = no ocupa sitio
  const kindRecordatorio = data.kinds.find((k) => k.kind === 'recordatorio_cita');
  return (
    <div className="panelcard plk">
      <div className="plk-head">
        <b>
          Solicitudes de clientes<span className="pt-count">{pendientes.length}</span>
        </b>
        <span className="plk-desc">Cambios pedidos desde su panel: nada se aplica sin aprobarlo aquí.</span>
      </div>
      {pendientes.map((s) => (
        <div className="mt6" key={s.id}>
          <b>{s.tenant_name}</b>{' '}
          <span className="muted">· {s.requested_by}</span>
          {resumenSolicitud(s.payload, s.actual, kindRecordatorio).map((linea) => (
            <div className="muted" key={linea}>
              {linea}
            </div>
          ))}
          <div className="actions actions0">
            <button
              className="btn btnsm"
              type="button"
              disabled={resolver.isPending}
              onClick={async () => {
                if (
                  !(await confirmar({
                    titulo: `¿Aprobar la solicitud de ${s.tenant_name}?`,
                    cuerpo: s.payload.botones
                      ? 'Se aplica al momento. Si los botones cambian, la plantilla se recrea y pasa otra revisión de Meta.'
                      : 'La antelación se aplica al momento, sin nueva revisión de Meta.',
                    accion: 'Aprobar y aplicar',
                  }))
                )
                  return;
                resolver.mutate(
                  { id: s.id, accion: 'aprobar' },
                  {
                    onSuccess: () => toast('Solicitud aprobada y aplicada ✓'),
                    onError: (e) => toast(`No se pudo aprobar: ${traducir(e)}`, false),
                  },
                );
              }}
            >
              Aprobar
            </button>
            <button
              className="btn alt btnsm"
              type="button"
              disabled={resolver.isPending}
              onClick={async () => {
                // La nota es obligatoria: el cliente la ve en su panel.
                const nota = await pedirTexto({
                  titulo: `Rechazar la solicitud de ${s.tenant_name}`,
                  cuerpo: 'El motivo se le enseña al cliente en su panel.',
                  placeholder: 'Motivo breve del rechazo',
                  accion: 'Rechazar',
                });
                if (nota === null) return;
                resolver.mutate(
                  { id: s.id, accion: 'rechazar', nota },
                  {
                    onSuccess: () => toast('Solicitud rechazada'),
                    onError: (e) => toast(`No se pudo rechazar: ${traducir(e)}`, false),
                  },
                );
              }}
            >
              Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function KindCard({
  k,
  data,
  clienteId,
  estado,
  onTodas,
}: {
  k: PlantillaKind;
  data: PlantillasResponse;
  clienteId: string;
  estado: EstadoPlantilla | '';
  onTodas: () => void;
}) {
  const chips = chipsDeKind(data, k.kind);
  const { visibles, ocultos, atenuada } = filtraChips(chips, clienteId, estado);
  return (
    <div className={`panelcard plk${atenuada ? ' atenuada' : ''}`}>
      <div className="plk-head">
        <b>{k.label}</b>
        {k.categoria ? <span className="flag off">{k.categoria}</span> : null}
        {k.descripcion ? <span className="plk-desc">{k.descripcion}</span> : null}
        {/* Resumen de ESTA plantilla, siempre sobre todos los clientes (no filtra). */}
        <span className="plk-sum">{resumenKind(chips)}</span>
      </div>
      <div className="plchips">
        {visibles.map((c) => (
          <Chip key={c.id} c={c} kind={k} />
        ))}
        {ocultos > 0 ? (
          <button type="button" className="plmore" onClick={onTodas}>
            +{ocultos} más
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ c, kind }: { c: ChipCliente; kind: PlantillaKind }) {
  const toast = useToast();
  const crear = useTemplateCreate();
  const [abierto, setAbierto] = useState(false);
  if (c.estado !== 'sin') {
    const p = CHIP[c.estado];
    // La categoría a la vista es la REAL de Twilio; «—» mientras el poll no la lea.
    // En ámbar cuando difiere de la intención del catálogo: aviso de coste (Marketing
    // es más cara y con topes), no un adorno.
    const cat = categoriaReal({ status: 'x', categoria: c.categoria }, kind);
    return (
      <span className={`plchip ${p.cls}`} title={`Plantilla ${p.label}${c.sid ? ` · ${c.sid}` : ''}`}>
        {p.icon}
        {c.name}
        {cat ? <span className={`plcat${cat.distinta ? ' warn' : ''}`}>{cat.label}</span> : null}
      </span>
    );
  }
  // Sin crear: borde discontinuo. La legacy de columnas remite a su paso; las del
  // registro llevan el botón «Crear» dentro del chip. Con config, «Crear» abre el
  // diálogo de alta (antelación + botones + vista previa, envío explícito); un kind
  // creable sin config (worker viejo) conserva el confirmar simple de antes.
  return (
    <span className="plchip sin">
      {c.name}
      {kind.fuente === 'columnas' ? (
        <span className="paso">paso 2 del aprovisionamiento</span>
      ) : (
        <button
          className="btn btnsm"
          type="button"
          disabled={crear.isPending}
          onClick={async () => {
            if (kind.config) {
              setAbierto(true);
              return;
            }
            if (
              !(await confirmar({
                titulo: `¿Crear la plantilla «${kind.label}» para ${c.name}?`,
                cuerpo: `Se crea en su subcuenta de Twilio y se envía a aprobación de Meta${kind.categoria ? ` (categoría ${kind.categoria})` : ''}. Suele tardar de minutos a horas; el estado se actualiza solo.`,
                accion: 'Crear y enviar',
              }))
            )
              return;
            crear.mutate(
              { id: c.id, kind: kind.kind },
              {
                onSuccess: () => toast('Plantilla creada y enviada a aprobación de Meta ✓'),
                onError: (e) => toast(`No se pudo crear la plantilla: ${traducir(e)}`, false),
              },
            );
          }}
        >
          Crear
        </button>
      )}
      {abierto ? <CrearPlantilla tenantId={c.id} tenantName={c.name} kind={kind} onClose={() => setAbierto(false)} /> : null}
    </span>
  );
}
