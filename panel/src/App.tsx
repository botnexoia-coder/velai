// Rutas planas del panel (la app v1 era single-page con vistas conmutadas; aquí cada
// vista es una ruta). El shell envuelve todas.
import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './shell/Shell';
import { Dashboard } from './views/Dashboard';
import { Leads } from './views/Leads';
import { Conversaciones } from './views/Conversaciones';
import { Pendiente } from './views/Pendiente';
import { Configuracion } from './views/Configuracion';
import { Canales } from './views/Canales';
import { TipHost } from './components/Tip';

export function App() {
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/conversaciones" element={<Conversaciones />} />
          <Route path="/calendario" element={<Pendiente titulo="Calendario" />} />
          <Route path="/conexiones" element={<Pendiente titulo="Conexiones" />} />
          <Route path="/clientes" element={<Pendiente titulo="Clientes" />} />
          <Route path="/canales" element={<Canales />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <TipHost />
    </>
  );
}
