import { expect,it } from 'vitest';
import { estadoAsignacion, intervaloAsignacion, madridAUTC, pendienteConductor, type DocumentoConductor } from './conductores-helpers';
it('convierte Madrid independientemente de la zona local y rechaza la hora inexistente',()=>{
 expect(madridAUTC('2026-11-26T10:30')).toBe('2026-11-26T09:30:00.000Z');
 expect(madridAUTC('2026-07-26T10:30')).toBe('2026-07-26T08:30:00.000Z');
 expect(()=>madridAUTC('2026-03-29T02:30')).toThrow(/no existe/);
});
it('exige elegir ocurrencia cuando una hora sucede dos veces y compara los instantes',()=>{
 expect(()=>madridAUTC('2026-10-25T02:30')).toThrow(/se repite/);
 expect(madridAUTC('2026-10-25T02:30','primera')).toBe('2026-10-25T00:30:00.000Z');
 expect(madridAUTC('2026-10-25T02:30','segunda')).toBe('2026-10-25T01:30:00.000Z');
 expect(intervaloAsignacion('2026-10-25T02:30','2026-10-25T02:15','primera','segunda').hasta).toBe('2026-10-25T01:15:00.000Z');
 expect(()=>intervaloAsignacion('2026-11-26T12:00','2026-11-26T11:59')).toThrow(/posterior/);
});
it('una asignación futura no se presenta como actual y el final es exclusivo',()=>{
 expect(estadoAsignacion({desde:'2026-11-26T10:00:00.000Z',hasta:null},'2026-11-26T09:59:00.000Z')).toBe('Programada');
 expect(estadoAsignacion({desde:'2026-11-26T09:00:00.000Z',hasta:'2026-11-26T10:00:00.000Z'},'2026-11-26T10:00:00.000Z')).toBe('Finalizada');
});
it('distingue por adjuntar, revisar y caducado, excluyendo retirados e históricos',()=>{
 const base:DocumentoConductor={id:'doc',nombre:'Documento ficticio',clase:'carnet',mime:'application/pdf',bytes:10,created_at:'2026-11-26',estado_revision:'pendiente'};
 expect(pendienteConductor([],'carnet','2026-11-26')).toBe('Por adjuntar');
 expect(pendienteConductor([base],'carnet','2026-11-26')).toBe('Por revisar');
 expect(pendienteConductor([{...base,vence:'2026-11-25'}],'carnet','2026-11-26')).toBe('Caducado');
 expect(pendienteConductor([{...base,estado_revision:'revisado',vence:'2026-12-26'}],'carnet','2026-11-26')).toBeNull();
 expect(pendienteConductor([{...base,estado_revision:'revisado',retirado_at:'2026-11-26'}],'carnet','2026-11-26')).toBe('Por adjuntar');
});
