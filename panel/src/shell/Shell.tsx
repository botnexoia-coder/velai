// El marco del panel: barra lateral con navegación por rol, tema de las vistas y pie.
//
// REGLA DE MARCA (decisión del dueño, no negociable): toda superficie de NAVEGACIÓN va
// oscura SIEMPRE — sidebar, topbar móvil — aunque el tema de las vistas sea claro. Lo
// garantiza el CSS: la .side usa los tokens oscuros de :root, que ningún tema toca.
//
// El rol decide la interfaz, pero la DEFENSA es del worker: cada endpoint valida el
// scope por su cuenta.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useMe } from '../hooks/queries';
import { useAvisos } from '../hooks/avisos';
import { useToast } from '../components/Toasts';
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
  const { data: me } = useMe();
  const [dark, setDark] = useState(readDark);
  const location = useLocation();
  const isVelai = me?.role === 'velai';
  const isCliente = me?.role === 'cliente';
  const toast = useToast();
  const avisos = useAvisos(toast);

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
      <aside className="side">
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
          <Tab to="/calendario" label="Calendario" icon={<IcoCalendar />} />
          <Tab to="/conexiones" label="Conexiones" icon={<IcoLink />} />
          {isVelai ? <Tab to="/clientes" label="Clientes" icon={<IcoBriefcase />} /> : null}
          {isVelai ? <Tab to="/canales" label="Canales" icon={<IcoChannels />} /> : null}
        </nav>
        {isVelai ? (
          <>
            <div className="navlabel">Sistema</div>
            <nav className="tabs">
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
        <Outlet />
      </main>
      <div className="foot">
        Panel de <b>Velai</b> · {new Date().getFullYear()} · Todos los derechos reservados
      </div>
    </>
  );
}
