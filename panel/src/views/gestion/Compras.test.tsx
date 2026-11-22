import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/queryClient';
import { ConfirmarHost } from '../../components/Confirmar';
import { Compras, VehicleFields } from './Compras';
import { EntityOptions, amount, datosCosteVehiculo, clasificarCosteVehiculo, notaLibreVehiculo, FormModal } from './shared';
const previewMode=vi.hoisted(()=>({value:false}));
vi.mock('../../mobilePreview',async importOriginal=>({...await importOriginal<typeof import('../../mobilePreview')>(),get MOBILE_PREVIEW(){return previewMode.value;}}));

function mount({ socio=true, bought=false, retry=false, entities=false, extended=false, paid=0, editError='', initialUrl='/compras' }={}) {
 const calls:{path:string;method:string;body?:Record<string,unknown>}[]=[];
 let failed=false, estimate=90000;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(String(input),'https://panel.test'),method=init?.method||'GET';
  calls.push({path:url.pathname,method,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(method!=='GET') {
   if(editError&&method==='PATCH'&&!failed){failed=true;return Response.json({error:editError},{status:409});}
   if(method==='PATCH'&&url.pathname==='/api/admin/gestion/compras/compra'){const body=JSON.parse(String(init?.body));if(typeof body.estimado==='number')estimate=body.estimado;}
   if(retry&&!failed){failed=true;return Response.json({error:'network_failed'},{status:503});}
   return Response.json({item:{id:'nuevo'}});
  }
  const data:Record<string,unknown>={
   '/api/admin/me':{role:'velai',socio,tenantId:null},
   '/api/admin/gestion/catalogos':{entidades:[],cuentas:[{id:'cuenta',nombre:'Cuenta común',moneda:'EUR',saldo_inicial:0,version:1}],socios:[{email:'uno@velai.test',nombre:'Persona Uno'},{email:'dos@velai.test',nombre:'Persona Dos'}],eventos:[{id:'evento-naya',name:'Fiesta · QA',tenant_name:'NAYA'}]},
   '/api/admin/gestion/prestamos':{items:[]},
   '/api/admin/gestion/compras':{items:[...(extended?[{id:'idea',concepto:'Idea de grabación',negocio:'dialogos',moneda:'EUR',estimado:25000,real:null,estado:'prevista',version:2,pagado:12500,pendiente:12500,documentos_count:0,hecho:0,evento_id:null,plan_pagos:[{fecha:'2026-10-14',importe:12500},{fecha:'2026-10-15',importe:12500}]},{id:'evento',concepto:'Artista evento',negocio:'dialogos',moneda:'EUR',estimado:10000,real:null,estado:'prevista',version:1,pagado:0,pendiente:10000,documentos_count:0,hecho:1,evento_id:'evento-naya'}]:[]),{id:'compra',concepto:'Equipo de ejemplo',negocio:'dialogos',moneda:'EUR',estimado:estimate,real:bought?79675:null,estado:bought?'comprada':'comprometida',comprador:'Persona Uno',proveedor:null,categoria:'Equipo',version:1,pagado:paid,pendiente:(bought?79675:estimate)-paid,documentos_count:0}]},
   '/api/admin/gestion/terceros':{items:[{id:'empresa-qa',nombre:'Proveedor ficticio'}]},
   '/api/admin/gestion/documentos':{items:[]},
   '/api/admin/gestion/compras/compra/pagos':{items:[]},
  };
  if(url.pathname==='/api/admin/gestion/compras/compra')return Response.json({item:(data['/api/admin/gestion/compras'] as {items:unknown[]}).items.at(-1)});
  return Response.json(data[url.pathname]||{});
 }));
 render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={[initialUrl]}><Routes><Route path="/compras" element={entities?<EntityOptions onDone={()=>{}}/>:<Compras/>}/><Route path="/" element={<h1>Inicio</h1>}/></Routes><ConfirmarHost/></MemoryRouter></QueryClientProvider>);
 return {calls,user:userEvent.setup()};
}
afterEach(()=>{vi.unstubAllGlobals();previewMode.value=false;});

it('no consulta finanzas si el usuario no es socio',async()=>{
 const {calls}=mount({socio:false});
 await screen.findByRole('heading',{name:'Inicio'});
 expect(calls.some(c=>c.path.includes('/gestion/'))).toBe(false);
});

