import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ConfirmarHost } from '../components/Confirmar';
import { ToastProvider } from '../components/Toasts';
import { EventFinance } from './EventFinance';
const mode=vi.hoisted(()=>({preview:false}));
vi.mock('../mobilePreview',async importOriginal=>({...await importOriginal<typeof import('../mobilePreview')>(),get MOBILE_PREVIEW(){return mode.preview;}}));
const totals={proyectado:60000,realizado:30000,pagado_proveedores:22000,pendiente_proveedores:8000,desembolsado_fondo_comun:12000,ingresos_registrados:2500,inversion_pendiente:9500,saldo_proyectado:-57500,gastos_operativos_manuales:0,gastos_sin_cuenta:0,anticipos_socios_pendientes:10000};
function mount({socio=true,role='velai',retry=false}={}) {
 const calls:{path:string;method:string;body?:Record<string,unknown>}[]=[];let failed=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(String(input),'https://panel.test'),method=init?.method||'GET';calls.push({path:url.pathname+url.search,method,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(method!=='GET'){if(retry&&!failed){failed=true;return Response.json({error:'network_failed'},{status:503});}return Response.json({ok:true});}
  const path=url.pathname.replace('/api/admin/mobile-preview/','/api/admin/');
  const data:Record<string,unknown>={
   '/api/admin/me':{role,socio,tenantId:null},
   '/api/admin/gestion/eventos/evento/resumen':{evento:{id:'evento',name:'Fiesta QA'},items:[],monedas:{EUR:totals,COP:totals}},
   '/api/admin/gestion/compras':{items:[]},'/api/admin/gestion/prestamos':{items:[]},
   '/api/admin/gestion/catalogos':{entidades:[],cuentas:[{id:'cuenta',nombre:'Cuenta QA',moneda:'EUR'}],socios:[],eventos:[{id:'evento',name:'Fiesta QA'}]},
   '/api/admin/finanzas/conceptos':{conceptos:{ingreso:[{id:1,nombre:'Otros ingresos',activo:1}],gasto:[],egreso:[]}},
  };if (/\/gestion\/eventos\/[^/]+\/resumen$/.test(path)) return Response.json({evento:{id:path.split('/')[5],name:'Fiesta QA'},items:[],monedas:{EUR:totals,COP:totals}});return Response.json(data[path]||{});
 }));
 const client=createQueryClient();
 const view=(eventId:string)=><QueryClientProvider client={client}><ToastProvider><MemoryRouter><EventFinance eventId={eventId}/><ConfirmarHost/></MemoryRouter></ToastProvider></QueryClientProvider>;
 const rendered=render(view('evento'));
 return {calls,user:userEvent.setup(),switchEvent:(eventId:string)=>rendered.rerender(view(eventId))};
}
afterEach(()=>{vi.unstubAllGlobals();mode.preview=false;});
it.each([{socio:false,role:'velai'},{socio:true,role:'cliente'}])('cierra presupuesto sin consultar datos financieros para $role socio=$socio',async opts=>{
 const {calls}=mount(opts);
 await waitFor(()=>expect(screen.queryByText('Comprobando acceso…')).not.toBeInTheDocument());
 expect(screen.queryByRole('region',{name:'Presupuesto del evento'})).not.toBeInTheDocument();
 expect(calls.some(c=>c.path.includes('/gestion/')||c.path.includes('/finanzas/'))).toBe(false);
});
it('presenta previsión, pagos y adelantos sin sumar anticipos dos veces',async()=>{
 mount();await screen.findByRole('heading',{name:'Presupuesto y gastos'});
 for(const [label,value] of [['presupuesto total previsto','€ 600,00'],['compras y gastos realizados','€ 300,00'],['adelantado por el fondo común','€ 120,00'],['adelanto pendiente de cubrir con cobros','€ 95,00'],['pagos de compras a proveedores','€ 220,00'],['pendiente a proveedores por compromisos y compras','€ 80,00']]) {
  await waitFor(()=>expect(screen.getByText(label!).parentElement).toHaveTextContent(value!));
 }
 expect(screen.getByText(/no se crea otro préstamo/)).toBeInTheDocument();
 expect(screen.getByLabelText('Proyecto')).toBeDisabled();expect(screen.getByLabelText('Evento')).toBeDisabled();
});
it('cobro503 conserva UUID y fechaimporte exactos al reintentar',async()=>{
 const {calls,user}=mount({retry:true});
 const open=await screen.findByRole('button',{name:'Registrar cobro del evento'});
 await waitFor(()=>expect(open).toBeEnabled());await user.click(open);
 const dialog=within(screen.getByRole('dialog',{name:'Registrar cobro del evento'}));
 await user.type(dialog.getByLabelText('Importe cobrado (EUR)'),'25,25');
 await user.selectOptions(dialog.getByLabelText('Concepto del ingreso'),'1');
 await user.selectOptions(dialog.getByLabelText('Cuenta donde entró el dinero'),'cuenta');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 expect(await dialog.findByRole('alert')).toHaveTextContent('puedes reintentar');
 expect(dialog.getByLabelText('Importe cobrado (EUR)')).toHaveValue('25,25');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 const posts=calls.filter(c=>c.method==='POST');expect(posts).toHaveLength(2);expect(posts[1]?.body).toEqual(posts[0]?.body);
 expect(posts[0]?.body).toMatchObject({importe:2525,cuenta_id:'cuenta',concepto_id:1});expect(posts[0]?.body?.id).toMatch(/^[0-9a-f-]{36}$/);
 expect(posts[0]?.path).toBe('/api/admin/gestion/eventos/evento/cobros');
});
it('móvil de lectura oculta cobros y mantiene consultas protegidas',async()=>{
 mode.preview=true;const {calls}=mount();await screen.findByText('Solo lectura');
 expect(screen.queryByRole('button',{name:'Registrar cobro del evento'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Añadir compra'})).not.toBeInTheDocument();
 expect(calls.every(c=>c.method==='GET')).toBe(true);
});
it('cambiar evento desmonta el cobro abierto y su borrador anterior',async()=>{
 const {user,switchEvent,calls}=mount();
 const button=await screen.findByRole('button',{name:'Registrar cobro del evento'});await waitFor(()=>expect(button).toBeEnabled());
 await user.click(button);await user.type(screen.getByLabelText('Importe cobrado (EUR)'),'75,50');
 switchEvent('otro-evento');
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar cobro del evento'})).toBeEnabled());
 await user.click(screen.getByRole('button',{name:'Registrar cobro del evento'}));
 expect(screen.getByLabelText('Importe cobrado (EUR)')).toHaveValue('');
 expect(calls.some(c=>c.path==='/api/admin/gestion/eventos/otro-evento/resumen')).toBe(true);
 expect(calls.some(c=>c.method!=='GET')).toBe(false);
});
