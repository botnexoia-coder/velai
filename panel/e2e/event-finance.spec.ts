import { test as base, expect } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { finanzasFixture } from '../../test/helpers/finanzas-fixture.js';

const tenant='11111111-1111-4111-8111-111111111111', eventA='22222222-2222-4222-8222-222222222222',eventB='33333333-3333-4333-8333-333333333333';
const test=base.extend<{fixture:Awaited<ReturnType<typeof finanzasFixture>>;seen:{path:string;method:string;body:unknown}[]}>({
 seen:async({},use)=>use([]),
 fixture:async({page,seen},use)=>{
  const f=await finanzasFixture();
  await f.DB.prepare("INSERT INTO tenants(id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(tenant,'naya-qa','NAYA QA','web:naya-qa','Contexto QA','2026-10-12','2026-10-12').run();
  for(const[id,slug,name]of[[eventA,'fiesta-a','Fiesta A QA'],[eventB,'fiesta-b','Fiesta B QA']])await f.DB.prepare("INSERT INTO tenant_events(id,tenant_id,slug,name,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)").bind(id,tenant,slug,name,'2026-10-12','2026-10-12').run();
  const api=async(path:string,body:unknown)=>{
   const response=await f.request(new Request('https://panel.test/api/admin/gestion/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
   const data=await response.json();expect(response.status,JSON.stringify(data)).toBeLessThan(300);return data;
  };
  await api('compras',{id:crypto.randomUUID(),concepto:'Actuación fiesta A',negocio:'dialogos',moneda:'EUR',estimado:25000,estado:'comprometida',evento_id:eventA,categoria:'Artistas'});
  await api('compras',{id:crypto.randomUUID(),concepto:'Viaje fiesta B',negocio:'dialogos',moneda:'EUR',estimado:11000,estado:'prevista',evento_id:eventB,categoria:'Viajes'});
  await api('cuentas',{id:crypto.randomUUID(),nombre:'Cuenta evento QA',moneda:'EUR',saldo_inicial:0,entidad_id:null,fecha_saldo:null,conciliada:0});
  const dist=join(dirname(fileURLToPath(import.meta.url)),'..','dist');
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!=='https://panel.test')return route.abort();
   if(url.pathname.startsWith('/api/admin/')){
    seen.push({path:url.pathname+url.search,method:req.method(),body:req.postData()?req.postDataJSON():null});
    const response=await f.request(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()||undefined}));
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   }
   const mobile=url.pathname.startsWith('/prueba-movil/');const relative=url.pathname.includes('/assets/')?url.pathname.slice(1):mobile?'prueba-movil/index.html':'index.html';
   return route.fulfill({path:join(dist,relative),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html'}as Record<string,string>)[extname(relative)]});
  });
  try{await use(f);}finally{await f.close();}
 },
});
test.use({locale:'es-ES',timezoneId:'Europe/Madrid'});

test('presupuesto SQLite real: Hecho solo avance y cambio de evento aislado, filtros del libro',async({page,fixture,seen})=>{
 await page.goto('/eventos');
 await page.getByRole('combobox',{name:'Evento',exact:true}).selectOption(eventA);
 await page.getByRole('button',{name:'Presupuesto y gastos',exact:true}).click();
 const region=page.getByRole('region',{name:'Presupuesto del evento'});
 await expect(region.getByRole('button',{name:'Actuación fiesta A',exact:true})).toBeVisible();
 await expect(region.getByRole('button',{name:'Viaje fiesta B',exact:true})).toHaveCount(0);
 await expect(region.getByRole('combobox',{name:'Proyecto',exact:true})).toBeDisabled();await expect(region.getByRole('combobox',{name:'Evento',exact:true})).toBeDisabled();
 await region.getByRole('button',{name:'Limpiar filtros'}).click();
 await expect(region.getByRole('combobox',{name:'Evento',exact:true})).toHaveValue(eventA);
 const cashBefore=await fixture.DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first();
 await region.getByRole('checkbox',{name:'Hecho: Actuación fiesta A'}).click();
 await expect(region.getByRole('checkbox',{name:'Hecho: Actuación fiesta A'})).toBeChecked();
 const patch=seen.find(c=>c.method==='PATCH');expect(patch?.body).toEqual({version:1,hecho:true});
 expect(await fixture.DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first()).toEqual(cashBefore);
 expect((await fixture.DB.prepare('SELECT hecho FROM g_compras WHERE evento_id=?').bind(eventA).first())?.hecho).toBe(1);
 await region.getByRole('button',{name:'Registrar cobro del evento'}).click();
 await page.getByRole('dialog',{name:'Registrar cobro del evento'}).getByLabel('Importe cobrado (EUR)').fill('25,25');
 // Cambiar evento destruye el formulario anterior y su contexto.
 await page.keyboard.press('Escape');
 await page.getByRole('dialog',{name:'¿Descartar los cambios?'}).getByRole('button',{name:'Descartar',exact:true}).click();
 await page.getByRole('combobox',{name:'Evento',exact:true}).first().selectOption(eventB);
 await expect(region.getByRole('button',{name:'Viaje fiesta B',exact:true})).toBeVisible();
 await expect(region.getByRole('button',{name:'Actuación fiesta A',exact:true})).toHaveCount(0);
 await region.getByRole('button',{name:'Registrar cobro del evento'}).click();
 await expect(page.getByRole('dialog',{name:'Registrar cobro del evento'}).getByLabel('Importe cobrado (EUR)')).toHaveValue('');
 await page.keyboard.press('Escape');
 await mkdir('/tmp/velai-event-finance-qa',{recursive:true});await page.screenshot({path:'/tmp/velai-event-finance-qa/event-budget-desktop.png',fullPage:true});
 await page.goto('/finanzas');
 await page.getByRole('combobox',{name:'Evento',exact:true}).selectOption(eventB);
 await expect.poll(()=>seen.filter(c=>c.path.startsWith('/api/admin/finanzas/resumen?')).at(-1)?.path).toContain(`evento=${eventB}`);
 await expect.poll(()=>seen.filter(c=>c.path.startsWith('/api/admin/finanzas/movimientos?')).at(-1)?.path).toContain(`evento=${eventB}`);
});

