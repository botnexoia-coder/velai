export interface Conductor {id:string;nombre:string;telefono:string;email:string|null;estado:'activo'|'inactivo';identidad_tipo:string|null;identidad_numero:string|null;identidad_vence:string|null;carnet_numero:string|null;carnet_categorias:string|null;carnet_vence:string|null;permiso_trabajo_vence:string|null;contacto_emergencia_nombre:string|null;contacto_emergencia_telefono:string|null;nota:string|null;version:number}
export interface AsignacionConductor {id:string;vehiculo_id:string;conductor_id:string;referencia?:string;matricula?:string|null;desde:string;hasta:string|null;nota:string|null;version:number}
export interface DocumentoConductor {id:string;nombre:string;clase:string;categoria_documental?:string|null;mime:string;bytes:number;created_at:string;vence?:string|null;fecha_inicio?:string|null;estado_revision?:string;metadata_version?:number;nota?:string|null;revisado_at?:string|null;revisado_por?:string|null;retirado_at?:string|null;ultima_revision_at?:string|null;ultima_revision_por?:string|null}
const madrid=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function fechaHoraMadrid(iso:string){const date=new Date(iso);return Number.isFinite(date.getTime())?madrid.format(date).replace(' ','T'):'';}
export function madridAUTC(value:string,repetida=''){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Indica una fecha y una hora válidas.');
 const center=Date.parse(`${value}:00Z`);const candidates:string[]=[];
 for(let offset=-180;offset<=180;offset+=15){const instant=new Date(center+offset*60000).toISOString();if(fechaHoraMadrid(instant)===value)candidates.push(instant);}
 if(!candidates.length)throw new Error('Esa hora no existe en Europe/Madrid por el cambio de hora. Elige otra hora.');
 if(candidates.length>1&&!['primera','segunda'].includes(repetida))throw new Error('Esa hora se repite en Europe/Madrid. Elige la primera o la segunda ocurrencia.');
 return candidates[repetida==='segunda'?candidates.length-1:0]!;
}
export function intervaloAsignacion(desde:string,hasta:string,repetidaDesde='',repetidaHasta=''){
 const inicio=madridAUTC(desde,repetidaDesde),fin=hasta?madridAUTC(hasta,repetidaHasta):null;
 if(fin&&fin<=inicio)throw new Error('El final debe ser posterior al inicio.');
 return {desde:inicio,hasta:fin};
}
export function estadoAsignacion(a:Pick<AsignacionConductor,'desde'|'hasta'>,ahora=new Date().toISOString()){
 const now=Date.parse(ahora);return Date.parse(a.desde)>now?'Programada':a.hasta&&Date.parse(a.hasta)<=now?'Finalizada':'Actual';
}
export const clasesConductor:Record<string,string>={identidad:'Identidad',carnet:'Permiso de conducir',permiso_trabajo:'Permiso de trabajo',foto:'Foto',otros:'Otros'};
export function claseConductor(d:DocumentoConductor){return d.categoria_documental||d.clase;}
export function estadoArchivo(d:DocumentoConductor,hoy:string){
 if(d.retirado_at)return 'Retirado';
 if(d.estado_revision==='sustituido')return 'Histórico';
 if(d.vence&&d.vence<hoy)return 'Caducado';
 if(d.estado_revision!=='revisado'||(d.fecha_inicio&&d.fecha_inicio>hoy))return 'Por revisar';
 return 'Revisión registrada';
}
export function pendienteConductor(docs:DocumentoConductor[],clase:string,hoy:string){
 const actuales=docs.filter(d=>claseConductor(d)===clase&&d.estado_revision!=='sustituido'&&!d.retirado_at);
 if(!actuales.length)return 'Por adjuntar';
 if(actuales.every(d=>estadoArchivo(d,hoy)==='Caducado'))return 'Caducado';
 return actuales.some(d=>estadoArchivo(d,hoy)==='Revisión registrada')?null:'Por revisar';
}
