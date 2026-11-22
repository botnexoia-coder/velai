// Vista local aislada. Uso: node scripts/preview-vehiculos.mjs [JSON privado] [puerto]
// JSON opcional: mapa de rutas API exactas a respuestas completas. Solo datos ficticios en Git.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('../panel/dist',import.meta.url));
const override=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):{};
const port=Number(process.argv[3]||4173);
const v={id:'demo',referencia:'Vehículo de demostración',tipo:'camioneta',marca:'Marca ejemplo',modelo:'Modelo ejemplo',matricula:null,vin:null,moneda:'EUR',estado:'comprado',fecha_compra:'2026-10-01',fecha_venta:null,precio_venta:null,prestamo_id:null,entidad_id:null,nota:'Demostración ficticia. Las operaciones están bloqueadas.',version:1,compras_count:3,viajes_count:0,documentos_count:0,coste_directo:1015000,pagado_directo:600000,pendiente_directo:415000};
const compras=[{id:'demo-compra',categoria:'adquisicion',concepto:'Adquisición de ejemplo',estimado:1000000,real:1000000,estado:'comprada',pagado:600000,fecha_compra:'2026-10-01'}, {id:'demo-viaje',categoria:'gasolina',concepto:'Gasolina de ejemplo',estimado:10000,real:10000,estado:'comprada',pagado:0,fecha_compra:'2026-10-02'}, {id:'demo-itv',categoria:'itv',concepto:'Inspección de ejemplo · importe provisional',estimado:5000,real:null,estado:'prevista',pagado:0,hecho:true,fecha_prevista:'2026-10-03'}].map(c=>({negocio:'coches',moneda:'EUR',vehiculo_id:'demo',viaje_id:null,nota:null,version:1,documentos_count:0,pendiente:(c.real??c.estimado)-c.pagado,...c}));
const totales={precio_compra:1000000,precio_compra_confirmado:true,otros_costes_directos:15000,coste_directo:1015000,pagado_directo:600000,pendiente_directo:415000,imputado_viajes:0,imputado_viajes_pagado:0,gastos_manuales:0,coste_total:1015000,invertido_confirmado:600000,pendiente_pago:415000,precio_venta:null,facturado_venta:0,venta:null,cobrado:0,cobrado_en_cuenta:0,cobrado_pendiente_conciliar:0,pendiente_cobro:null,margen_estimado:null,margen_sin_viajes:null,margen_confirmado:-600000};
const responses={
 '/api/admin/me':{role:'velai',socio:true,tenantId:null,tenantName:null,email:'demo@velai.test'},
 '/api/admin/gestion/catalogos':{entidades:[],cuentas:[{id:'demo-cuenta',nombre:'Cuenta de ejemplo',moneda:'EUR'}],socios:[],vehiculos:[v],viajes:[],eventos:[]},
 '/api/admin/gestion/vehiculos':{items:[v]},'/api/admin/gestion/compras':{items:compras},'/api/admin/gestion/viajes':{items:[]},'/api/admin/gestion/prestamos':{items:[]},'/api/admin/gestion/terceros':{items:[]},'/api/admin/gestion/documentos':{items:[]},
 '/api/admin/gestion/vehiculos/demo/resumen':{vehiculo:v,prestamo:null,compras,viajes:[],facturas:[],cobros:[],documentos:[],por_categoria:[],cronologia:[],totales,costes:compras.map(c=>({id:c.id,fecha:c.fecha_compra||c.fecha_prevista,categoria:c.categoria,nota:c.nota,concepto:c.concepto,estado:c.estado,hecho:Boolean(c.hecho),importe:c.real??c.estimado,pagado:c.pagado,origen:'Compra directa',documentos:0,facturas:[],compartido:false,importe_origen:c.real??c.estimado})),pagos:[{id:'demo-pago',importe:600000,pagador:'cuenta',cuenta_id:'demo-cuenta',cuenta_nombre:'Cuenta de ejemplo',socio:null,origen:'Compra directa'}]},...override,
};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.writeHead(405,{'Content-Type':'application/json','Allow':'GET'});res.end(JSON.stringify({error:'Vista previa: escrituras bloqueadas'}));return;}
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
 if(path.startsWith('/api/')){const data=responses[path+url.search]||responses[path];res.writeHead(data?200:404,{'Content-Type':'application/json'});res.end(JSON.stringify(data||{error:'Ruta fuera de la demostración'}));return;}
 try{
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  let body;let extension=extname(file);
  try{body=await readFile(file);}catch{if(extension)throw Error('missing');body=await readFile(resolve(root,'index.html'));extension='.html';}
  if(extension==='.html')body=body.toString().replace('<body>','<body><div style="position:sticky;top:0;z-index:999999;padding:10px;text-align:center;background:#ffd37a;color:#24170a;font:600 15px system-ui">Vista previa local · solo lectura</div>');
  res.writeHead(200,{'Content-Type':mime[extension]||'application/octet-stream'});res.end(body);
 }catch{res.writeHead(404);res.end('No encontrado');}
}).listen(port,'127.0.0.1',()=>console.log(`Vista ficticia GET-only: http://127.0.0.1:${port}/vehiculos?vehiculo=demo`));
