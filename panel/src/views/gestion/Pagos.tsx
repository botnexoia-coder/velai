import { useState } from 'react';
import { Card, ErrorBox, FormModal, GestionGate, Money, Notice, amount, hoy, opt, options, str, useGestion, useGuardar, type Catalogos, type Moneda } from './shared';

export interface Pago {
  id: string;
  objeto_tipo: 'compra' | 'prestamo';
  objeto_id: string;
  clase: 'pago' | 'reembolso' | 'reverso';
  pago_id: string | null;
  numero: number | null;
  fecha: string;
  moneda: Moneda;
  importe: number;
  capital: number;
  interes: number;
  comision: number;
  pagador: 'cuenta' | 'socio';
  cuenta_id: string | null;
  socio: string | null;
  estado: 'activo' | 'revertido';
  nota: string | null;
  motivo: string | null;
  registrado_por?: string;
  created_by?: string;
}

type Props = { tipo: 'compra' | 'prestamo'; objetoId: string };
type Action = { tipo: 'revertir' | 'reembolsar'; pagoId: string };
type History = { items?: Pago[]; pagos?: Pago[] };

function reembolsado(pago: Pago, rows: Pago[]) {
  return rows.filter((r) => r.clase === 'reembolso' && r.pago_id === pago.id && r.estado === 'activo').reduce((s, r) => s + r.importe, 0);
}
function persona(email: string | null | undefined, catalogos?: Catalogos) {
  return catalogos?.socios.find((s) => s.email.toLowerCase() === email?.toLowerCase())?.nombre ?? email ?? 'Por confirmar';
}
function origen(pago: Pago, catalogos?: Catalogos) {
  if (pago.pagador === 'socio') return `Fondos de ${persona(pago.socio, catalogos)}`;
  return catalogos?.cuentas.find((c) => c.id === pago.cuenta_id)?.nombre ?? 'Cuenta del proyecto';
}
function movimiento(pago: Pago, referencia?: Pago | null) {
  if (pago.clase === 'reembolso') return 'Devolución de anticipo';
  if (pago.clase === 'reverso') return referencia?.clase === 'reembolso' ? 'Reverso de devolución' : 'Reverso de pago';
  if (pago.objeto_tipo === 'prestamo') return `Pago de cuota ${pago.numero ?? ''}`.trim();
  return pago.pagador === 'socio' ? 'Adelanto de socio' : 'Pago al proveedor';
}

/** Se monta dentro del detalle de una compra/préstamo. No registra pagos nuevos. */
export function Pagos(props: Props) {
  return <GestionGate><HistorialPagos key={`${props.tipo}:${props.objetoId}`} {...props}/></GestionGate>;
}

