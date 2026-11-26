/** Regularización histórica: el dinero YA salió. Ratificación y conciliación son estados propios, no aprobación. */
export interface HistoricoEquipo {
 origen:'regularizacion_historica';estado:'borrador'|'confirmado';
 deudor_declarado:string;destinatario:string;motivo_excepcion:string;
 ratificacion:'pendiente'|'ratificada'|'rechazada';ratificado_por:string|null;ratificado_at:string|null;
 desvios:string[];confirmado_por:string|null;confirmado_at:string|null;
 credito:{id:string;cuota:number;importe_cuota:number;importe_adicional:number;fecha_cuota_proyectada:string;fecha_confirmada:false}|null;
 /** Parte del pendiente tomada de la cuota del crédito recibido (no reduce ni paga la reserva). */
 reserva_prestada:number|null;
 /** Parte del pendiente que no corresponde a la cuota. reserva_prestada + resto_libre = pendiente. */
 resto_libre:number|null;
}
export interface PrestamoEquipo {
 id:string;titulo:string;cuenta_id:string;importe:number;fecha_solicitud:string;vencimiento:string;
 estado:'solicitado'|'borrador_historico'|'aprobado'|'vigente'|'vencido'|'devuelto'|'cancelado';
 participantes:{email:string;nombre:string;importe:number;devuelto?:number;pendiente?:number}[];
 destino_titular?:string|null;destino_referencia?:string|null;
 devuelto:number;pendiente:number;version:number;aprobado_por:string|null;fecha_desembolso:string|null;nota:string|null;
 historico?:HistoricoEquipo|null;
}
export interface FondoEquipo {
 items:PrestamoEquipo[];
 resumen:{limite:number;limite_persona?:number;pendiente:number;disponible_limite:number;vencido:number;solicitudes:number;
  historicos?:{pendiente:number;reserva_prestada:number;resto_libre:number;pendiente_ratificacion:number;borradores:number}};
 capacidad:{disponible:number;cuentas:{id:string;nombre:string;disponible:number}[];reserva:number;compromisos:number};
 storage_ready:boolean;
}
export interface DetalleEquipo {
 item:PrestamoEquipo;
 pagos:{id:string;fecha:string;importe:number;participante_email:string;estado:string}[];
}
export const estadosEquipo:Record<PrestamoEquipo['estado'],string>={solicitado:'Pendiente de aprobación',borrador_historico:'Borrador histórico · sin movimiento',aprobado:'Aprobado · sin entregar',vigente:'En curso',vencido:'Devolución vencida',devuelto:'Devuelto',cancelado:'Cancelado'};
export const desviosEquipo:Record<string,string>={sin_aprobacion_independiente:'Aprobación independiente previa no registrada',plazo_superior_a_un_mes:'Plazo superior a un mes',cuenta_no_conciliada:'Cuenta de origen no conciliada',liquidez_insuficiente:'Liquidez insuficiente según la política ordinaria',fondos_de_cuota_prestados:'Fondos de una cuota del crédito recibido prestados temporalmente'};
export const ratificacionEquipo:Record<HistoricoEquipo['ratificacion'],string>={pendiente:'Pendiente de ratificación independiente',ratificada:'Ratificada',rechazada:'Rechazada'};
