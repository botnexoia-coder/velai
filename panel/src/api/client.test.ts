import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, apiDownload, apiPost } from './client';
import { isSessionExpired, resetSession } from './session';
import { storeWorkspace, WORKSPACE_KEY } from '../workspace';
const mode=vi.hoisted(()=>({preview:false}));
vi.mock('../mobilePreview',async importOriginal=>({...await importOriginal<typeof import('../mobilePreview')>(),get MOBILE_PREVIEW(){return mode.preview;}}));
beforeEach(()=>{sessionStorage.clear();resetSession();mode.preview=false;});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear();mode.preview=false;resetSession();});
it('espacio Velai omite cabecera; Diálogos la aplica y conserva JSON y FormData',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({ok:true})));vi.stubGlobal('fetch',fetcher);
 await apiPost('/api/admin/example',{value:1});
 expect(new Headers(fetcher.mock.calls[0]?.[1].headers).has('X-Velai-Workspace')).toBe(false);
 storeWorkspace('dialogos');await apiPost('/api/admin/example',{value:2});
 let headers=new Headers(fetcher.mock.calls[1]?.[1].headers);expect(headers.get('X-Velai-Workspace')).toBe('dialogos');expect(headers.get('Content-Type')).toBe('application/json');
 const data=new FormData();data.set('archivo','texto');await api('/api/admin/example',{method:'POST',body:data,headers:{'X-Request':'preserved'}});
 headers=new Headers(fetcher.mock.calls[2]?.[1].headers);expect(headers.get('X-Velai-Workspace')).toBe('dialogos');expect(headers.get('X-Request')).toBe('preserved');expect(headers.has('Content-Type')).toBe(false);
 expect(fetcher.mock.calls[2]?.[1].body).toBe(data);
 expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('dialogos');
});
it('preview ignora elección y cabecera inyectada; rechaza métodos de escritura',async()=>{
 sessionStorage.setItem(WORKSPACE_KEY,'dialogos');mode.preview=true;
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({ok:true})));vi.stubGlobal('fetch',fetcher);
 await api('/api/admin/me',{headers:{'X-Velai-Workspace':'dialogos'}});
 expect(new Headers(fetcher.mock.calls[0]?.[1].headers).has('X-Velai-Workspace')).toBe(false);
 await expect(apiPost('/api/admin/example',{})).rejects.toMatchObject({status:405,message:'mobile_preview_read_only'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('descarta respuesta JSON del espacio anterior después de cambiar la selección',async()=>{
 let finish!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const result=api('/api/admin/me');storeWorkspace('dialogos');finish(Response.json({role:'velai'}));
 await expect(result).rejects.toMatchObject({message:'workspace_changed',status:409});
});
it('CSV usa fetch con contexto y descarga texto, sin intentar JSON',async()=>{
 storeWorkspace('dialogos');const response=new Response('nombre,fecha\nPersona,2026-10-12',{headers:{'Content-Type':'text/csv; charset=utf-8'}});
 const json=vi.spyOn(response,'json');const fetcher=vi.fn().mockResolvedValue(response);vi.stubGlobal('fetch',fetcher);
 const create=vi.fn((_blob:Blob)=> 'blob:csv');Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 const clicked:HTMLAnchorElement[]=[];vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){clicked.push(this);});
 await apiDownload('/api/admin/leads/export.csv?status=new','leads.csv');
 expect(json).not.toHaveBeenCalled();expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
 expect(clicked[0]?.download).toBe('leads.csv');expect(clicked[0]?.href).toBe('blob:csv');
 expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get('X-Velai-Workspace')).toBe('dialogos');expect(fetcher.mock.calls[0]?.[1].redirect).toBe('manual');
});
it('CSV rechaza redirects de sesión y respuestas JSON de error sin crear descarga',async()=>{
 const fetcher=vi.fn().mockResolvedValue({type:'opaqueredirect',status:0});vi.stubGlobal('fetch',fetcher);
 await expect(apiDownload('/api/admin/leads/export.csv','leads.csv')).rejects.toMatchObject({message:'session_expired'});expect(isSessionExpired()).toBe(true);
 fetcher.mockResolvedValue(Response.json({error:'not_authorized'},{status:403}));
 await expect(apiDownload('/api/admin/leads/export.csv','leads.csv')).rejects.toMatchObject({message:'not_authorized',status:403});
 fetcher.mockResolvedValue(Response.json({ok:true}));
 await expect(apiDownload('/api/admin/leads/export.csv','leads.csv')).rejects.toMatchObject({message:'invalid_download'});
});
it('CSV no descarga si cambia el espacio mientras llega el archivo',async()=>{
 let finish!:(value:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const download=apiDownload('/api/admin/leads/export.csv','leads.csv');storeWorkspace('dialogos');finish(new Response('CSV',{headers:{'Content-Type':'text/csv'}}));
 await expect(download).rejects.toMatchObject({message:'workspace_changed'});
});
it('elección antigua tras otro login reintenta /me una sola vez en el espacio propio',async()=>{
 storeWorkspace('dialogos');const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'not_authorized'},{status:403})).mockResolvedValueOnce(Response.json({role:'cliente',tenantSlug:'zoe',workspace:{current:'velai',canSwitch:false}}));vi.stubGlobal('fetch',fetcher);
 expect(await api('/api/admin/me')).toMatchObject({role:'cliente',tenantSlug:'zoe'});expect(fetcher).toHaveBeenCalledTimes(2);
 expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get('X-Velai-Workspace')).toBe('dialogos');expect(new Headers(fetcher.mock.calls[1]?.[1].headers).has('X-Velai-Workspace')).toBe(false);expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();
});
it('recuperación /me termina en dos intentos si el espacio base también deniega',async()=>{
 storeWorkspace('dialogos');const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({error:'not_authorized'},{status:403})));vi.stubGlobal('fetch',fetcher);
 await expect(api('/api/admin/me')).rejects.toMatchObject({status:403,message:'not_authorized'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('un espacio inaccesible o una ruta distinta no cambia la elección automáticamente',async()=>{
 storeWorkspace('dialogos');const fetcher=vi.fn().mockResolvedValue(Response.json({error:'workspace_unavailable'},{status:403}));vi.stubGlobal('fetch',fetcher);
 await expect(api('/api/admin/me')).rejects.toMatchObject({message:'workspace_unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('dialogos');
 fetcher.mockResolvedValue(Response.json({error:'not_authorized'},{status:403}));await expect(api('/api/admin/stats')).rejects.toMatchObject({message:'not_authorized'});expect(fetcher).toHaveBeenCalledTimes(2);expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('dialogos');
});
it('descarta también una respuesta cuya decodificación termina tras cambiar de espacio',async()=>{
 let bodyStarted!:()=>void,finish!:(value:unknown)=>void;const started=new Promise<void>(resolve=>{bodyStarted=resolve;});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({status:200,ok:true,type:'basic',json:()=>{bodyStarted();return new Promise(resolve=>{finish=resolve;});}}));
 const result=api('/api/admin/me');await started;storeWorkspace('dialogos');finish({role:'velai'});
 await expect(result).rejects.toMatchObject({message:'workspace_changed'});
});
