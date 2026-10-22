// El shell: la navegación la decide el rol (velai ve todo; el cliente solo lo suyo) y
// el tema de las vistas se conmuta y persiste por pestaña.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createQueryClient } from '../api/queryClient';
import { markSessionExpired, resetSession } from '../api/session';
import { ToastProvider } from '../components/Toasts';
import { availability, inbox, leadsPage1, meCliente, meVelai, mockFetch, stats, tenants } from '../test/fixtures';
import type { Me } from '../api/types';
import { WORKSPACE_KEY, WORKSPACE_LABEL_KEY, reloadWorkspace } from '../workspace';
vi.mock('../workspace',async importOriginal=>({...await importOriginal<typeof import('../workspace')>(),reloadWorkspace:vi.fn()}));

function renderApp(me: Me, path = '/') {
  vi.stubGlobal(
    'fetch',
    vi.fn(mockFetch({
      '/api/admin/me': me,
      '/api/admin/stats': stats,
      '/api/admin/channels': { channels: [], unrouted: [] },
      '/api/admin/tenants': tenants,
      '/api/admin/leads': leadsPage1,
      '/api/admin/inbox': inbox,
      '/api/admin/availability': availability,
      '/api/admin/escalations': { escalations: [] },
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
      '/api/admin/ai-balance': { month: '2026-08', included: 1, used: 0, remaining: 1, pct: 0, over: false, usedToday: 0, calls: 0, serie: [] },
    })),
  );
  const client = createQueryClient();
  const rendered = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return {...rendered,client};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(reloadWorkspace).mockClear();
  document.body.className = '';
  sessionStorage.clear();
});

describe('shell y navegación por rol', () => {
  it('velai ve la gestión completa: Clientes, Canales y Configuración', async () => {
    renderApp(meVelai);
    await waitFor(() => expect(screen.getByRole('tab', { name: /clientes/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Eventos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /canales/i })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Sistema' })).getByRole('tab', { name: 'Diagnóstico de canales' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /configuración/i })).toBeInTheDocument();
    expect(document.body.classList.contains('cliente')).toBe(false);
  });

  it('el cliente NO ve las vistas de Velai, y su nombre viste la cabecera', async () => {
    renderApp(meCliente);
    // Las comunes están…
    await waitFor(() => expect(screen.getByRole('tab', { name: /conversaciones/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /leads/i })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /calendario/i })).toBeInTheDocument();
    // …y las de Velai, no (la defensa real es del worker; esto es la interfaz).
    await waitFor(() => expect(document.body.classList.contains('cliente')).toBe(true));
    // Sus plantillas (solo lectura) también son suyas, tras Conexiones.
    expect(screen.getByRole('tab', { name: /plantillas/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /clientes/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /canales/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /configuración/i })).toBeNull();
    expect(screen.getByText('Barbería López')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/admin/channels'))).toBe(false);
  });

  it('sin módulos oculta Calendario y Eventos y cierra las rutas directas', async () => {
    renderApp({ ...meCliente, plan: 'esencial', modulos: [] }, '/calendario');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByRole('tab', { name: 'Calendario' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Eventos' })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /appointments|\/calendar/.test(String(url)))).toBe(false);
  });
  it('Eventos depende del derecho aunque la cuenta no tenga datos', async () => {
    renderApp({ ...meCliente, modulos: ['eventos'] });
    await screen.findByRole('tab', { name: 'Eventos' });
    expect(screen.queryByRole('tab', { name: 'Calendario' })).toBeNull();
  });

  it('el tema de las vistas se conmuta y se recuerda POR PESTAÑA (sessionStorage)', async () => {
    renderApp(meVelai);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /tema oscuro/i });
    expect(document.body.classList.contains('dark')).toBe(false);
    await user.click(btn);
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(sessionStorage.getItem('velai-panel-dark')).toBe('1');
    await user.click(screen.getByRole('button', { name: /tema claro/i }));
    expect(document.body.classList.contains('dark')).toBe(false);
  });

  it('Conversaciones es la única vista a pantalla completa (body.wide)', async () => {
    renderApp(meVelai, '/conversaciones');
    await waitFor(() => expect(document.body.classList.contains('wide')).toBe(true));
  });

  it('«Activar avisos»: preferencia por pestaña y aviso de que puede llegar mudo', async () => {
    renderApp(meVelai);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /activar avisos/i });
    // El tooltip explica que el navegador exige un clic antes de poder sonar.
    expect(btn.getAttribute('data-tip')).toMatch(/puede llegar mudo/);
    await user.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: /avisos activados/i })).toBeInTheDocument());
    expect(sessionStorage.getItem('velai-panel-alerts')).toBe('1');
    // El toast dice la verdad: sin permiso de notificaciones, solo sonará.
    await waitFor(() => expect(screen.getByText(/Avisos activados ✓/)).toBeInTheDocument());
    // Apagar limpia la preferencia.
    await user.click(screen.getByRole('button', { name: /avisos activados/i }));
    expect(sessionStorage.getItem('velai-panel-alerts')).toBe('');
  });

  it('el pie firma de Velai aunque el panel sea de un cliente', async () => {
    const { container } = renderApp(meCliente);
    await waitFor(() => expect(screen.getByText(/todos los derechos reservados/i)).toBeInTheDocument());
    expect(container.querySelector('.foot')).toHaveTextContent('Velai');
  });
});

