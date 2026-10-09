import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/queryClient';
import { ConfirmarHost } from '../../components/Confirmar';
import { Compras } from './Compras';
import { EntityOptions, amount } from './shared';

function mount({ socio=true, bought=false, retry=false, entities=false }={}) {
 const calls:{path:string;method:string;body?:Record<string,unknown>}[]=[];
 let failed=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(String(input),'https://panel.test'),method=init?.method||'GET';
  calls.push({path:url.pathname,method,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(method!=='GET') {
   if(retry&&!failed){failed=true;return Response.json({error:'network_failed'},{status:503});}
   return Response.json({item:{id:'nuevo'}});
  }
  const data:Record<string,unknown>={
   '/api/admin/me':{role:'velai',socio,tenantId:null},
   '/api/admin/gestion/catalogos':{entidades:[],cuentas:[{id:'cuenta',nombre:'Cuenta común',moneda:'EUR',saldo_inicial:0,version:1}],socios:[{email:'uno@velai.test',nombre:'Persona Uno'}]},
   '/api/admin/gestion/prestamos':{items:[]},
   '/api/admin/gestion/compras':{items:[{id:'compra',concepto:'Equipo de ejemplo',negocio:'dialogos',moneda:'EUR',estimado:90000,real:bought?79675:null,estado:bought?'comprada':'comprometida',comprador:'Persona Uno',proveedor:null,categoria:'Equipo',version:1,pagado:0,pendiente:bought?79675:90000,documentos_count:0}]},
   '/api/admin/gestion/documentos':{items:[]},
   '/api/admin/gestion/compras/compra/pagos':{items:[]},
  };
  return Response.json(data[url.pathname]||{});
 }));
 render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={['/compras']}><Routes><Route path="/compras" element={entities?<EntityOptions onDone={()=>{}}/>:<Compras/>}/><Route path="/" element={<h1>Inicio</h1>}/></Routes><ConfirmarHost/></MemoryRouter></QueryClientProvider>);
 return {calls,user:userEvent.setup()};
}
afterEach(()=>vi.unstubAllGlobals());

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
 await user.type(dialog.getByLabelText('Proveedor'),'Proveedor ficticio');
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
