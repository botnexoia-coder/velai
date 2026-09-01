// Rutas planas del panel (la app v1 era single-page con vistas conmutadas; aquí cada
// vista es una ruta). El shell envuelve todas.
import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './shell/Shell';
import { Dashboard } from './views/Dashboard';
import { Leads } from './views/Leads';
import { Conversaciones } from './views/Conversaciones';
import { Configuracion } from './views/Configuracion';
import { Canales } from './views/Canales';
import { Plantillas } from './views/Plantillas';
import { Calendario } from './views/Calendario';
import { Conexiones } from './views/Conexiones';
import { Clientes } from './views/Clientes';
import { TipHost } from './components/Tip';
import { ConfirmarHost } from './components/Confirmar';

export function App() {
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/conversaciones" element={<Conversaciones />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/conexiones" element={<Conexiones />} />
          <Route path="/clientes" element={<Clientes />} />
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
