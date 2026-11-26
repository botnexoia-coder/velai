import { expect, it, vi } from 'vitest';
import { carpetaDocumento, coincideVehiculo, estadoDocumento, hoyExpediente, revisarRequisito, type DocumentoVehiculo } from './vehiculos-expediente';
const doc=(more:Partial<DocumentoVehiculo>={}):DocumentoVehiculo=>({id:'doc',nombre:'Seguro.pdf',clase:'otro',mime:'application/pdf',bytes:100,created_at:'2026-11-01',created_by:'socio',...more});
it('respeta vencimiento inclusive, futuro y sustitución antes de la revisión humana',()=>{
 const reviewed=doc({estado_revision:'revisado',vence:'2026-11-26'});
 expect(estadoDocumento(reviewed,'2026-11-26')).toBe('revisado');expect(estadoDocumento(reviewed,'2026-11-27')).toBe('caducado');expect(estadoDocumento({...reviewed,fecha_inicio:'2026-11-28',vence:null},'2026-11-27')).toBe('programado');expect(estadoDocumento({...reviewed,estado_revision:'sustituido'},'2026-11-27')).toBe('sustituido');expect(estadoDocumento(doc(),'2026-11-26')).toBe('pendiente');
});
it('no deduce categoría del nombre y conserva clases inequívocas',()=>{
 expect(carpetaDocumento(doc({nombre:'POLIZA-SEGURO.pdf'}))).toBe('otros');expect(carpetaDocumento(doc({clase:'seguro'}))).toBe('seguros');expect(carpetaDocumento(doc({categoria_documental:'mantenimiento'}))).toBe('mantenimiento');expect(carpetaDocumento(doc({clase:'contrato_venta'}))).toBe('compraventa');
});
it('un archivo presente no acredita revisión y uno sustituido no cubre el requisito',()=>{
 expect(revisarRequisito([],['seguro'],'2026-11-26')).toBe('Falta adjuntar');expect(revisarRequisito([doc({clase:'seguro'})],['seguro'],'2026-11-26')).toBe('Pendiente de revisar');expect(revisarRequisito([doc({clase:'seguro',estado_revision:'sustituido'})],['seguro'],'2026-11-26')).toBe('Falta adjuntar');expect(revisarRequisito([doc({clase:'seguro',estado_revision:'revisado',vence:'2026-11-25'})],['seguro'],'2026-11-26')).toBe('Caducado');
});
it('busca matrícula actual y anterior normalizando espacios/guiones y marca/modelo',()=>{
 const v={referencia:'Furgón uno',matricula:'SE 178-M',matriculas_anteriores:[{matricula:'ABC-12'}],marca:'Ford',modelo:'Transit Custom'};for(const q of ['se178m','ABC 12','Ford Transit','furgon-uno','TransitCustom'])expect(coincideVehiculo(v,q)).toBe(true);expect(coincideVehiculo(v,'SE179')).toBe(false);
});
it('usa el día de Madrid en el cambio de fecha UTC',()=>{vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-11-26T23:30:00Z'));expect(hoyExpediente()).toBe('2026-11-27');}finally{vi.useRealTimers();}});
