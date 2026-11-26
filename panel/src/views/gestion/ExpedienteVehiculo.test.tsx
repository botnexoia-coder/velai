import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpedienteVehiculo } from './ExpedienteVehiculo';
import type { DocumentoVehiculo } from './vehiculos-expediente';
const state=vi.hoisted(()=>({items:[] as DocumentoVehiculo[],save:vi.fn()}));
vi.mock('./shared',async importOriginal=>({...await importOriginal<typeof import('./shared')>(),useGestion:()=>({data:{items:state.items},isPending:false,error:null}),useGuardar:()=>({mutateAsync:state.save})}));
const vehicle={id:'v1',referencia:'Furgón de prueba',matricula:'SE 178M',marca:'Ford',modelo:'Custom',vin:null};
const doc=(more:Partial<DocumentoVehiculo>={}):DocumentoVehiculo=>({id:'d1',nombre:'Póliza.pdf',clase:'seguro',mime:'application/pdf',bytes:200,created_at:'2026-11-01',created_by:'socio',metadata_version:2,...more});
const NativeFormData=FormData;
beforeEach(()=>{state.items=[];state.save.mockReset();
 // jsdom keeps the native file list empty after userEvent.upload. Read its public
 // files property as browsers do, preserving native FormData for every other field.
 vi.stubGlobal('FormData',class extends NativeFormData{constructor(form?:HTMLFormElement){super(form);form?.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(input=>{if(input.files?.[0])this.set(input.name,input.files[0]);});}});
});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('mantiene país/tipo desconocidos y muestra históricos solo al pedirlos',async()=>{
 const user=userEvent.setup();state.items=[doc(),doc({id:'old',nombre:'Póliza anterior',estado_revision:'sustituido'})];render(<ExpedienteVehiculo vehiculo={vehicle} editar={()=>{}}/>);expect(screen.getByText(/País: por confirmar/)).toBeInTheDocument();expect(screen.queryByText(/provisional confirmada/)).not.toBeInTheDocument();expect(screen.getByText('Sin foto del vehículo')).toBeInTheDocument();expect(screen.queryByText('Póliza anterior')).not.toBeInTheDocument();await user.click(screen.getByRole('checkbox',{name:'Mostrar históricos'}));expect(screen.getByText('Póliza anterior')).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Permiso de circulación'}));expect(screen.getByRole('heading',{name:'Permiso de circulación'})).toBeInTheDocument();expect(screen.queryByText('Póliza.pdf')).not.toBeInTheDocument();
});
async function upload(){const user=userEvent.setup();await user.click(screen.getByRole('button',{name:/Añadir documento/}));const dialog=screen.getByRole('dialog');await user.type(within(dialog).getByLabelText('Nombre del archivo'),'Seguro');await user.upload(within(dialog).getByLabelText(/Archivo PDF/),new File(['pdf'],'seguro.pdf',{type:'application/pdf'}));expect(within(dialog).getByLabelText('Nombre del archivo')).toHaveValue('Seguro');expect((within(dialog).getByLabelText(/Archivo PDF/) as HTMLInputElement).files).toHaveLength(1);await act(async()=>{fireEvent.submit(dialog.querySelector('form')!);});return {user,dialog};}
it('un duplicado no altera metadatos y ofrece editar el original',async()=>{
 state.save.mockResolvedValue({item:doc(),duplicado:true});render(<ExpedienteVehiculo vehiculo={vehicle} editar={()=>{}}/>);const {user}=await upload();expect(await screen.findByRole('button',{name:'Editar el documento existente'})).toBeInTheDocument();expect(state.save).toHaveBeenCalledTimes(1);await user.click(screen.getByRole('button',{name:'Editar el documento existente'}));expect(screen.getByRole('dialog',{name:/Datos del documento/})).toBeInTheDocument();
});
it('tras fallo de metadatos reintenta sin volver a adjuntar el archivo',async()=>{
 state.save.mockResolvedValueOnce({item:doc()}).mockRejectedValueOnce(new Error('network_failed')).mockResolvedValueOnce({item:doc()});render(<ExpedienteVehiculo vehiculo={vehicle} editar={()=>{}}/>);const {dialog}=await upload();expect(await screen.findByText(/El original ya se ha adjuntado/)).toBeInTheDocument();await act(async()=>{fireEvent.submit(dialog.querySelector('form')!);});expect(state.save.mock.calls.map(([arg])=>arg.method||'POST')).toEqual(['POST','PATCH','PATCH']);expect(state.save.mock.calls[2]![0].body).toMatchObject({metadata_version:2,estado_revision:'pendiente'});
});
it('conflicto conserva notas y versión del formulario',async()=>{
 const user=userEvent.setup();state.items=[doc()];state.save.mockRejectedValue(new Error('version_conflict'));render(<ExpedienteVehiculo vehiculo={vehicle} editar={()=>{}}/>);await user.click(screen.getByRole('button',{name:'Editar datos de Póliza.pdf'}));const dialog=screen.getByRole('dialog');await user.type(within(dialog).getByLabelText('Notas'),'Conservar esta revisión');await user.click(within(dialog).getByRole('button',{name:'Guardar'}));expect(await screen.findByRole('alert')).toHaveTextContent(/Otra persona/);expect(within(dialog).getByLabelText('Notas')).toHaveValue('Conservar esta revisión');expect(state.save.mock.calls[0]![0].body.metadata_version).toBe(2);
});

it('permite registrar revisión de un original histórico y mantiene fecha caducada',async()=>{
 const user=userEvent.setup();state.items=[doc({vence:'2020-01-01'})];state.save.mockResolvedValue({item:doc()});render(<ExpedienteVehiculo vehiculo={vehicle} editar={()=>{}}/>);expect(screen.getByText('Caducado')).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Editar datos de Póliza.pdf'}));const dialog=screen.getByRole('dialog');await user.selectOptions(within(dialog).getByRole('combobox',{name:'Estado de revisión'}),'revisado');await user.click(within(dialog).getByRole('checkbox'));await user.click(within(dialog).getByRole('button',{name:'Guardar'}));expect(state.save.mock.calls[0]![0].body).toMatchObject({estado_revision:'revisado',revision_confirmada:true,vence:'2020-01-01'});
});
