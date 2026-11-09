import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmarHost } from '../../components/Confirmar';
import { Facturacion, type Factura } from './Facturacion';
import { HojaPrueba, type PruebaFactura } from './FacturaPrueba';
const E='00000000-0000-4000-8000-000000000001',F='00000000-0000-4000-8000-000000000002',P='00000000-0000-4000-8000-000000000003';
const f:Factura={id:F,entidad_id:E,moneda:'EUR',negocio:'coches',tipo:'emitida',estado:'borrador',origen:'borrador',clase:'ordinaria',tratamiento_fiscal:'general',contraparte_nombre:null,contraparte_nif:null,contraparte_direccion:null,numero:null,fecha_emision:'2027-02-15',fecha_operacion:null,fecha_recepcion:null,compra_id:null,proveedor_emision:null,nota:'INTERNAL-NOT-FOR-PRINT',nota_fiscal:null,rectifica_id:null,correccion_de:null,motivo_correccion:null,base:1800000,iva:378000,retencion:0,total:2178000,iva_deducible:0,lineas:[{descripcion:'Mercedes-Benz Vito usada',cantidad:'1',precio_unitario:1800000,descuento:0,iva_bp:2100,retencion_bp:0,base:1800000,iva:378000,retencion:0,total:2178000}],documentos_count:0,originales_count:0,version:2,revision:null,snapshot:null};
const p:PruebaFactura={id:P,numero:'PR-2027-001',serie:'PR-2027',ejercicio:2027,secuencia:1,fecha_emision:'2027-02-15',snapshot:{entidad:{nombre:'Velai histórico',nif:null,direccion:'Calle de Prueba, 1'},factura:f}};
function mount({retry=false,path=`/facturacion?factura=${F}`,item=f}={}){
 const calls:{path:string;method:string;body:Record<string,unknown>|null}[]=[];let attempts=0;
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{const u=new URL(String(input),'https://test.local');const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):null;calls.push({path:u.pathname,method,body});
 if(u.pathname==='/api/admin/me')return Response.json({role:'velai',socio:true});
 if(method==='POST'&&u.pathname.endsWith('/pruebas')){attempts++;if(retry&&attempts===1)return Response.json({error:'network_failed'},{status:503});return Response.json({item:p});}
 if(u.pathname.endsWith('/catalogos'))return Response.json({entidades:[{id:E,nombre:'Velai editado después',tipo:'sociedad',nif:null,direccion:null,estado:'pendiente',version:3}],socios:[],cuentas:[],negocios:[]});
 if(u.pathname.includes('/facturas-prueba/'))return Response.json({item:p});
 if(u.pathname.endsWith('/pruebas'))return Response.json({items:[p]});
 if(u.pathname.endsWith('/facturas'))return Response.json({items:[item],nextCursor:null});
 if(u.pathname.includes('/facturas/'))return Response.json({item});
 return Response.json({items:[]});}));
 const q=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={q}><MemoryRouter initialEntries={[path]}><Routes><Route path="/facturacion" element={<Facturacion/>}/></Routes><ConfirmarHost/></MemoryRouter></QueryClientProvider>);return{calls,user:userEvent.setup()};
}
afterEach(()=>vi.unstubAllGlobals());
it('genera PR desde borrador sin NIF y conserva el mismo intento al reintentar',async()=>{
 const {user,calls}=mount({retry:true});await user.click(await screen.findByRole('button',{name:'Generar factura de prueba'}));
 expect(screen.getByLabelText('Fecha de la prueba')).toHaveValue('2027-02-15');await user.click(screen.getByRole('button',{name:'Guardar y ver prueba'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('no duplique');expect(screen.getByLabelText('Fecha de la prueba')).toBeDisabled();
 await user.click(screen.getByRole('button',{name:'Reintentar el mismo intento'}));await screen.findByRole('article',{name:'Factura de prueba PR-2027-001'});
 const posts=calls.filter(c=>c.method==='POST');expect(posts).toHaveLength(2);expect(posts[0]!.body).toEqual(posts[1]!.body);expect(posts[0]!.body).toMatchObject({fecha_emision:'2027-02-15',version:2});expect(posts[0]!.body).not.toHaveProperty('numero');expect(calls.some(c=>c.path.endsWith('/emitir'))).toBe(false);
});
it('abre una prueba histórica sin asignar número nuevo e imprime el snapshot',async()=>{
 const {user,calls}=mount({path:`/facturacion?prueba=${P}`});const print=vi.spyOn(window,'print').mockImplementation(()=>{});await screen.findByRole('article',{name:'Factura de prueba PR-2027-001'});
 expect(screen.getByText('Velai histórico')).toBeInTheDocument();expect(screen.queryByText('INTERNAL-NOT-FOR-PRINT')).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Imprimir / Guardar PDF'}));expect(print).toHaveBeenCalledOnce();expect(calls.some(c=>c.method!=='GET')).toBe(false);print.mockRestore();
});
it('facturas recibidas externas no ofrecen generar pruebas de venta',async()=>{mount({item:{...f,tipo:'recibida',origen:'externa',estado:'registrada',numero:'PROVEEDOR-88'}});await screen.findByRole('heading',{name:'Factura PROVEEDOR-88'});expect(screen.queryByRole('button',{name:'Generar factura de prueba'})).not.toBeInTheDocument();});
it('la impresión no interpreta HTML de las descripciones y conserva varios tipos de IVA',()=>{
 const item={...p,snapshot:{...p.snapshot,factura:{...f,lineas:[{...f.lineas[0]!,descripcion:'<img src=x onerror=alert(1)>'},{...f.lineas[0]!,descripcion:'Segundo servicio',iva_bp:1000,iva:180000}],iva:558000,total:4158000}}};
 const {container}=render(<HojaPrueba item={item}/>);expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();expect(container.querySelector('img[src=x]')).toBeNull();expect(screen.getByText('IVA (21 %)')).toBeInTheDocument();expect(screen.getByText('IVA (10 %)')).toBeInTheDocument();expect(screen.getAllByText('NIF: B00000000')).toHaveLength(2);
});
it('IVA sin clasificar muestra total provisional y nunca simula IVA cero',()=>{render(<HojaPrueba item={{...p,snapshot:{...p.snapshot,factura:{...f,lineas:[{...f.lineas[0]!,iva_bp:null,iva:0}],iva:0,total:1800000}}}}/>);expect(screen.getByText('IVA pendiente')).toBeInTheDocument();expect(screen.getByText('TOTAL PROVISIONAL')).toBeInTheDocument();expect(screen.queryByText('IVA (0 %)')).not.toBeInTheDocument();});