it('confirmar compra registra el importe real sin inventar un pago',async()=>{
 const {calls,user}=mount();
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));
 await user.click(screen.getByRole('button',{name:'Se compró'}));
 const dialog=within(screen.getByRole('dialog',{name:'Confirmar compra realizada'}));
 await user.clear(dialog.getByLabelText('Importe real (EUR)'));
 await user.type(dialog.getByLabelText('Importe real (EUR)'),'796,75');
 await user.selectOptions(dialog.getByRole('combobox',{name:'Proveedor'}),'Proveedor ficticio');
 await user.click(dialog.getByRole('button',{name:'Confirmar compra'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Confirmar compra realizada'})).not.toBeInTheDocument());
 expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({version:1,real:79675,fecha:null,comprador:'Persona Uno'});
 expect(calls.some(c=>c.method==='POST'&&c.path.endsWith('/pagos'))).toBe(false);
});

it('pago de cuenta común no atribuye deuda al comprador y conserva ID al reintentar',async()=>{
 const {calls,user}=mount({bought:true,retry:true});
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));
 await user.click(screen.getByRole('button',{name:'Registrar pago'}));
 const dialog=within(screen.getByRole('dialog',{name:'Registrar pago de la compra'}));
 await user.selectOptions(dialog.getByLabelText('Cuenta desde la que se pagó'),'cuenta');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 expect(await dialog.findByRole('alert')).toHaveTextContent('puedes reintentar');
 expect(dialog.getByLabelText('Importe pagado (EUR)')).toHaveValue('796.75');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Registrar pago de la compra'})).not.toBeInTheDocument());
 const posts=calls.filter(c=>c.method==='POST');
 expect(posts).toHaveLength(2);expect(posts[1]?.body).toEqual(posts[0]?.body);
 expect(posts[0]?.body).toMatchObject({importe:79675,pagador:'cuenta',cuenta_id:'cuenta',socio:null});
});

it('puede crear una cuenta sin saldo inicial ni titular confirmado',async()=>{
 const {calls,user}=mount({entities:true});
 await user.click(await screen.findByRole('button',{name:'Añadir cuenta'}));
 const dialog=within(screen.getByRole('dialog',{name:'Cuenta del proyecto'}));
 await user.type(dialog.getByLabelText('Nombre de la cuenta'),'Cuenta del proyecto');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({saldo_inicial:0,entidad_id:null,conciliada:0});
});

it('distingue importe cero válido de un campo vacío y conserva céntimos',()=>{
 const d=new FormData();expect(()=>amount(d,'importe')).toThrow();
 d.set('importe','0');expect(amount(d,'importe')).toBe(0);
 d.set('importe','0,29');expect(amount(d,'importe')).toBe(29);
});

it('Hecho actualiza solamente avance, sin registrar compra ni pago',async()=>{
 const {calls,user}=mount({extended:true});
 await user.click(await screen.findByRole('checkbox',{name:'Hecho: Idea de grabación'}));
 await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));
 const patch=calls.find(c=>c.method==='PATCH');
 expect(patch?.body).toEqual({version:2,hecho:true});
 expect(patch?.path).toBe('/api/admin/gestion/compras/idea');
 expect(calls.some(c=>c.method==='POST')).toBe(false);
});
it('separa Diálogos sin evento y muestra cuotas previstas con anticipos descontados',async()=>{
 const {user}=mount({extended:true});
 await screen.findByRole('button',{name:'Idea de grabación'});
 await user.selectOptions(screen.getByLabelText('Proyecto'),'dialogos');
 expect(screen.queryByRole('button',{name:'Artista evento'})).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Idea de grabación'}));
 const detail=within(screen.getByRole('dialog',{name:'Idea de grabación'}));
 expect(detail.getByText('14/10/2026')).toBeInTheDocument();
 expect(detail.getByText('15/10/2026')).toBeInTheDocument();
 expect(detail.getByText(/anticipos de socios ya pagados/)).toBeInTheDocument();
 const cuotas=detail.getByRole('table');
 expect(within(cuotas).getAllByRole('row')[1]).toHaveTextContent('€ 0,00');
 expect(within(cuotas).getAllByRole('row')[2]).toHaveTextContent('€ 125,00');
});
it('crear previsión guarda evento y plan de dos cuotas sin pago',async()=>{
 const {calls,user}=mount({extended:true,initialUrl:'/compras?evento_id=evento-naya'});
 await user.click(await screen.findByRole('button',{name:'Añadir compra'}));
 const form=within(screen.getByRole('dialog',{name:'Añadir compra prevista'}));
 expect(form.getByLabelText('Negocio')).toHaveValue('dialogos');
 expect(form.getByLabelText(/Evento \(opcional\)/)).toHaveValue('evento-naya');
 await user.type(form.getByLabelText('Qué vamos a comprar'),'Prueba de grabación');
 await user.type(form.getByLabelText('Importe previsto'),'250');
 await user.type(form.getByLabelText('Fecha cuota 1'),'2026-10-14');
 await user.type(form.getByLabelText('Importe cuota 1'),'125');
 await user.type(form.getByLabelText('Fecha cuota 2'),'2026-10-15');
 await user.type(form.getByLabelText('Importe cuota 2'),'125');
 await user.click(form.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(calls.some(c=>c.method==='POST')).toBe(true));
 expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({evento_id:'evento-naya',negocio:'dialogos',estimado:25000,plan_pagos:[{fecha:'2026-10-14',importe:12500},{fecha:'2026-10-15',importe:12500}]});
 expect(calls.some(c=>c.method==='POST'&&c.path.endsWith('/pagos'))).toBe(false);
});
it('previsión total incluye ideas además de compromisos',async()=>{
 mount({extended:true});
 await screen.findByRole('button',{name:'Idea de grabación'});
 const total=screen.getByText('previsión total · ideas y compromisos').parentElement!;
 expect(total).toHaveTextContent('€ 1.250,00');
 expect(screen.getByText('ideas · sin compromiso').parentElement).toHaveTextContent('€ 350,00');
 expect(screen.getByText('compromisos sin realizar').parentElement).toHaveTextContent('€ 900,00');
});
it('prueba móvil permite consultar y desactiva Hecho y formularios',async()=>{
 previewMode.value=true;
 const {calls,user}=mount({extended:true});
 const checkbox=await screen.findByRole('checkbox',{name:'Hecho: Idea de grabación'});
 expect(checkbox).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Añadir compra'})).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Idea de grabación'}));
 expect(screen.queryByRole('button',{name:'Editar datos'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Se compró'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Adjuntar archivo'})).not.toBeInTheDocument();
 expect(calls.every(c=>c.method==='GET')).toBe(true);
});

