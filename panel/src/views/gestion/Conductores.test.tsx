import { render, screen, waitFor,fireEvent,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect,it,vi } from 'vitest';
import { api } from '../../api/client';
import { ArchivoForm, AsignacionForm, ConductorDetail, ConductorForm } from './Conductores';
vi.mock('../../api/client',()=>({api:vi.fn()}));
const mocked=vi.mocked(api);
function mount(ui:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);}
beforeEach(()=>{mocked.mockReset();});
it('conserva los datos tras conflicto y no inventa campos opcionales',async()=>{
 const user=userEvent.setup(),close=vi.fn();mocked.mockImplementation(async()=>{throw new Error('version_conflict');});
 mount(<ConductorForm close={close}/>);
 await user.type(screen.getByLabelText('Nombre completo'),'Persona ficticia');await user.type(screen.getByLabelText('Teléfono'),'600000000');await user.click(screen.getByRole('button',{name:'Guardar'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/Otra persona actualizó/);expect(screen.getByLabelText('Nombre completo')).toHaveValue('Persona ficticia');expect(close).not.toHaveBeenCalled();
 const init=mocked.mock.calls[0]?.[1];const body=JSON.parse(String(init?.body));expect(body.identidad_numero).toBeNull();expect(body.carnet_numero).toBeNull();expect(body.nombre).toBe('Persona ficticia');expect(body.telefono).toBe('600000000');
});
it('no envía una asignación invertida y conserva las horas para corregirla',async()=>{
 const user=userEvent.setup();mocked.mockResolvedValue({items:[{id:'v1',referencia:'Vehículo ficticio'}]});
 mount(<AsignacionForm conductorId="c1" close={vi.fn()}/>);
 await screen.findByRole('option',{name:'Vehículo ficticio'});await user.selectOptions(screen.getByLabelText('Vehículo'),'v1');
 const desde=screen.getByLabelText('Desde · Europe/Madrid'),hasta=screen.getByLabelText('Hasta · Europe/Madrid (opcional)');
 fireEvent.change(desde,{target:{value:'2026-11-26T12:00'}});fireEvent.change(hasta,{target:{value:'2026-11-26T11:00'}});
 await user.click(screen.getByRole('button',{name:'Guardar'}));expect(await screen.findByRole('alert')).toHaveTextContent(/posterior/);expect(desde).toHaveValue('2026-11-26T12:00');expect(mocked.mock.calls.filter(([,init])=>init?.method)).toHaveLength(0);
 fireEvent.change(hasta,{target:{value:'2026-11-26T13:00'}});await user.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(mocked.mock.calls.some(([path])=>path.includes('/asignaciones'))).toBe(true));
 const sent=mocked.mock.calls.find(([path])=>path.includes('/asignaciones'));expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({desde:'2026-11-26T11:00:00.000Z',hasta:'2026-11-26T12:00:00.000Z'});
});

it('un solapamiento conserva el formulario y explica cómo corregirlo',async()=>{
 const user=userEvent.setup(),close=vi.fn();mocked.mockImplementation(async(_path,init)=>{if(init?.method)throw new Error('asignacion_solapada');return {items:[{id:'v1',referencia:'Vehículo ficticio'}]} as never;});
 mount(<AsignacionForm conductorId="c1" close={close}/>);await screen.findByRole('option',{name:'Vehículo ficticio'});await user.selectOptions(screen.getByLabelText('Vehículo'),'v1');fireEvent.change(screen.getByLabelText('Desde · Europe/Madrid'),{target:{value:'2026-11-26T12:00'}});await user.click(screen.getByRole('button',{name:'Guardar'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/ya tiene una asignación/);expect(screen.getByLabelText('Desde · Europe/Madrid')).toHaveValue('2026-11-26T12:00');expect(close).not.toHaveBeenCalled();
});

it('un archivo duplicado ofrece revisar el existente y reclasificarlo como pendiente',async()=>{
 const user=userEvent.setup(),close=vi.fn();const existing={id:'d1',nombre:'otros.pdf',clase:'otros',mime:'application/pdf',bytes:10,created_at:'2026-11-26',metadata_version:3,estado_revision:'revisado'};
 mocked.mockImplementation(async(_path,init)=>init?.method==='PATCH'?{item:existing} as never:{item:existing,duplicado:true} as never);
 mount(<ArchivoForm conductorId="c1" clase="otros" close={close}/>);const upload=screen.getByLabelText(/PDF, JPG, PNG o WebP/) as HTMLInputElement;await user.upload(upload,new File(['%PDF-ficticio'],'ficticio.pdf',{type:'application/pdf'}));fireEvent.submit(upload.form!);
 expect(await screen.findByRole('status')).toHaveTextContent('Ya estaba adjuntado');expect(close).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'Revisar documento existente'}));
 const review=within(screen.getByRole('dialog',{name:'Revisar otros.pdf'}));await user.selectOptions(review.getByLabelText('Tipo de documento'),'identidad');await user.selectOptions(review.getByLabelText('Estado de revisión'),'pendiente');await user.click(review.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(mocked.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(true));const patched=mocked.mock.calls.find(([,init])=>init?.method==='PATCH');expect(patched?.[0]).toBe('/api/admin/gestion/conductores/c1/documentos/d1');expect(JSON.parse(String(patched?.[1]?.body))).toMatchObject({clase:'identidad',metadata_version:3,estado_revision:'pendiente'});
});
it('retirar oculta los enlaces y restaurar desde históricos exige la versión actual',async()=>{
 const user=userEvent.setup();let doc={id:'d1',nombre:'carnet.pdf',clase:'carnet',mime:'application/pdf',bytes:10,created_at:'2026-11-26',metadata_version:2,estado_revision:'pendiente',retirado_at:null as string|null};
 mocked.mockImplementation(async(path,init)=>{
  if(init?.method==='PATCH'){const body=JSON.parse(String(init.body));doc={...doc,retirado_at:body.retirado?'2026-11-26T10:00:00.000Z':null,metadata_version:doc.metadata_version+1,estado_revision:'pendiente'};return {item:{...doc}} as never;}
  if(path.endsWith('/documentos'))return {items:[{...doc}]} as never;
  return {item:{id:'c1',nombre:'Persona ficticia',telefono:'600000000',estado:'activo'},asignaciones:[]} as never;
 });
 mount(<MemoryRouter><ConductorDetail id="c1" close={vi.fn()}/></MemoryRouter>);await user.click(await screen.findByRole('button',{name:'Revisar carnet.pdf'}));
 const review=within(screen.getByRole('dialog',{name:'Revisar carnet.pdf'}));await user.selectOptions(review.getByLabelText('Estado de revisión'),'retirado');await user.click(review.getByRole('checkbox',{name:'Retirar este archivo del acceso y conservar su historial.'}));await user.click(review.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Revisar carnet.pdf'})).not.toBeInTheDocument());await user.click(screen.getByRole('checkbox',{name:'Mostrar históricos'}));expect(await screen.findByText('Archivo retirado')).toBeInTheDocument();expect(screen.queryByRole('link',{name:'Ver carnet.pdf'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Descargar carnet.pdf'})).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Restaurar al expediente'}));expect(await screen.findByRole('link',{name:'Ver carnet.pdf'})).toBeInTheDocument();const patches=mocked.mock.calls.filter(([,init])=>init?.method==='PATCH').map(([,init])=>JSON.parse(String(init?.body)));expect(patches).toEqual([{metadata_version:2,retirado:true},{metadata_version:3,retirado:false}]);
});
