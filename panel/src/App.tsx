// Rutas planas del panel (la app v1 era single-page con vistas conmutadas; aquí cada
// vista es una ruta). El shell envuelve todas.
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './hooks/queries';
import type { Modulo } from './api/types';
import { lazy, Suspense, type ReactNode } from 'react';
import { Shell } from './shell/Shell';
import { Dashboard } from './views/Dashboard';
import { Leads } from './views/Leads';
import { Conversaciones } from './views/Conversaciones';
import { Configuracion } from './views/Configuracion';
import { Canales } from './views/Canales';
import { Plantillas } from './views/Plantillas';
import { Calendario } from './views/Calendario';
import { Conexiones } from './views/Conexiones';
import { Eventos } from './views/Eventos';
import { Clientes } from './views/Clientes';
import { TipHost } from './components/Tip';
import { ConfirmarHost } from './components/Confirmar';

const Finanzas = lazy(() => import('./views/Finanzas').then((m) => ({ default: m.Finanzas })));

export function App() {
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/conversaciones" element={<Conversaciones />} />
          <Route path="/calendario" element={<ModuloRoute modulo="calendario"><Calendario /></ModuloRoute>} />
          <Route path="/eventos" element={<ModuloRoute modulo="eventos"><Eventos /></ModuloRoute>} />
          <Route path="/conexiones" element={<Conexiones />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/finanzas" element={<Suspense fallback={<p role="status">Cargando…</p>}><Finanzas /></Suspense>} />
          <Route path="/canales" element={<Canales />} />
          <Route path="/plantillas" element={<Plantillas />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <TipHost />
      <ConfirmarHost />
    </>
  );
}

function ModuloRoute({ modulo, children }: { modulo: Modulo; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return <p role="status">Cargando…</p>;
  return me.role === 'velai' || me.modulos?.includes(modulo) ? children : <Navigate to="/" replace />;
}
