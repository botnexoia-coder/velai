import {expect,test} from '@playwright/test';
import {dirname,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
const tid='11111111-1111-4111-8111-111111111111';
const nayaTid='22222222-2222-4222-8222-222222222222';
const OPTIONS=[{id:'velai',label:'Velai · Admin'},{id:'dialogos',label:'Diálogos que Enseñan'},{id:'colegiale-sevilla',label:'NAYA Eventos'}];
test.use({locale:'es-ES',timezoneId:'Europe/Madrid'});
test('admin rota entre Velai, Diálogos y NAYA sin logout ni mezclar llamadas',async({page})=>{
 await page.clock.install({time:new Date('2026-10-12T12:00:00Z')});
 await page.setViewportSize({width:1200,height:850});
 const seen:{path:string;workspace:string;method:string}[]=[];
 const dist=join(dirname(fileURLToPath(import.meta.url)),'..','dist');
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!=='https://panel.test')return route.abort();
  if(!url.pathname.startsWith('/api/admin/')){
   const relative=url.pathname.includes('/assets/')?url.pathname.slice(1):'index.html';
   return route.fulfill({path:join(dist,relative),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html'} as Record<string,string>)[extname(relative)]});
  }
  const ws=req.headers()['x-velai-workspace']||'velai';
  seen.push({path:url.pathname,workspace:ws,method:req.method()});
  const respond=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  // Como el worker: `naya` es el alias heredado y current devuelve el slug real.
  const naya=ws==='naya'||ws==='colegiale-sevilla',current=naya?'colegiale-sevilla':ws;
  if(url.pathname.endsWith('/me'))return respond({role:ws==='velai'?'velai':'cliente',socio:ws==='velai',tenantId:ws==='dialogos'?tid:naya?nayaTid:null,tenantName:ws==='dialogos'?'Diálogos que Enseñan':naya?'NAYA Eventos':null,tenantLogo:null,tenantSlug:ws==='dialogos'?'dialogos':naya?'colegiale-sevilla':null,editorialEditable:!naya,modulos:['calendario','eventos'],workspace:{current,canSwitch:true,canAttend:ws==='velai',options:OPTIONS}});
  if(url.pathname.endsWith('/stats'))return respond({total30:0,sinContactar:0,sinContactarDesde:null,fallidos7:0,tenantsActivos:1,porDia:[],porCanal:[],fuentes:[],captura:{conversaciones:0,leads:0,porCanal:[],desde:'2026-10-01',periodoCompleto:false}});
  if(url.pathname.endsWith('/editorial'))return respond({entries:[],mas:false});
  if(url.pathname.endsWith('/calendar'))return respond({calendar:null,confirmaciones:null});
  if(url.pathname.endsWith('/tenants'))return respond({tenants:[{id:tid,slug:'dialogos',name:'Diálogos que Enseñan',active:1}]});
  if(url.pathname.endsWith('/inbox'))return respond({items:[],counts:{all:0,needs_reply:0,unread:0}});
  if(url.pathname.endsWith('/availability'))return respond({available:true,follow_up_enabled:false});
  if(url.pathname.endsWith('/plantillas'))return respond({kinds:[],tenants:[]});
  return respond({error:'not_found'},404);
 });
 await page.goto('/calendario');
 const selector=page.getByRole('combobox',{name:'Espacio de trabajo',exact:true});
 await expect(selector).toHaveValue('velai');
 // Las opciones salen de /me, no de una lista fija del panel.
 await expect(selector.locator('option')).toHaveText(OPTIONS.map(o=>o.label));
 await expect(page.getByRole('tab',{name:'Finanzas',exact:true})).toBeVisible();
 await selector.selectOption('dialogos');
 await expect(page.getByRole('heading',{name:'Calendario — Diálogos que Enseñan',exact:true})).toBeVisible();
 await expect(selector).toHaveValue('dialogos');
 await expect(page.getByRole('tab',{name:'Finanzas',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Planificación',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'2026-10-16',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Añadir evento'}).getByLabel('Fecha')).toHaveValue('2026-10-16');
 await page.getByRole('dialog',{name:'Añadir evento'}).getByRole('button',{name:'Cancelar',exact:true}).click();
 expect(seen.some(c=>c.path===`/api/admin/tenants/${tid}/editorial`&&c.workspace==='dialogos')).toBe(true);
 expect(seen.filter(c=>c.workspace==='dialogos').some(c=>c.path==='/api/admin/tenants'||c.path.startsWith('/api/admin/gestion'))).toBe(false);
 await mkdir('/tmp/velai-workspace-qa',{recursive:true});await page.screenshot({path:'/tmp/velai-workspace-qa/dialogos-workspace-desktop.png',fullPage:true});
 await selector.selectOption('colegiale-sevilla');
 await expect(selector).toHaveValue('colegiale-sevilla');
 await expect(page).toHaveURL('https://panel.test/');
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'Eventos',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'Finanzas',exact:true})).toHaveCount(0);
 expect(seen.some(c=>c.path==='/api/admin/stats'&&c.workspace==='colegiale-sevilla')).toBe(true);
 expect(seen.filter(c=>c.workspace==='colegiale-sevilla').some(c=>c.path==='/api/admin/tenants'||c.path.startsWith('/api/admin/gestion'))).toBe(false);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/velai-workspace-qa/naya-workspace-mobile.png',fullPage:true});
 await selector.selectOption('velai');
 await expect(selector).toHaveValue('velai');await expect(page.getByRole('tab',{name:'Finanzas',exact:true})).toBeVisible();
 expect(seen.filter(c=>c.path==='/api/admin/me').map(c=>c.workspace)).toContain('velai');
 expect(seen.some(c=>c.path.includes('/logout'))).toBe(false);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

