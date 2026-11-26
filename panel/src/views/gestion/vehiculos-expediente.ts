import type { Documento } from './shared';

export const carpetas = {circulacion:'Circulación e ITV',seguros:'Seguros',mantenimiento:'Mantenimiento',multas:'Multas',gps:'GPS y servicios',compraventa:'Compra y venta',otros:'Otros'} as const;
export type Carpeta = keyof typeof carpetas;
export type EstadoDocumento = 'pendiente'|'revisado'|'caducado'|'programado'|'sustituido';
export interface DocumentoVehiculo extends Documento {categoria_documental?:string|null;estado_revision?:'pendiente'|'revisado'|'sustituido';revisado_por?:string|null;revisado_at?:string|null;fecha_inicio?:string|null;nota?:string|null;kilometros?:number|null;metadata_version?:number}
export interface MatriculaDatos {matricula?:string|null;matricula_tipo?:string|null;matricula_pais?:string|null;matriculas_anteriores?:({matricula:string}|string)[]}
const porClase:Record<string,Carpeta>={permiso_circulacion:'circulacion',ficha_tecnica:'circulacion',itv:'circulacion',placas:'circulacion',seguro:'seguros',contrato_compra:'compraventa',contrato_venta:'compraventa',mantenimiento:'mantenimiento',multa:'multas',gps:'gps',compraventa:'compraventa'};
export const categoriasDocumento = {permiso_circulacion:'Permiso de circulación',ficha_tecnica:'Ficha técnica',itv:'ITV',seguro:'Póliza de seguro',mantenimiento:'Mantenimiento',multa:'Multa',gps:'GPS y servicios',compraventa:'Compra y venta',foto:'Foto',otros:'Otros'};
export function categoriaDocumento(d:DocumentoVehiculo){if(d.categoria_documental&&d.categoria_documental in categoriasDocumento)return d.categoria_documental;if(d.clase in categoriasDocumento)return d.clase;if(['contrato_compra','contrato_venta'].includes(d.clase))return 'compraventa';return 'otros';}
export const hoyExpediente=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function carpetaDocumento(d:DocumentoVehiculo):Carpeta {return porClase[categoriaDocumento(d)]||'otros';}
export function estadoDocumento(d:DocumentoVehiculo,hoy:string):EstadoDocumento {
 if(d.estado_revision==='sustituido')return 'sustituido';
 if(d.vence&&d.vence<hoy)return 'caducado';
 if(d.fecha_inicio&&d.fecha_inicio>hoy)return 'programado';
 return d.estado_revision||'pendiente';
}
export const estadoDocumentoLabel:Record<EstadoDocumento,string>={pendiente:'Pendiente de revisar',revisado:'Revisión registrada',programado:'Aún no iniciado',caducado:'Caducado',sustituido:'Sustituido'};
export function normalizarBusqueda(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[\s-]+/g,'');}
export function coincideVehiculo(v:MatriculaDatos&{referencia:string;marca?:string|null;modelo?:string|null},busqueda:string){
 const q=normalizarBusqueda(busqueda);return !q||[v.matricula,v.referencia,v.marca,v.modelo,[v.marca,v.modelo].filter(Boolean).join(' '),...(v.matriculas_anteriores||[]).map(x=>typeof x==='string'?x:x.matricula)].some(x=>normalizarBusqueda(x||'').includes(q));
}
export const requisitos=[{id:'permiso',label:'Permiso de circulación',clases:['permiso_circulacion']},{id:'ficha',label:'Ficha técnica',clases:['ficha_tecnica']},{id:'itv',label:'ITV',clases:['itv']},{id:'seguro',label:'Seguro',clases:['seguro']}];
export function revisarRequisito(docs:DocumentoVehiculo[],clases:string[],hoy:string){
 const matching=docs.filter(d=>clases.includes(categoriaDocumento(d))&&estadoDocumento(d,hoy)!=='sustituido');
 if(!matching.length)return 'Falta adjuntar';
 if(matching.some(d=>estadoDocumento(d,hoy)==='revisado'))return null;
 if(matching.some(d=>['pendiente','programado'].includes(estadoDocumento(d,hoy))))return 'Pendiente de revisar';
 return 'Caducado';
}
