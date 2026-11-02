import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/queryClient';
import { Finanzas } from '../Finanzas';
import { ToastProvider } from '../../components/Toasts';
import type { PrestamoEquipo } from './equipo';

const loan:PrestamoEquipo={id:'loan-1',titulo:'Apoyo del equipo',cuenta_id:'eur',importe:80000,fecha_solicitud:'2026-11-01',vencimiento:'2026-11-30',estado:'solicitado',participantes:[{email:'uno@velai.test',nombre:'Uno',importe:40000},{email:'dos@velai.test',nombre:'Dos',importe:40000}],devuelto:0,pendiente:80000,version:1,aprobado_por:null,fecha_desembolso:null,nota:null};
function mount(path='/finanzas?tab=prestamos',email='uno@velai.test'){
 const calls:{url:URL;method:string;body:Record<string,unknown>|null}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(String(input),'http://panel.test');const method=init?.method||'GET';calls.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});
  const datos:Record<string,unknown>={
   '/api/admin/me':{role:'velai',socio:true,email,tenantId:null},
   '/api/admin/gestion/catalogos':{cuentas:[{id:'eur',nombre:'Cuenta común',moneda:'EUR'}],socios:[{email:'uno@velai.test',nombre:'Uno'},{email:'dos@velai.test',nombre:'Dos'}],entidades:[]},
   '/api/admin/gestion/equipo-prestamos':{items:[loan],storage_ready:true,resumen:{limite:100000,pendiente:0,disponible_limite:100000,vencido:0,solicitudes:1},capacidad:{disponible:200000,reserva:30000,compromisos:0,cuentas:[]}},
   '/api/admin/gestion/equipo-prestamos/loan-1':{item:loan,pagos:[]},
   '/api/admin/gestion/documentos':{items:[],storage_ready:true},
   '/api/admin/gestion/resumen':{cuentas:[],prestamos:[],totales:{saldo:200000,reservas:30000,compromisos_pendientes:0,saldo_socios:0,disponible_tras_compromisos:170000}},
   '/api/admin/finanzas/resumen':{monedas:{},conceptos:[],repartido:[]},
   '/api/admin/finanzas/conceptos':{conceptos:{ingreso:[],gasto:[],egreso:[]}},
   '/api/admin/tenants':{tenants:[]},'/api/admin/eventos':{events:[]},
   '/api/admin/finanzas/movimientos':{movimientos:[],nextCursor:null},
  };
  return Response.json(method==='GET'?(datos[url.pathname]||{}):{item:loan});
 }));
 render(<QueryClientProvider client={createQueryClient()}><ToastProvider><MemoryRouter initialEntries={[path]}><Finanzas/></MemoryRouter></ToastProvider></QueryClientProvider>);
 return {calls,user:userEvent.setup()};
}
afterEach(()=>vi.unstubAllGlobals());
it('abre Finanzas en dashboard y conserva las modalidades separadas',async()=>{
 mount('/finanzas');
 expect(await screen.findByRole('heading',{name:'Dinero en cuentas'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Créditos recibidos/})).toHaveAttribute('href','/credito');
 await screen.findByText('Las obligaciones registradas mantienen cobertura con el saldo actual.');
 expect(screen.queryByRole('button',{name:'Registrar movimiento'})).not.toBeInTheDocument();
});
it('muestra terceros en gris y desactivado con límite y plazo',async()=>{
 mount();
 const group=await screen.findByRole('group',{name:'Préstamos a terceros no disponibles'});
 for(const field of within(group).getAllByRole('textbox'))expect(field).toBeDisabled();
 expect(within(group).getByRole('spinbutton',{name:'Importe (EUR)'})).toHaveAttribute('max','500');
 expect(within(group).getByRole('spinbutton',{name:'Plazo (meses)'})).toHaveAttribute('max','3');
 expect(within(group).getByRole('button')).toBeDisabled();
});
it('impide al beneficiario aprobar su solicitud de grupo',async()=>{
 const {user}=mount();await user.click(await screen.findByRole('button',{name:'Apoyo del equipo'}));
 expect(await screen.findByRole('button',{name:'Aprobar solicitud'})).toBeDisabled();
 expect(screen.getByText(/otro socio que no participe/)).toBeInTheDocument();
});
it('permite solicitar más de 500 en grupo con principal individual definido',async()=>{
 const {user,calls}=mount();await user.click(await screen.findByRole('button',{name:'Nueva solicitud'}));
 const d=within(screen.getByRole('dialog',{name:'Solicitar préstamo al equipo'}));
 await user.type(d.getByLabelText('Motivo o nombre de la solicitud'),'Apoyo conjunto');
 await user.selectOptions(d.getByLabelText('Cuenta de origen (EUR)'),'eur');
 await user.type(d.getByLabelText('Fecha acordada de devolución'),'2026-11-30');
 await user.selectOptions(d.getByLabelText('Persona 1'),'uno@velai.test');
 await user.type(d.getByLabelText('Principal de persona 1 (EUR)'),'500');
 await user.click(d.getByRole('button',{name:'Añadir participante'}));
 await user.selectOptions(d.getByLabelText('Persona 2'),'dos@velai.test');
 await user.type(d.getByLabelText('Principal de persona 2 (EUR)'),'500');
 await user.click(d.getByRole('button',{name:'Enviar solicitud'}));
 await waitFor(()=>expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({importe:100000,participantes:[{email:'uno@velai.test',importe:50000},{email:'dos@velai.test',importe:50000}]}));
});
it.each([['ingresos','ingreso'],['gastos','gasto']])('fija %s en la consulta y no permite cambiar el tipo',async(tab,tipo)=>{
 const {calls}=mount(`/finanzas?tab=${tab}`);
 await waitFor(()=>expect(calls.some(c=>c.url.pathname.endsWith('/movimientos')&&c.url.searchParams.get('tipo')===tipo)).toBe(true));
 expect(screen.getByRole('combobox',{name:'Tipo'})).toBeDisabled();
});