it('permite un anticipo sobre un compromiso antes de marcar trabajo realizado',async()=>{
 const {calls,user}=mount();
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));
 await user.click(screen.getByRole('button',{name:'Registrar pago'}));
 const modal=within(screen.getByRole('dialog',{name:'Registrar pago de la compra'}));
 await user.clear(modal.getByLabelText('Importe pagado (EUR)'));await user.type(modal.getByLabelText('Importe pagado (EUR)'),'125');
 await user.selectOptions(modal.getByLabelText('Cuenta desde la que se pagó'),'cuenta');
 await user.click(modal.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Registrar pago de la compra'})).not.toBeInTheDocument());
 expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({importe:12500,pagador:'cuenta'});
 expect(calls.some(c=>c.method==='POST'&&c.path.endsWith('/comprar'))).toBe(false);
});

it('editar un compromiso conserva céntimos, actualiza presupuesto pendiente y no cambia pagos',async()=>{
 const {calls,user}=mount({paid:1000});
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));
 await user.click(screen.getByRole('button',{name:'Editar datos'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar datos de la compra'}));
 expect(dialog.getByLabelText('Importe previsto (EUR)')).toHaveValue('900');
 await user.clear(dialog.getByLabelText('Importe previsto (EUR)'));await user.type(dialog.getByLabelText('Importe previsto (EUR)'),'120,29');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Editar datos de la compra'})).not.toBeInTheDocument());
 expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({version:1,estimado:12029});
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
 const detail=within(screen.getByRole('dialog',{name:'Equipo de ejemplo'}));
 expect(detail.getByText('saldo pendiente al proveedor').parentElement).toHaveTextContent('€ 110,29');
});
it('permite editar la previsión de una idea y protege pagos y cuotas manteniendo el borrador',async()=>{
 const {calls,user}=mount({extended:true});
 await user.click(await screen.findByRole('button',{name:'Idea de grabación'}));
 await user.click(screen.getByRole('button',{name:'Editar datos'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar datos de la compra'})),amountField=dialog.getByLabelText('Importe previsto (EUR)');
 await user.clear(amountField);await user.type(amountField,'120');await user.click(dialog.getByRole('button',{name:'Guardar'}));
 expect(await dialog.findByRole('alert')).toHaveTextContent('estimado_inferior_a_pagado');expect(amountField).toHaveValue('120');
 expect(calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 await user.clear(amountField);await user.type(amountField,'200');await user.click(dialog.getByRole('button',{name:'Guardar'}));
 expect(await dialog.findByRole('alert')).toHaveTextContent('plan_supera_importe');expect(amountField).toHaveValue('200');
 expect(calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
 await user.clear(amountField);await user.type(amountField,'260,50');await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));
 expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({estimado:26050,version:2,plan_pagos:[{fecha:'2026-10-14',importe:12500},{fecha:'2026-10-15',importe:12500}]});
});
it('un rechazo del servidor conserva importe y notas del borrador para revisar o reintentar',async()=>{
 const {calls,user}=mount({editError:'version_conflicto'});
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));await user.click(screen.getByRole('button',{name:'Editar datos'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar datos de la compra'}));
 await user.clear(dialog.getByLabelText('Importe previsto (EUR)'));await user.type(dialog.getByLabelText('Importe previsto (EUR)'),'120,29');
 await user.type(dialog.getByLabelText('Notas'),'Corrección pendiente de revisar');await user.click(dialog.getByRole('button',{name:'Guardar'}));
 expect(await dialog.findByRole('alert')).toHaveTextContent('Otra persona guardó cambios');
 expect(dialog.getByLabelText('Importe previsto (EUR)')).toHaveValue('120,29');expect(dialog.getByLabelText('Notas')).toHaveValue('Corrección pendiente de revisar');
 expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({estimado:12029,version:1,nota:'Corrección pendiente de revisar'});
});
it.each([0,1000])('una compra confirmada no ofrece atajo para editar importe real o pagos (pagado %s)',async paid=>{
 const {calls,user}=mount({bought:true,paid});
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));await user.click(screen.getByRole('button',{name:'Editar datos'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar datos de la compra'}));
 expect(dialog.queryByLabelText('Importe previsto (EUR)')).not.toBeInTheDocument();expect(dialog.queryByLabelText('Importe real (EUR)')).not.toBeInTheDocument();
 if(paid)expect(dialog.getByText(/revierte el pago desde su historial/)).toBeInTheDocument();
 await user.type(dialog.getByLabelText('Notas'),'Corrección de descripción');await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));
 const body=calls.find(c=>c.method==='PATCH')?.body;expect(body).not.toHaveProperty('estimado');expect(body).not.toHaveProperty('real');expect(body).not.toHaveProperty('pagado');
 expect(calls.some(c=>c.method==='POST')).toBe(false);
});

it('editar compra permite seleccionar dos compradores sin duplicar compra ni registrar pago',async()=>{
 const {calls,user}=mount({bought:true});
 await user.click(await screen.findByRole('button',{name:'Equipo de ejemplo'}));
 await user.click(screen.getByRole('button',{name:'Editar datos'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar datos de la compra'}));
 expect(dialog.getByRole('combobox',{name:'Quién compra'})).toHaveValue('Persona Uno');
 await user.click(dialog.getByRole('button',{name:'Añadir otra persona'}));
 await user.selectOptions(dialog.getByRole('combobox',{name:'Otra persona (2)'}),'Persona Dos');
 expect(within(dialog.getByRole('combobox',{name:'Otra persona (2)'})).queryByRole('option',{name:'Persona Uno'})).not.toBeInTheDocument();
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));
 expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({comprador:'Persona Dos y Persona Uno',version:1});
 expect(calls.filter(c=>c.method!=='GET')).toHaveLength(1);
});


it('grupo y subtipo dependientes no conservan un subtipo ajeno y guardan niñera sin schema nuevo',async()=>{
 const user=userEvent.setup();let body:ReturnType<typeof datosCosteVehiculo>|undefined;
 render(<form onSubmit={e=>{e.preventDefault();body=datosCosteVehiculo(new FormData(e.currentTarget));}}><textarea name="nota" defaultValue="Nota libre"/><VehicleFields vehiculoId="demo"/><button>Enviar demo</button></form>);
 expect(screen.getByLabelText('Grupo de gasto')).toHaveValue('');
 await user.selectOptions(screen.getByLabelText('Grupo de gasto'),'traslado');
 await user.selectOptions(screen.getByLabelText('Subtipo de gasto'),'ninera');
 await user.selectOptions(screen.getByLabelText('Grupo de gasto'),'preparacion');
 expect(screen.getByLabelText('Subtipo de gasto')).toHaveValue('');
 expect(screen.queryByRole('option',{name:'Camión portavehículos / niñera'})).not.toBeInTheDocument();
 await user.selectOptions(screen.getByLabelText('Grupo de gasto'),'traslado');await user.selectOptions(screen.getByLabelText('Subtipo de gasto'),'ninera');await user.click(screen.getByText('Enviar demo'));
 expect(body).toEqual({categoria:'transporte',nota:'[Subtipo vehículo: ninera]\nNota libre'});
 expect(clasificarCosteVehiculo(body!.categoria,body!.nota)).toMatchObject({grupo:'traslado',subtipo:'ninera'});
});
it('edición conserva otros y notas antiguas; cambiar subtipo elimina solo marcador reconocido',()=>{
 const d=new FormData();d.set('categoria_vehiculo','otros');d.set('subtipo_vehiculo','anterior');d.set('nota','Texto antiguo');
 expect(datosCosteVehiculo(d)).toEqual({categoria:'otros',nota:'Texto antiguo'});expect(clasificarCosteVehiculo('otros','Texto antiguo').grupo).toBe('pendiente');
 d.set('categoria_vehiculo','itv');d.set('subtipo_vehiculo','itv');d.set('nota','[Subtipo vehículo: ninera]\nNota libre');expect(datosCosteVehiculo(d)).toEqual({categoria:'itv',nota:'Nota libre'});
 d.set('nota','[Subtipo vehículo: desconocido]\nTexto histórico');expect(datosCosteVehiculo(d).nota).toBe('[Subtipo vehículo: desconocido]\nTexto histórico');
});

it('marcadores obsoletos caen a la categoría válida y la nota libre queda separada',()=>{
 expect(clasificarCosteVehiculo('gasolina','[Subtipo vehículo: ninera]\nTexto').grupo).toBe('traslado');
 expect(clasificarCosteVehiculo('gasolina','[Subtipo vehículo: ninera]\nTexto').subtipo).toBe('gasolina');
 expect(clasificarCosteVehiculo('itv','[Subtipo vehículo: desconocido]\nTexto').subtipo).toBe('itv');
 expect(notaLibreVehiculo('[Subtipo vehículo: ninera]\nTexto editable')).toBe('Texto editable');
 const d=new FormData();d.set('vehiculo_id','demo');d.set('categoria_vehiculo','transporte');d.set('subtipo_vehiculo','ninera');d.set('nota','Texto añadido delante');
 const encoded=datosCosteVehiculo(d);expect(encoded.nota).toBe('[Subtipo vehículo: ninera]\nTexto añadido delante');
 d.set('nota',notaLibreVehiculo(encoded.nota));expect(datosCosteVehiculo(d)).toEqual(encoded);
});
it('formulario bloquea el envío vinculado sin grupo o subtipo y acepta la selección completa',async()=>{
 const user=userEvent.setup(),submit=vi.fn(async()=>{});
 render(<FormModal title="Gasto vinculado QA" close={()=>{}} fields={[]} submit={submit}><VehicleFields vehiculoId="demo"/></FormModal>);
 await user.click(screen.getByRole('button',{name:'Guardar'}));expect(submit).not.toHaveBeenCalled();
 await user.selectOptions(screen.getByLabelText('Grupo de gasto'),'traslado');await user.click(screen.getByRole('button',{name:'Guardar'}));expect(submit).not.toHaveBeenCalled();
 await user.selectOptions(screen.getByLabelText('Subtipo de gasto'),'ninera');await user.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(submit).toHaveBeenCalledOnce());
 const d=new FormData();d.set('vehiculo_id','demo');expect(()=>datosCosteVehiculo(d)).toThrow('Selecciona');
});

// Un enlace de conciliación solo abre el registro original; no cambia dinero.
it('abre el soporte del gasto enlazado y permite cerrar sin escrituras',async()=>{
 const {calls,user}=mount({initialUrl:'/compras?compra=compra&tarea=soporte'});
 const upload=await screen.findByRole('dialog',{name:'Adjuntar documento privado'});
 expect(within(upload).getByLabelText(/Nombre del documento/)).toBeInTheDocument();
 expect(screen.getByRole('dialog',{name:'Equipo de ejemplo'})).toBeInTheDocument();
 expect(calls.filter(c=>c.method!=='GET')).toHaveLength(0);
 await user.click(within(upload).getByRole('button',{name:'Cerrar'}));
 await user.click(within(screen.getByRole('dialog',{name:'Equipo de ejemplo'})).getByRole('button',{name:'Cerrar'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(calls.filter(c=>c.method!=='GET')).toHaveLength(0);
});
it('revisar pago muestra el historial sin iniciar un pago',async()=>{
 const {calls}=mount({bought:true,initialUrl:'/compras?compra=compra&tarea=pago'});
 const detail=await screen.findByRole('dialog',{name:'Equipo de ejemplo'});
 expect(within(detail).getByText(/Que un pago no esté registrado no significa/)).toBeInTheDocument();
 expect(within(detail).getByRole('button',{name:'Registrar pago'})).toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'Registrar pago de la compra'})).not.toBeInTheDocument();
 expect(calls.filter(c=>c.method!=='GET')).toHaveLength(0);
});
