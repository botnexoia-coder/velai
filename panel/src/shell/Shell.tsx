// El marco del panel: barra lateral con navegación por rol, tema de las vistas y pie.
//
// REGLA DE MARCA (decisión del dueño, no negociable): toda superficie de NAVEGACIÓN va
// oscura SIEMPRE — sidebar, topbar móvil — aunque el tema de las vistas sea claro. Lo
// garantiza el CSS: la .side usa los tokens oscuros de :root, que ningún tema toca.
//
// El rol decide la interfaz, pero la DEFENSA es del worker: cada endpoint valida el
// scope por su cuenta.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { confirmar } from '../components/Confirmar';
import { storeWorkspace, reloadWorkspace, workspaceChoice, workspaceLabel, type Workspace } from '../workspace';
import type { WorkspaceOption } from '../api/types';
import './workspace.css';
import { isSessionExpired, subscribeSession } from '../api/session';
import { useMe } from '../hooks/queries';
import { useAvisos } from '../hooks/avisos';
import { useToast } from '../components/Toasts';
import { MOBILE_PREVIEW } from '../mobilePreview';
import {
  IcoBell,
  IcoBriefcase,
  IcoCalendar,
  IcoChannels,
  IcoChat,
  IcoDashboard,
  IcoLeads,
  IcoLink,
  IcoLogout,
  IcoMoon,
  IcoSliders,
  IcoSun,
  IcoTemplate,
} from '../components/icons';

const SS_DARK = 'velai-panel-dark';

// La elección se recuerda POR PESTAÑA en sessionStorage — la invariante del panel
// prohíbe el almacenamiento persistente del navegador.
function readDark(): boolean {
  try {
    return sessionStorage.getItem(SS_DARK) === '1';
  } catch {
    return false;
  }
}

function Tab({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => `tab${isActive ? ' is-on' : ''}`} role="tab" end={to === '/'}>
      {icon}
      {label}
    </NavLink>
  );
}

