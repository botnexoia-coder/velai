export interface PrestamoEquipo {
 id:string;titulo:string;cuenta_id:string;importe:number;fecha_solicitud:string;vencimiento:string;
 estado:'solicitado'|'aprobado'|'vigente'|'vencido'|'devuelto'|'cancelado';
 participantes:{email:string;nombre:string;importe:number;devuelto?:number;pendiente?:number}[];
 destino_titular?:string|null;destino_referencia?:string|null;
 devuelto:number;pendiente:number;version:number;aprobado_por:string|null;fecha_desembolso:string|null;nota:string|null;
}
export interface FondoEquipo {
 items:PrestamoEquipo[];
 resumen:{limite:number;pendiente:number;disponible_limite:number;vencido:number;solicitudes:number};
 capacidad:{disponible:number;cuentas:{id:string;nombre:string;disponible:number}[];reserva:number;compromisos:number};
 storage_ready:boolean;
}
export interface DetalleEquipo {
 item:PrestamoEquipo;
 pagos:{id:string;fecha:string;importe:number;participante_email:string;estado:string}[];
}
export const estadosEquipo:Record<PrestamoEquipo['estado'],string>={solicitado:'Pendiente de aprobación',aprobado:'Aprobado · sin entregar',vigente:'En curso',vencido:'Devolución vencida',devuelto:'Devuelto',cancelado:'Cancelado'};
