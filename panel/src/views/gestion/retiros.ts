// Tipos y textos de la Conciliación de retiros. Importes en unidades menores (céntimos EUR).
export type Clasificacion = 'cajero_verificado' | 'efectivo_declarado' | 'traspaso_por_identificar';
export type EstadoCoste = 'confirmado' | 'por_confirmar' | 'autorizacion_pendiente';
export type EstadoOrigen = 'activo' | 'anulado' | 'corregido' | 'no_encontrado';

export interface TotalesRetiro {
 total_salidas:number;efectivo_confirmado:number;efectivo_declarado:number;traspasos_por_identificar:number;
 usos_registrados:number;usos_declarados:number;usos_total:number;
 aportes_personales:number;aportes_reembolsables:number;aportes_no_reembolsables:number;aportes_sin_indicar:number;
 comisiones_conocidas:number;comisiones_por_confirmar:number;comisiones_desconocidas:number;comisiones_por_confirmar_importe:number;
 diferencia_por_explicar:number;origen_no_trazado:number;
}
export interface MotivoRetiro { codigo:string;cantidad:number;importe:number|null }
export interface LoteRetiro { id:string;nombre:string;moneda:'EUR'|'COP';nota:string|null;version:number;created_by:string;created_at:string;updated_by:string;updated_at:string }
export interface ResumenLote extends LoteRetiro { estado:'abierta'|'sin_pendientes';motivos:MotivoRetiro[];totales:TotalesRetiro;fuentes_count:number;usos_count:number }
export interface ListaRetiros { items:ResumenLote[];mas:boolean;totales:Record<string,TotalesRetiro&{lotes:number;lotes_abiertos:number}> }
export interface OrigenVivo { estado:EstadoOrigen;fecha?:string;nota?:string|null;importe_actual?:number;cuenta_origen?:string|null;cuenta_destino?:string|null;reverso_id?:string|null;tipo?:string }
export interface FuenteRetiro {
 id:string;lote_id:string;origen_tipo:'traspaso'|'movimiento';origen_id:string;importe:number;moneda:'EUR'|'COP';clasificacion:Clasificacion;
 evidencia:'extracto'|'captura'|'declaracion'|null;declarado_por:string|null;nota:string|null;comision:number|null;coste_bancario_total:number|null;
 coste_estado:EstadoCoste;estado:'activa'|'retirada';version:number;origen:OrigenVivo;
}
export interface UsoRetiro {
 id:string;lote_id:string;tipo:'pago_existente'|'declaracion';pago_id:string|null;compra_id:string|null;concepto:string;importe_efectivo:number;
 aporte_personal:number|null;aporte_reembolso:'reembolsable'|'no_reembolsable'|null;fecha:string|null;
 evidencia:'extracto'|'captura'|'declaracion'|'documento'|'ninguna';declarado_por:string|null;nota:string|null;estado:'activo'|'anulado';version:number;
 pago:{fecha:string;importe:number;estado:string;cuenta_nombre:string|null;aplicado:number}|null;compra:{id:string;concepto:string;documentos:number}|null;
 pago_vigente:boolean;sin_documento:boolean;
}
export interface HistorialRetiro { id:number;fecha:string;actor:string;accion:string;objeto_tipo:string;objeto_id:string;detalle:Record<string,unknown>|null }
export interface DetalleRetiro { item:LoteRetiro;fuentes:FuenteRetiro[];usos:UsoRetiro[];totales:TotalesRetiro;motivos:MotivoRetiro[];estado:'abierta'|'sin_pendientes';historial?:HistorialRetiro[] }
export interface CandidatosRetiro {
 traspasos:{id:string;fecha:string;moneda:'EUR'|'COP';importe:number;nota:string|null;cuenta_origen:string;cuenta_destino:string}[];
 movimientos:{id:string;tipo:string;fecha:string;moneda:'EUR'|'COP';importe:number;nota:string|null;cuenta:string|null}[];
 pagos:{id:string;fecha:string;moneda:'EUR'|'COP';importe:number;cuenta_nombre:string;compra_id:string;concepto:string;disponible:number}[];
}

export const clasificaciones:Record<Clasificacion,string>={cajero_verificado:'Cajero verificado',efectivo_declarado:'Efectivo declarado',traspaso_por_identificar:'Por identificar'};
export const estadosCoste:Record<EstadoCoste,string>={confirmado:'Confirmado',por_confirmar:'Por confirmar',autorizacion_pendiente:'Autorización pendiente'};
export const estadosOrigen:Record<EstadoOrigen,string>={activo:'Vigente',anulado:'Anulado en el libro',corregido:'Importe distinto al enlazado',no_encontrado:'No encontrado en el libro'};
export const evidencias:Record<string,string>={extracto:'Extracto',captura:'Captura',declaracion:'Declaración',documento:'Documento',ninguna:'Sin documento'};
export const reembolsos:Record<string,string>={reembolsable:'Reembolsable (solo informa)',no_reembolsable:'No reembolsable'};
export const acciones:Record<string,string>={retiro_lote_alta:'Lote creado',retiro_lote_cambio:'Lote editado',retiro_fuente_alta:'Salida enlazada',retiro_fuente_cambio:'Salida editada',retiro_uso_alta:'Uso añadido',retiro_uso_cambio:'Uso editado'};

type Dinero=(n:number)=>string;
/** Texto de cada motivo por el que el lote sigue abierto. Frases concretas, sin jerga. */
export function textoMotivo(m:MotivoRetiro,dinero:Dinero):string{
 const n=m.cantidad,plural=(uno:string,varios:string)=>n===1?uno:varios,imp=m.importe==null?'':dinero(m.importe);
 switch(m.codigo){
  case 'sin_fuentes':return 'Todavía no hay salidas del banco enlazadas.';
  case 'traspasos_por_identificar':return `${n} ${plural('traspaso','traspasos')} por identificar (${imp}): no se sabe quién los recibió ni si fueron efectivo.`;
  case 'diferencia_por_explicar':return `Faltan por explicar ${imp} entre las salidas del banco y los usos declarados.`;
  case 'usos_superan_salidas':return `Los usos declarados superan las salidas del banco en ${imp}.`;
  case 'origen_no_trazado':return `Se usaron ${imp} de efectivo sin origen confirmado. La caja puede quedar en negativo hasta trazarlo.`;
  case 'fuentes_anuladas':return `${n} ${plural('salida anulada','salidas anuladas')} en el libro (${imp}): siguen enlazadas, pero no suman.`;
  case 'fuentes_corregidas':return `${n} ${plural('salida tiene','salidas tienen')} un importe distinto al que se enlazó.`;
  case 'fuentes_sin_evidencia':return `${n} ${plural('salida sin','salidas sin')} extracto, captura ni declaración.`;
  case 'comisiones_por_confirmar':return `${n} ${plural('comisión','comisiones')} por confirmar.`;
  case 'fechas_desconocidas':return `${n} ${plural('uso sin fecha','usos sin fecha')}.`;
  case 'usos_sin_documento':return `${n} ${plural('uso sin documento','usos sin documento')}.`;
  case 'usos_declarados':return `${n} ${plural('uso declarado','usos declarados')} (${imp}) sin pago registrado.`;
  case 'usos_con_pago_anulado':return `${n} ${plural('uso','usos')} con el pago revertido (${imp}): no suma.`;
  default:return m.codigo;
 }
}