it('el pie firma la versión desplegada — es lo que distingue un deploy de otro a ojo', () => {
  renderApp(meVelai);
  // vX.Y.Z · commit: la semántica la sube una persona; el commit cambia solo en cada
  // deploy. Si esto desaparece del pie, volvemos al «¿estoy viendo el nuevo o el viejo?».
  expect(document.querySelector('.foot-ver')?.textContent).toMatch(/^v\d+\.\d+\.\d+ · \S+$/);
});

it('cuando Access caduca, el marco avisa una vez y ofrece entrar sin perder el borrador', async () => {
  resetSession();
  renderApp(meVelai);
  await waitFor(() => expect(screen.getByText(/todos los derechos reservados/i)).toBeInTheDocument());
  expect(screen.queryByRole('alert')).toBeNull();

  markSessionExpired();

  const aviso = await screen.findByRole('alert');
  expect(aviso).toHaveTextContent(/Tu sesión caducó/);
  // Abre OTRA pestaña: recargar esta tiraría el formulario a medio escribir.
  const abrir = vi.fn();
  vi.stubGlobal('open', abrir);
  await userEvent.click(screen.getByRole('button', { name: /entrar en otra pestaña/i }));
  expect(abrir).toHaveBeenCalledWith(window.location.origin, '_blank', 'noopener');
  resetSession();
});

// Las opciones las manda el worker (clientes con «Espacio de Velai»): el panel no tiene lista fija.
const OPTIONS=[{id:'velai',label:'Velai · Admin'},{id:'dialogos',label:'Diálogos que Enseñan'},{id:'colegiale-sevilla',label:'NAYA Eventos'}];
const ws=(current:string,canSwitch=true)=>({current,canSwitch,...(canSwitch?{options:OPTIONS}:{})});