test('presupuesto móvil de lectura mantiene contexto y no desborda',async({page,fixture,seen})=>{
 void fixture;await page.setViewportSize({width:390,height:844});
 await page.goto('/prueba-movil/eventos');
 await page.getByRole('button',{name:'Presupuesto y gastos',exact:true}).focus();await page.keyboard.press('Enter');
 const region=page.getByRole('region',{name:'Presupuesto del evento'});
 await expect(region.getByRole('heading',{name:'Presupuesto y gastos'})).toBeVisible();
 await expect(region.getByRole('button',{name:'Registrar cobro del evento'})).toHaveCount(0);
 await expect(region.getByRole('button',{name:'Añadir compra'})).toHaveCount(0);
 const checkbox=region.getByRole('checkbox').first();await expect(checkbox).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(seen.every(c=>c.method==='GET'&&c.path.startsWith('/api/admin/mobile-preview/'))).toBe(true);
 await mkdir('/tmp/velai-event-finance-qa',{recursive:true});await page.screenshot({path:'/tmp/velai-event-finance-qa/event-budget-mobile.png',fullPage:true});
});

test('compras móviles: dos compradores y un solo importe',async({page,fixture,seen})=>{
 const id=crypto.randomUUID();
 const create=await fixture.request(new Request('https://panel.test/api/admin/gestion/compras',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,concepto:'Compra conjunta QA',negocio:'dialogos',moneda:'EUR',estimado:1000,estado:'comprometida',comprador:'Ana'})}));expect(create.status).toBe(201);
 const buy=await fixture.request(new Request(`https://panel.test/api/admin/gestion/compras/${id}/comprar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,real:1000,comprador:'Ana',proveedor:'Proveedor QA'})}));expect(buy.status).toBe(200);
 await page.setViewportSize({width:390,height:844});await page.goto('/compras');
 await expect(page.getByRole('combobox',{name:'Estado',exact:true})).toHaveValue('activas');
 await page.getByRole('button',{name:'Compra conjunta QA',exact:true}).click();
 await page.getByRole('button',{name:'Editar datos',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Editar datos de la compra'});
 await expect(form.getByRole('combobox',{name:'Quién compra',exact:true})).toHaveValue('Ana');
 await form.getByRole('button',{name:'Añadir otra persona'}).click();
 await form.getByRole('combobox',{name:'Otra persona (2)'}).selectOption('Luis');
 await page.screenshot({path:test.info().outputPath('compradores-mobile.png'),fullPage:true});
 await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Compra conjunta QA'})).toContainText('Ana y Luis');
 await page.getByRole('dialog',{name:'Compra conjunta QA'}).getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.reload();await expect(page.locator('.g-chart')).toContainText('Ana y Luis');
 await expect(page.locator('.g-chart-row')).toHaveCount(1);
 await expect(page.getByText('compras realizadas',{exact:true}).locator('..')).toContainText('€ 10,00');
 await page.getByRole('combobox',{name:'Comprado por',exact:true}).selectOption('Luis');
 await expect(page.getByRole('button',{name:'Compra conjunta QA',exact:true})).toBeVisible();
 expect((await fixture.DB.prepare('SELECT comprador FROM g_compras WHERE id=?').bind(id).first())?.comprador).toBe('Ana y Luis');
 expect((await fixture.DB.prepare('SELECT count(*) n FROM g_pagos').first())?.n).toBe(0);
 expect(seen.filter(r=>r.method==='PATCH')).toHaveLength(1);
 await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
 await page.screenshot({path:test.info().outputPath('compras-mobile.png'),fullPage:true});
});
