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
import { useState } from 'react';
import { confirmar } from '../components/Confirmar';
import { traducir } from '../api/errors';
import { useToast } from '../components/Toasts';
import { IcoClock, IcoSearch, IcoTick, IcoX } from '../components/icons';
import { chipsDeKind, cuentaPlantillas, filtraChips, resumenKind, type ChipCliente, type EstadoPlantilla } from '../lib/plantillas';
import { useMe, usePlantillas, useTemplateCreate } from '../hooks/queries';
import type { PlantillaKind, PlantillasResponse } from '../api/types';

// Presentación de cada estado: clase de la píldora e icono (11px, dimensiona el CSS).
const CHIP: Record<Exclude<EstadoPlantilla, 'sin'>, { cls: string; icon: React.ReactNode; label: string }> = {
  approved: { cls: 'ok', icon: <IcoTick />, label: 'aprobada' },
  pending: { cls: 'wait', icon: <IcoClock />, label: 'pendiente' },
  rejected: { cls: 'bad', icon: <IcoX />, label: 'rechazada' },
};

export function Plantillas() {
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  // La defensa real es del worker (403 al rol cliente); el enabled solo evita una
  // llamada que sabemos condenada si alguien teclea la URL a mano.
  const { data, error } = usePlantillas(isVelai === true);
  const [q, setQ] = useState('');
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
            <label className="search">
              <IcoSearch />
              <input className="q" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
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
      {data ? data.kinds.map((k) => <KindCard key={k.kind} k={k} data={data} q={q} estado={estado} onTodas={() => setEstado('')} />) : null}
      <p className="muted mt12">
        El cuerpo de cada plantilla vive en el código (es un contrato con quien la envía); aquí se gestiona su alta y
        su estado por cliente. El worker revisa la aprobación de Meta cada 5 minutos y avisa por Telegram cuando una
        plantilla pasa a aprobada o rechazada.
      </p>
    </div>
  );
}

function KindCard({
  k,
  data,
  q,
  estado,
  onTodas,
}: {
  k: PlantillaKind;
  data: PlantillasResponse;
  q: string;
  estado: EstadoPlantilla | '';
  onTodas: () => void;
}) {
  const chips = chipsDeKind(data, k.kind);
  const { visibles, ocultos, atenuada } = filtraChips(chips, q, estado);
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
  if (c.estado !== 'sin') {
    const p = CHIP[c.estado];
    return (
      <span className={`plchip ${p.cls}`} title={`Plantilla ${p.label}${c.sid ? ` · ${c.sid}` : ''}`}>
        {p.icon}
        {c.name}
      </span>
    );
  }
  // Sin crear: borde discontinuo. La legacy de columnas remite a su paso; las del
  // registro llevan el botón «Crear» dentro del chip.
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
    </span>
  );
}
