// Vista local aislada. No usa credenciales ni escribe en Cloudflare.
// Ejecutar desde la raíz: npm run build --prefix panel && node scripts/preview-gestion.mjs
// Base de datos y documentos en memoria: se reinician al cerrar este proceso.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { testing } from '../worker/app.js';
import { sqliteD1 } from '../test/helpers/sqlite-d1.js';

const DB=await sqliteD1();
const objects=new Map();
const FINANCE_DOCS={
 async put(key,body,opts={}){objects.set(key,{bytes:Buffer.from(body instanceof ArrayBuffer?body:await new Response(body).arrayBuffer()),opts});},
 async get(key){const item=objects.get(key);return item?{body:item.bytes,size:item.bytes.length,httpMetadata:item.opts.httpMetadata||{},writeHttpMetadata(headers){for(const[k,v]of Object.entries(this.httpMetadata))if(k==='contentType')headers.set('Content-Type',v);}}:null;},
 async delete(key){objects.delete(key);},
};
const actor='socio@velai.test',scope={role:'velai',email:actor,tenantId:null};
const env={DB,FINANCE_DOCS,SOCIOS_EMAILS:actor};
const ctx={waitUntil(){}};
async function call(path,method='GET',data){
 const req=new Request(`http://127.0.0.1:8796/api/admin/gestion/${path}`,{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
 const res=await testing.adminRouter(req,env,ctx,new URL(req.url).pathname,new URL(req.url),{},scope);
 if(!res.ok)throw new Error(`${path}: ${res.status} ${await res.text()}`);
 return res.json();
}
const uuid=()=>crypto.randomUUID(),entity=uuid(),account=uuid(),loan=uuid(),purchase=uuid();
await DB.prepare('INSERT OR IGNORE INTO fin_socios(email,nombre,activo,created_by,created_at) VALUES (?,?,?,?,?)').bind(actor,'Socio de prueba',1,actor,new Date().toISOString()).run();
await call('entidades','POST',{id:entity,nombre:'Velai · sociedad pendiente',tipo:'sociedad',nif:null,direccion:null});
await call('cuentas','POST',{id:account,nombre:'Cuenta de demostración',entidad_id:entity,moneda:'EUR',saldo_inicial:0,fecha_saldo:null,conciliada:0});
await call('prestamos','POST',{id:loan,nombre:'Préstamo del proyecto · ejemplo',cuenta_id:account,principal:5000000,apertura:150000,cuota:88264,tin_bp:1200,tae_bp:1382,meses:84,reserva_cuotas:6,primer_vencimiento:'2026-11-01',condiciones:[{concepto:'Finalidad',valor:'Fondo común para tres actividades',fuente:'Ejemplo de prueba'},{concepto:'Reserva de cuotas',valor:'Se mantiene en la cuenta para el cobro mensual',fuente:'Ejemplo de prueba'}]});
await call(`prestamos/${loan}/desembolso`,'POST',{id:uuid(),fecha:'2026-10-01',importe:5000000,apertura:150000});
await call('compras','POST',{id:purchase,concepto:'Equipo audiovisual de ejemplo',negocio:'dialogos',entidad_id:entity,prestamo_id:loan,moneda:'EUR',estimado:90000,estado:'comprometida',comprador:'Persona Uno',categoria:'Equipamiento',fecha_prevista:null,nota:'Datos de prueba; no es un movimiento real.'});
await call(`compras/${purchase}/comprar`,'POST',{version:1,real:79675,fecha:'2026-10-02',comprador:'Persona Uno',proveedor:'Proveedor de ejemplo'});
await call(`compras/${purchase}/pagos`,'POST',{id:uuid(),fecha:'2026-10-02',importe:79675,pagador:'cuenta',cuenta_id:account,socio:null,nota:'Pago de prueba'});
await call('compras','POST',{id:uuid(),concepto:'Vehículo para evaluar',negocio:'coches',entidad_id:entity,prestamo_id:loan,moneda:'EUR',estimado:1800000,estado:'prevista',comprador:'Persona Dos',categoria:'Vehículos',fecha_prevista:null,nota:'Presupuesto orientativo de demostración.'});
const template=await readFile(new URL('../panel/public/formatos/Formatos_Factura_Velai.pdf',import.meta.url));
const form=new FormData();form.set('id',uuid());form.set('tipo','prestamo');form.set('objeto_id',loan);form.set('clase','otro');form.set('nombre','Documento de prueba · plantilla de factura');form.set('archivo',new Blob([template],{type:'application/pdf'}),'documento-ejemplo.pdf');
const docReq=new Request('http://127.0.0.1:8796/api/admin/gestion/documentos',{method:'POST',body:form});
const docRes=await testing.adminRouter(docReq,env,ctx,new URL(docReq.url).pathname,new URL(docReq.url),{},scope);if(!docRes.ok)throw new Error(await docRes.text());
const root=resolve('panel/dist');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.pdf':'application/pdf'};
const server=createServer(async(req,res)=>{
 try{
  // No sesiones remotas ni exposición a otras interfaces; prevenir llamadas cross-site.
  if(!/^127\.0\.0\.1:8796$/.test(req.headers.host||'')){res.writeHead(403);return res.end();}
  if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:8796'){res.writeHead(403);return res.end();}
  const url=new URL(req.url,'http://127.0.0.1:8796');
  if(url.pathname.startsWith('/api/')){
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024){res.writeHead(413);return res.end();}chunks.push(chunk);}
   const method=req.method||'GET';
   const request=new Request(url,{method,headers:req.headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
   const response=await testing.adminRouter(request,env,ctx,url.pathname,url,{},scope);
   res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
  }
  let path=resolve(root,'.'+decodeURIComponent(url.pathname));if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);return res.end();}
  try{if(!(await stat(path)).isFile())path=resolve(root,'index.html');}catch{path=resolve(root,'index.html');}
  let content=await readFile(path);
  if(extname(path)==='.html')content=Buffer.from(content.toString().replace('</body>','<div style="position:fixed;bottom:6px;right:8px;z-index:9999;padding:5px 10px;background:#171b21;color:white;border-radius:5px;font:11px system-ui;pointer-events:none">VISTA LOCAL · DATOS DE PRUEBA</div></body>'));
  res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
 }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.code||'preview_failed'}));console.error(e.code||e.message);}
});
server.listen(8796,'127.0.0.1',()=>console.log('Vista aislada: http://127.0.0.1:8796/credito'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();DB.close();process.exit(0);});