describe('selector del espacio autenticado',()=>{
 it('solo aparece con capacidad autorizada y cambia a Diálogos sin logout',async()=>{
  const user=userEvent.setup();renderApp({...meVelai,workspace:ws('velai')});
  const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
  expect(select).toHaveValue('velai');await user.selectOptions(select,'dialogos');
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('dialogos'));
  expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('dialogos');expect(sessionStorage.getItem(WORKSPACE_LABEL_KEY)).toBe('Diálogos que Enseñan');
 });
 it('pinta exactamente las opciones del worker, también un cliente nuevo',async()=>{
  const options=[...OPTIONS,{id:'zoe',label:'Zoe Estética'}];
  const user=userEvent.setup();renderApp({...meVelai,workspace:{current:'velai',canSwitch:true,options}});
  const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
  expect(within(select).getAllByRole('option').map(o=>[(o as HTMLOptionElement).value,o.textContent])).toEqual(options.map(o=>[o.id,o.label]));
  await user.selectOptions(select,'zoe');
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('zoe'));
  expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('zoe');expect(sessionStorage.getItem(WORKSPACE_LABEL_KEY)).toBe('Zoe Estética');
 });
 it('sin opciones del worker solo ofrece Velai y el espacio abierto',async()=>{
  renderApp({...meCliente,workspace:{current:'dialogos',canSwitch:true,label:'Diálogos que Enseñan'}});
  const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
  expect(select).toHaveValue('dialogos');
  expect(within(select).getAllByRole('option').map(o=>o.textContent)).toEqual(['Velai · Admin','Diálogos que Enseñan']);
 });
 it('admin cambia de Diálogos a NAYA conservando sesión y borrando consultas',async()=>{
  sessionStorage.setItem(WORKSPACE_KEY,'dialogos');
  const user=userEvent.setup();const {client}=renderApp({...meCliente,workspace:ws('dialogos')});
  const clear=vi.spyOn(client,'clear');const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
  expect(within(select).getByRole('option',{name:'NAYA Eventos'})).toHaveValue('colegiale-sevilla');
  await user.selectOptions(select,'colegiale-sevilla');
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('colegiale-sevilla'));
  expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('colegiale-sevilla');expect(clear).toHaveBeenCalledTimes(1);
 });
 it('admin vuelve de NAYA a Velai y clientes NAYA normales no pueden rotar',async()=>{
  // `naya` guardado antes de la migración 0058: el worker lo resuelve al slug real.
  sessionStorage.setItem(WORKSPACE_KEY,'naya');
  const user=userEvent.setup();const {unmount}=renderApp({...meCliente,tenantName:'NAYA Eventos',tenantSlug:'colegiale-sevilla',workspace:ws('colegiale-sevilla')});
  const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});expect(select).toHaveValue('colegiale-sevilla');
  await user.selectOptions(select,'velai');
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('velai'));expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();
  unmount();renderApp({...meCliente,tenantName:'NAYA Eventos',workspace:ws('colegiale-sevilla',false)});
  await screen.findByText('NAYA Eventos');expect(screen.queryByRole('combobox',{name:'Espacio de trabajo'})).not.toBeInTheDocument();
 });
 it('el administrador puede volver desde Diálogos a Velai en la misma sesión',async()=>{
  sessionStorage.setItem(WORKSPACE_KEY,'dialogos');
  const user=userEvent.setup();renderApp({...meCliente,workspace:ws('dialogos')});
  await user.selectOptions(await screen.findByRole('combobox',{name:'Espacio de trabajo'}),'velai');
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('velai'));expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();
 });
 it('cliente propio sin capacidad de cambio no ve el selector',async()=>{
  renderApp({...meCliente,workspace:ws('dialogos',false)});
  await screen.findByText('Barbería López');expect(screen.queryByRole('combobox',{name:'Espacio de trabajo'})).not.toBeInTheDocument();
 });
 it('bloquea cambio si hay un diálogo abierto en lugar de descartar el formulario',async()=>{
  const user=userEvent.setup();renderApp({...meVelai,workspace:ws('velai')});
  const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
  const dialog=document.createElement('dialog');dialog.open=true;Object.defineProperty(dialog,'getClientRects',{value:()=>[new DOMRect(0,0,50,20)]});document.body.append(dialog);
  try{await user.selectOptions(select,'dialogos');expect(reloadWorkspace).not.toHaveBeenCalled();expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();}finally{dialog.remove();}
 });
});
it('selector se desactiva mientras hay una mutación pendiente',async()=>{
 const {client}=renderApp({...meVelai,workspace:ws('velai')});
 const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
 let finish!:()=>void;const mutation=client.getMutationCache().build(client,{mutationFn:()=>new Promise<void>(resolve=>{finish=resolve;})});
 const pending=mutation.execute(undefined);await waitFor(()=>expect(select).toBeDisabled());
 finish();await pending;await waitFor(()=>expect(select).toBeEnabled());
});
it('cambiar de espacio pide permiso antes de descartar un formulario modificado',async()=>{
 const user=userEvent.setup();renderApp({...meVelai,workspace:ws('velai')});
 const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
 const form=document.createElement('form'),input=document.createElement('input');form.append(input);document.body.append(form);Object.defineProperty(form,'getClientRects',{value:()=>[new DOMRect(0,0,50,20)]});
 try{
  await user.type(input,'Borrador');await user.selectOptions(select,'dialogos');
  const dialog=await screen.findByRole('dialog',{name:'¿Cambiar de espacio?'});
  expect(reloadWorkspace).not.toHaveBeenCalled();expect(select).toBeDisabled();
  await user.click(within(dialog).getByRole('button',{name:'Cancelar'}));
  expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();await waitFor(()=>expect(select).toBeEnabled());
  await user.selectOptions(select,'dialogos');
  await user.click(within(await screen.findByRole('dialog',{name:'¿Cambiar de espacio?'})).getByRole('button',{name:'Cambiar de espacio'}));
  await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledTimes(1));
 }finally{form.remove();}
});