// La barra lateral de un admin socio (Gestión + Administración + Sistema) mide ~1000 px:
// en un portátil de 1366×657 «Impuestos… Salir» quedaban fuera, y en Conversaciones
// (body.wide, sin scroll de página) no había forma de llegar. Ahora scrollea por dentro.
test('la barra lateral scrollea por dentro y «Salir» queda alcanzable a 1366×657',async({page})=>{
 await page.setViewportSize({width:1366,height:657});
 const dist=join(dirname(fileURLToPath(import.meta.url)),'..','dist');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://panel.test')return route.abort();
  if(!url.pathname.startsWith('/api/admin/')){
   const relative=url.pathname.includes('/assets/')?url.pathname.slice(1):'index.html';
   return route.fulfill({path:join(dist,relative),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html'} as Record<string,string>)[extname(relative)]});
  }
  const respond=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname.endsWith('/me'))return respond({role:'velai',socio:true,tenantId:null,tenantName:null,tenantLogo:null,tenantSlug:null,editorialEditable:true,modulos:['calendario','eventos'],workspace:{current:'velai',canSwitch:true,canAttend:true,options:OPTIONS}});
  if(url.pathname.endsWith('/stats'))return respond({total30:0,sinContactar:0,sinContactarDesde:null,fallidos7:0,tenantsActivos:1,porDia:[],porCanal:[],fuentes:[],captura:{conversaciones:0,leads:0,porCanal:[],desde:'2026-10-01',periodoCompleto:false}});
  if(url.pathname.endsWith('/inbox'))return respond({conversations:[],counts:[],thread:null,queueMin:5,pingMin:5});
  if(url.pathname.endsWith('/alerts'))return respond({waiting:0,unread:0,lastInbound:null});
  if(url.pathname.endsWith('/availability'))return respond({available:false,withinHours:true,offering:false,advisors:0,hours:{},tz:'Europe/Madrid',graceMin:5,forTenant:'Velai'});
  if(url.pathname.endsWith('/tenants'))return respond({tenants:[]});
  return respond({error:'not_found'},404);
 });
 for(const path of['/conversaciones','/']){
  await page.goto(path);
  const side=page.locator('aside.side');
  await expect(page.getByRole('tab',{name:'Impuestos y asesoría',exact:true})).toBeAttached();
  const size=await side.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
  expect(size.scroll,path).toBeGreaterThan(size.client);
  const salir=page.getByRole('button',{name:'Salir',exact:true});
  await side.evaluate(el=>el.scrollTo(0,el.scrollHeight));
  await expect(salir).toBeInViewport();
  const box=(await salir.boundingBox())!;
  expect(box.y,path).toBeGreaterThanOrEqual(0);expect(box.y+box.height,path).toBeLessThanOrEqual(657);
  // Clicable de verdad: nada (ni el pie fijo) lo tapa en su centro. trial = sin salir de la sesión.
  const encima=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.textContent??'',{x:box.x+box.width/2,y:box.y+box.height/2});
  expect(encima,path).toContain('Salir');
  await salir.click({trial:true});
  // La barra sigue pegada arriba y la página no gana scroll horizontal.
  expect(await side.evaluate(el=>el.getBoundingClientRect().top),path).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
 }
});