export function Shell() {
  const mutations = useIsMutating();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);
  const switchLock = useRef(false);
  const dirtyForms = useRef(new WeakSet<HTMLFormElement>());
  const [mobileMenu, setMobileMenu] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const closeMobileMenu = () => { setMobileMenu(false); moreButton.current?.focus(); };
  const { data: me, error: meError } = useMe();
  const [dark, setDark] = useState(readDark);
  const location = useLocation();
  const isVelai = me?.role === 'velai';
  const isCliente = me?.role === 'cliente';
  const toast = useToast();
  const avisos = useAvisos(toast);
  const workspaceUnavailable = !MOBILE_PREVIEW && workspaceChoice() !== 'velai' && meError instanceof Error && ['workspace_unavailable', 'workspace_not_found'].includes(meError.message);
  // Las opciones las da el worker (clientes con «Espacio de Velai»). Si el actual no
  // viniera en la lista —un worker antiguo, o el espacio se apagó a medias— se añade para
  // que el <select> no enseñe otro espacio distinto del que de verdad está abierto.
  const workspaceOptions: WorkspaceOption[] = (() => {
    const ws = me?.workspace;
    const list = ws?.options?.length ? ws.options : [{ id: 'velai', label: 'Velai · Admin' }];
    return ws && !list.some(o => o.id === ws.current) ? [...list, { id: ws.current, label: ws.label || ws.current }] : list;
  })();
  useEffect(() => {
    const changed = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const form = event.target.closest('form');
      if (form instanceof HTMLFormElement) dirtyForms.current.add(form);
    };
    document.addEventListener('input', changed, true); document.addEventListener('change', changed, true);
    return () => { document.removeEventListener('input', changed, true); document.removeEventListener('change', changed, true); };
  }, []);
  async function switchWorkspace(workspace: Workspace, recovering = false) {
    if (MOBILE_PREVIEW || mutations || switchLock.current) return;
    if (recovering ? !workspaceUnavailable : !me?.workspace?.canSwitch || workspace === me.workspace.current) return;
    if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"]')).some(dialog => dialog.getClientRects().length > 0)) { toast('Cierra o termina el formulario abierto antes de cambiar de espacio.', false); return; }
    switchLock.current = true; setSwitching(true);
    let navigating = false;
    try {
      const dirty = Array.from(document.querySelectorAll('form')).some(form => dirtyForms.current.has(form) && form.getClientRects().length > 0);
      if (dirty && !(await confirmar({ titulo: '¿Cambiar de espacio?', cuerpo: 'Los cambios del formulario que no hayas guardado se perderán.', accion: 'Cambiar de espacio', peligro: true }))) return;
      if (queryClient.isMutating()) return;
      if (!storeWorkspace(workspace, workspaceOptions.find(o => o.id === workspace)?.label)) { toast('No se pudo recordar el espacio. Permite el almacenamiento de esta pestaña y reintenta.', false); return; }
      await queryClient.cancelQueries(); queryClient.clear();
      navigating = true; reloadWorkspace(workspace);
    } finally {
      if (!navigating) { switchLock.current = false; setSwitching(false); }
    }
  }

  useEffect(() => {
    if (document.getElementById('panel-navigation')?.contains(document.activeElement)) moreButton.current?.focus();
    setMobileMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    document.body.classList.toggle('mobile-preview', MOBILE_PREVIEW);
    return () => document.body.classList.remove('mobile-preview');
  }, []);

  // Tema de las VISTAS: claro por defecto, body.dark las devuelve al oscuro. La barra
  // lateral no cambia nunca.
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    try {
      sessionStorage.setItem(SS_DARK, dark ? '1' : '');
    } catch {
      /* sin sessionStorage, el tema simplemente no se recuerda */
    }
  }, [dark]);

  // Rol en el <body> para los ganchos CSS compartidos (velai-only / cliente-only).
  useEffect(() => {
    document.body.classList.toggle('cliente', isCliente);
  }, [isCliente]);

  // Conversaciones es la única vista a pantalla completa: body.wide quita el padding de
  // main y fija el alto para que scrolleen los paneles y no la página.
  const wide = location.pathname === '/conversaciones';
  useEffect(() => {
    document.body.classList.toggle('wide', wide);
    return () => document.body.classList.remove('wide');
  }, [wide]);

  // El panel del cliente se viste con SU logo en cuanto lo sube; sin logo, marca de
  // Velai. Velai sigue firmando en el pie.
  const [logoOk, setLogoOk] = useState(false);
  const haslogo = Boolean(isCliente && me?.tenantLogo && logoOk);

  return (
    <>
      <SessionExpired />
      {MOBILE_PREVIEW ? <header className="mobile-preview-header">
        <div><strong>Velai</strong><span>Admin · prueba móvil</span></div>
        <span className="mobile-preview-badge">Solo lectura</span>
        <button type="button" onClick={() => toast('iPhone: Compartir → Añadir a pantalla de inicio. Android: menú del navegador → Instalar app o Añadir a pantalla de inicio. Necesitas conexión para consultar los datos.')}>Añadir al móvil</button>
      </header> : null}
      <aside className={`side${MOBILE_PREVIEW && mobileMenu ? ' mobile-menu-open' : ''}`} id="panel-navigation" onKeyDown={e => { if (MOBILE_PREVIEW && e.key === 'Escape') closeMobileMenu(); }}>
        {MOBILE_PREVIEW ? <button type="button" className="mobile-menu-close" onClick={closeMobileMenu}>Cerrar menú</button> : null}
        <div className={`brand${haslogo ? ' haslogo' : ''}`}>
          <i />
          <span className="bname">Velai</span> <small>{isCliente && me?.tenantName ? me.tenantName : 'Panel'}</small>
          {isCliente && me?.tenantLogo ? (
            <span className="blogo">
              <img src={me.tenantLogo} alt="" onLoad={() => setLogoOk(true)} onError={() => setLogoOk(false)} />
              <b>{me.tenantName ?? ''}</b>
            </span>
          ) : null}
        </div>
        <div className="sep" />
        {isVelai ? <div className="navlabel">Gestión</div> : null}
        <nav className="tabs" role="tablist">
          <Tab to="/" label="Dashboard" icon={<IcoDashboard />} />
          <Tab to="/leads" label="Leads" icon={<IcoLeads />} />
          <Tab to="/conversaciones" label="Conversaciones" icon={<IcoChat />} />
          {isVelai || me?.modulos?.includes('calendario') ? <Tab to="/calendario" label="Calendario" icon={<IcoCalendar />} /> : null}
          {isVelai || (isCliente && me?.modulos?.includes('eventos')) ? <Tab to="/eventos" label="Eventos" icon={<IcoCalendar />} /> : null}
          <Tab to="/conexiones" label="Conexiones" icon={<IcoLink />} />
          {/* El cliente ve SUS plantillas (solo lectura) aquí, tras Conexiones — no
              tiene sección Sistema. Velai la sigue teniendo en Sistema, abajo. */}
          {isCliente ? <Tab to="/plantillas" label="Plantillas" icon={<IcoTemplate />} /> : null}
          {isVelai ? <Tab to="/clientes" label="Clientes" icon={<IcoBriefcase />} /> : null}
        </nav>
        {isVelai && me.socio === true ? (
          <>
            <div className="navlabel">Administración</div>
            <nav className="tabs" aria-label="Administración">
              <Tab to="/finanzas" label="Finanzas" icon={<IcoBriefcase />} />
              <Tab to="/credito" label="Crédito y fondos" icon={<IcoDashboard />} />
              <Tab to="/compras" label="Compras" icon={<IcoBriefcase />} />
              <Tab to="/facturacion" label="Facturación" icon={<IcoTemplate />} />
              <Tab to="/impuestos" label="Impuestos y asesoría" icon={<IcoSliders />} />
            </nav>
          </>
        ) : null}
        {isVelai ? (
          <>
            <div className="navlabel">Sistema</div>
            <nav className="tabs" aria-label="Sistema">
              <Tab to="/canales" label="Diagnóstico de canales" icon={<IcoChannels />} />
              <Tab to="/plantillas" label="Plantillas" icon={<IcoTemplate />} />
              <Tab to="/configuracion" label="Configuración" icon={<IcoSliders />} />
            </nav>
          </>
        ) : null}
        <span className="spacer" />
        <div className="sidefoot">
          <button
            className="tab"
            type="button"
            onClick={avisos.toggle}
            data-tip={
              'Suena un aviso y sale una notificación cuando llega un mensaje, aunque estés en otra pestaña.\nEl navegador exige un clic antes de poder sonar: si acabas de activarlo, el primer aviso puede llegar mudo.'
            }
          >
            <IcoBell />
            <span>{avisos.on ? 'Avisos activados' : 'Activar avisos'}</span>
            {avisos.on ? <i className="alertdot" /> : null}
          </button>
          <button
            className="tab"
            type="button"
            onClick={() => setDark((d) => !d)}
            data-tip="Cambia el tema de las vistas. La barra lateral siempre es oscura."
          >
            {dark ? <IcoSun /> : <IcoMoon />}
            <span>{dark ? 'Tema claro' : 'Tema oscuro'}</span>
          </button>
          <button
            className="tab"
            type="button"
            onClick={() => {
              // Logout = Cloudflare Access (borra la cookie y redirige al login). La ruta
              // la atiende Access, nunca llega al worker.
              storeWorkspace('velai');
              window.location.href = '/cdn-cgi/access/logout';
            }}
            data-tip={'Cierra tu sesión de Cloudflare Access.\nPara volver a entrar te pedirá otro código por correo.'}
          >
            <IcoLogout />
            <span>Salir</span>
          </button>
        </div>
      </aside>
      <main>
        {workspaceUnavailable ? <div className="workspace-switch" role="alert"><div><strong>No se pudo abrir {workspaceLabel()}</strong><p>Vuelve a Velai para comprobar el acceso con tu sesión actual.</p></div><button className="btn alt" type="button" disabled={Boolean(mutations) || switching} onClick={() => void switchWorkspace('velai', true)}>Volver a Velai</button></div> : null}
        {!MOBILE_PREVIEW && me?.workspace?.canSwitch ? <div className="workspace-switch">
          <label>Espacio<select aria-label="Espacio de trabajo" value={me.workspace.current} disabled={Boolean(mutations) || switching} onChange={e => void switchWorkspace(e.target.value)}>{workspaceOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
          <span>La misma sesión · cambia el espacio de trabajo</span>
        </div> : null}
        {MOBILE_PREVIEW ? <p className="mobile-preview-notice">Datos reales. Esta prueba no envía mensajes ni guarda cambios.</p> : null}
        <Outlet />
      </main>
      {MOBILE_PREVIEW ? <nav className="mobile-preview-nav" aria-label="Navegación móvil">
        <NavLink to="/" end><IcoDashboard /><span>Inicio</span></NavLink>
        <NavLink to="/conversaciones"><IcoChat /><span>Conversaciones</span></NavLink>
        <NavLink to="/clientes"><IcoBriefcase /><span>Clientes</span></NavLink>
        <button type="button" ref={moreButton} aria-expanded={mobileMenu} aria-controls="panel-navigation" onClick={() => setMobileMenu(v => !v)}><IcoSliders /><span>Más</span></button>
      </nav> : null}
      <div className="foot">
        Panel de <b>Velai</b> · {new Date().getFullYear()} · Todos los derechos reservados
        {/* La versión resuelve el «¿estoy viendo el panel nuevo o el viejo?» de un vistazo:
            el v1 no firma el pie, y entre deploys del v2 cambia el commit aunque nadie
            haya subido la semántica. */}
        <span className="foot-ver" data-tip={'Compilado el ' + __PANEL_FECHA__ + ' · commit ' + __PANEL_COMMIT__}>
          v{__PANEL_VERSION__} · {__PANEL_COMMIT__}
        </span>
      </div>
    </>
  );
}

// Cloudflare Access caducó: un aviso para todo el panel, porque cuando la sesión cae,
// cae para todas las vistas. Se entra en OTRA pestaña a propósito: recargar esta
// perdería el formulario a medio escribir, que es justo lo que se estaba guardando
// cuando saltó el aviso.
function SessionExpired() {
  const expired = useSyncExternalStore(subscribeSession, isSessionExpired);
  if (!expired) return null;
  return (
    <div className="sessionbar" role="alert">
      <b>Tu sesión caducó.</b>
      <span>Entra de nuevo en otra pestaña y vuelve aquí para reintentar: así no pierdes lo que tengas escrito.</span>
      <button type="button" className="btn btnsm" onClick={() => window.open(window.location.origin, '_blank', 'noopener')}>
        Entrar en otra pestaña
      </button>
    </div>
  );
}