function HistorialPagos({ tipo, objetoId }: Props) {
  const path = tipo === 'compra' ? `compras/${objetoId}/pagos` : `prestamos/${objetoId}/resumen`;
  const query = useGestion<History>(path), cat = useGestion<Catalogos>('catalogos'), save = useGuardar();
  const [action, setAction] = useState<Action | null>(null);
  const values = tipo === 'compra' ? query.data?.items : query.data?.pagos;
  const rows = Array.isArray(values) ? values : [];
  const malformed = query.isSuccess && !Array.isArray(values);
  const selected = rows.find((p) => p.id === action?.pagoId);
  const accounts = cat.data?.cuentas.filter((c) => c.moneda === selected?.moneda) ?? [];
  const rest = selected ? Math.max(0, selected.importe - reembolsado(selected, rows)) : 0;

  async function reverse(data: FormData, id: string) {
    if (!selected || (selected.clase !== 'pago' && !(tipo === 'compra' && selected.clase === 'reembolso'))) throw new Error('pago_invalido');
    const motivo = str(data, 'motivo'), fecha = str(data, 'fecha');
    if (motivo.length < 5 || motivo.length > 500) throw new Error('motivo_invalido');
    if (!fecha || fecha < selected.fecha) throw new Error('fecha_anterior_al_pago');
    // Reintento idéntico permitido incluso si el refresco ya muestra el reverso.
    if (selected.estado !== 'activo' && !rows.some((r) => r.id === id && r.pago_id === selected.id && r.clase === 'reverso')) throw new Error('pago_revertido');
    if (reembolsado(selected, rows) > 0) throw new Error('pago_con_reembolsos');
    return save.mutateAsync({ path: `${tipo === 'compra' ? 'compras' : 'prestamos'}/${objetoId}/pagos/${selected.id}/revertir`, body: { id, fecha, motivo } });
  }

  async function reimburse(data: FormData, id: string) {
    if (!selected || selected.clase !== 'pago' || selected.pagador !== 'socio' || selected.estado !== 'activo') throw new Error('pago_no_es_anticipo');
    const importe = amount(data, 'importe', selected.moneda), cuenta_id = str(data, 'cuenta_id'), fecha = str(data, 'fecha');
    if (importe <= 0) throw new Error('importe_invalido');
    if (!fecha || fecha < selected.fecha) throw new Error('fecha_anterior_al_pago');
    if (!accounts.some((a) => a.id === cuenta_id)) throw new Error('cuenta_invalida');
    const retry = rows.some((r) => r.id === id && r.clase === 'reembolso' && r.pago_id === selected.id);
    if (!retry && importe > rest) throw new Error('reembolso_supera_anticipo');
    return save.mutateAsync({ path: `compras/${objetoId}/reembolsos`, body: { id, pago_id: selected.id, cuenta_id, fecha, importe, nota: opt(data, 'nota') } });
  }

  return <Card title="Historial de pagos">
    <ErrorBox error={query.error || cat.error || (malformed ? new Error('historial_no_disponible') : null)}/>
    {query.isPending ? <p role="status">Cargando pagos…</p> : query.error || malformed ? <button type="button" className="btn alt" onClick={() => void query.refetch()}>Reintentar historial</button> : rows.length ?
      <div className="g-table"><table><caption className="g-sr-only">Pagos, devoluciones de anticipos y reversos {tipo === 'compra' ? 'de la compra' : 'del préstamo'}</caption>
        <thead><tr><th scope="col">Fecha y movimiento</th><th scope="col">Origen del dinero</th><th scope="col">Importe</th><th scope="col">Estado</th><th scope="col">Registrado por</th><th scope="col">Acciones</th></tr></thead>
        <tbody>{rows.map((p) => {
          const returned = reembolsado(p, rows), pending = Math.max(0, p.importe - returned);
          const advance = tipo === 'compra' && p.clase === 'pago' && p.pagador === 'socio' && p.estado === 'activo';
          const refundAccount = cat.data?.cuentas.some((a) => a.moneda === p.moneda);
          const reference = p.pago_id ? rows.find((r) => r.id === p.pago_id) : null;
          const reversible = p.clase === 'pago' || (tipo === 'compra' && p.clase === 'reembolso');
          return <tr key={p.id}>
            <td><time dateTime={p.fecha}>{p.fecha.split('-').reverse().join('/')}</time><small>{movimiento(p, reference)}</small>{p.nota || p.motivo ? <small>{p.motivo || p.nota}</small> : null}
              {reference ? <small>Vinculado {reference.clase === 'reembolso' ? 'a la devolución' : 'al pago'} del {reference.fecha.split('-').reverse().join('/')}</small> : null}</td>
            <td>{origen(p, cat.data)}{p.clase === 'reembolso' && reference?.socio ? <small>Devuelto a {persona(reference.socio, cat.data)}</small> : null}</td>
            <td><Money value={p.clase === 'reverso' ? -p.importe : p.importe} moneda={p.moneda}/>{p.objeto_tipo === 'prestamo' && p.clase === 'pago' ? <small>Capital: <Money value={p.capital} moneda={p.moneda}/> · Interés: <Money value={p.interes} moneda={p.moneda}/>{p.comision ? <> · Comisión: <Money value={p.comision} moneda={p.moneda}/></> : null}</small> : null}
              {advance ? <small>Pendiente al socio: <Money value={pending} moneda={p.moneda}/></small> : null}</td>
            <td><span className={`g-badge ${p.estado === 'activo' && p.clase === 'pago' ? 'done' : ''}`}>{p.estado === 'revertido' ? 'Revertido' : p.clase === 'reverso' ? 'Reverso registrado' : 'Registrado'}</span></td>
            <td>{persona(p.registrado_por ?? p.created_by, cat.data)}</td>
            <td>{reversible && p.estado === 'activo' ? <div className="g-inline">
              {advance && pending > 0 ? <button type="button" className="btn alt" disabled={!refundAccount || !!cat.error} onClick={() => setAction({ tipo: 'reembolsar', pagoId: p.id })}>Reembolsar anticipo</button> : null}
              <button type="button" className="btn alt" disabled={returned > 0} aria-describedby={returned > 0 ? `reverso-${p.id}` : undefined} onClick={() => setAction({ tipo: 'revertir', pagoId: p.id })}>{p.clase === 'reembolso' ? 'Revertir devolución' : 'Revertir pago'}</button>
            </div> : <span>—</span>}
              {advance && pending > 0 && !refundAccount && !cat.isPending && !cat.error ? <small>Añade una cuenta en {p.moneda} para registrar la devolución.</small> : null}
              {returned > 0 && p.clase === 'pago' && p.estado === 'activo' ? <small id={`reverso-${p.id}`}>No puede revertirse mientras tenga reembolsos activos.</small> : null}
            </td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="g-empty">Todavía no hay pagos registrados. Las previsiones no aparecen como pagadas.</p>}
    {tipo === 'compra' ? <Notice>El comprador y quien aporta el dinero pueden ser personas distintas. Reembolsar un adelanto devuelve dinero al socio y no registra otra compra.</Notice> : <Notice>El historial muestra pagos registrados. Una cuota prevista o reservada no equivale a un pago confirmado.</Notice>}
    {action && selected ? action.tipo === 'revertir' ? <FormModal key={`revertir-${selected.id}`} title={selected.clase === 'reembolso' ? 'Revertir devolución registrada' : 'Revertir pago registrado'} close={() => setAction(null)} label="Registrar reverso" fields={[
      { name: 'fecha', label: 'Fecha del reverso', type: 'date', value: hoy(), min: selected.fecha, max: hoy(), required: true },
      { name: 'motivo', label: 'Motivo del reverso', type: 'textarea', required: true, help: 'Explica la corrección en 5 a 500 caracteres.' },
    ]} submit={reverse}><Notice>Se revertirá {selected.clase === 'reembolso' ? 'una devolución' : 'un pago'} de <Money value={selected.importe} moneda={selected.moneda}/>. El registro original permanece y se añade su reverso. {selected.clase === 'reembolso' ? 'El importe vuelve a quedar pendiente de devolver al socio. ' : ''}Esta acción corrige el registro; no ordena una transferencia bancaria.</Notice></FormModal> :
      <FormModal key={`reembolsar-${selected.id}`} title="Devolver anticipo al socio" close={() => setAction(null)} label="Registrar devolución" fields={[
        { name: 'importe', label: `Importe a devolver (${selected.moneda})`, value: rest / (selected.moneda === 'EUR' ? 100 : 1), required: true, help: 'Puedes registrar una devolución parcial.' },
        { name: 'cuenta_id', label: 'Cuenta del proyecto que devuelve el dinero', options: options(accounts), required: true },
        { name: 'fecha', label: 'Fecha de la devolución', type: 'date', value: hoy(), min: selected.fecha, max: hoy(), required: true },
        { name: 'nota', label: 'Referencia de la transferencia' },
      ]} submit={reimburse}><Notice>Beneficiario: {persona(selected.socio, cat.data)}. Pendiente: <Money value={rest} moneda={selected.moneda}/>. Registra la devolución cuando se haya realizado desde la cuenta seleccionada.</Notice></FormModal> : null}
  </Card>;
}