it.each([{code:'workspace_unavailable',status:403},{code:'workspace_unavailable',status:503},{code:'workspace_not_found',status:404}])('ofrece volver explícitamente a Velai si Diálogos falla con $code/$status',async({code,status})=>{
 sessionStorage.setItem(WORKSPACE_KEY,'dialogos');sessionStorage.setItem(WORKSPACE_LABEL_KEY,'Diálogos que Enseñan');
 const {client}=renderApp({...meVelai,workspace:ws('velai')});
 await screen.findByRole('combobox',{name:'Espacio de trabajo'});
 const clear=vi.spyOn(client,'clear');
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/admin/me'?Response.json({error:code},{status}):originalFetch(input,init));
 // The pending /me may already have been queued by render; invalidate it to exercise the failed identity lookup.
 await client.invalidateQueries({queryKey:['me']});
 const back=await screen.findByRole('button',{name:'Volver a Velai'});
 expect(screen.getByText('No se pudo abrir Diálogos que Enseñan')).toBeInTheDocument();
 expect(sessionStorage.getItem(WORKSPACE_KEY)).toBe('dialogos');expect(reloadWorkspace).not.toHaveBeenCalled();
 await userEvent.setup().click(back);
 await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('velai'));
 expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();expect(sessionStorage.getItem(WORKSPACE_LABEL_KEY)).toBeNull();expect(clear).toHaveBeenCalledTimes(1);
});
it('bloquea el cambio con un diálogo personalizado visible',async()=>{
 const user=userEvent.setup();renderApp({...meVelai,workspace:ws('velai')});
 const select=await screen.findByRole('combobox',{name:'Espacio de trabajo'});
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');Object.defineProperty(dialog,'getClientRects',{value:()=>[new DOMRect(0,0,50,20)]});document.body.append(dialog);
 try{await user.selectOptions(select,'dialogos');expect(reloadWorkspace).not.toHaveBeenCalled();expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();}finally{dialog.remove();}
});

it.each([
 {stored:'colegiale-sevilla',label:'NAYA Eventos',shown:'No se pudo abrir NAYA Eventos'},
 {stored:'zoe',label:'Zoe Estética',shown:'No se pudo abrir Zoe Estética'},
 // Elección guardada antes de 0058, sin nombre: se dice el id, nunca otro espacio fijo.
 {stored:'naya',label:null,shown:'No se pudo abrir naya'},
])('espacio inaccesible ($stored) ofrece volver a Velai con su nombre real',async({stored,label,shown})=>{
 sessionStorage.setItem(WORKSPACE_KEY,stored);if(label)sessionStorage.setItem(WORKSPACE_LABEL_KEY,label);
 const {client}=renderApp({...meVelai,workspace:ws('velai')});
 await screen.findByRole('combobox',{name:'Espacio de trabajo'});
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input)==='/api/admin/me'?Response.json({error:'workspace_unavailable'},{status:403}):originalFetch(input,init));
 await client.invalidateQueries({queryKey:['me']});
 expect(await screen.findByText(shown)).toBeInTheDocument();
 expect(screen.queryByText(/No se pudo abrir (NAYA|Diálogos)$/)).not.toBeInTheDocument();
 await userEvent.setup().click(screen.getByRole('button',{name:'Volver a Velai'}));
 await waitFor(()=>expect(reloadWorkspace).toHaveBeenCalledWith('velai'));
 expect(sessionStorage.getItem(WORKSPACE_KEY)).toBeNull();
});
