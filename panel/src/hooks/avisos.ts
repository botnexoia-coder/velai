// El botón «Activar avisos» del sidebar: suena un aviso y sale una notificación cuando
// llega un mensaje, aunque la pestaña esté en segundo plano o el panel en otra vista —
// por eso este sondeo NO mira visibilityState, al contrario que el de la bandeja. Es
// una sola consulta agregada cada 30 s.
//
// La preferencia se recuerda POR PESTAÑA (sessionStorage, la invariante del panel). No
// se puede reactivar sola sin un gesto (el navegador no deja crear el AudioContext), así
// que al recargar se deja el sondeo en marcha y el sonido llega al primer clic — el
// tooltip del botón ya lo cuenta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { alertDelta, alertTexto, beep, notify } from '../lib/alertas';
import type { Alerts } from '../api/types';

export const SS_ALERTS = 'velai-panel-alerts';
export const ALERT_POLL_MS = 30_000;

function readPref(): boolean {
  try {
    return sessionStorage.getItem(SS_ALERTS) === '1';
  } catch {
    return false;
  }
}

export interface Avisos {
  on: boolean;
  toggle: () => void;
}

export function useAvisos(onActivated?: (msg: string, ok?: boolean) => void): Avisos {
  const [on, setOn] = useState(readPref);
  const seenRef = useRef<Alerts | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const check = useCallback(async () => {
    try {
      const d = await api<Alerts>('/api/admin/alerts', undefined, { quiet: true });
      // El primer sondeo solo fija la referencia: si no, al activar los avisos sonaría
      // por mensajes que ya estaban ahí desde hace horas.
      if (seenRef.current === null) {
        seenRef.current = d;
        return;
      }
      const delta = alertDelta(seenRef.current, d);
      seenRef.current = d;
      if (!delta.nuevoMensaje && !delta.nuevaEspera) return;
      beep();
      // Con la bandeja delante ya lo está viendo: el sonido basta y una notificación
      // del sistema encima sería ruido.
      const mirando = document.visibilityState === 'visible' && pathRef.current === '/conversaciones';
      if (!mirando) {
        const { titulo, cuerpo } = alertTexto(delta, d.waiting);
        notify(titulo, cuerpo, () => navigate('/conversaciones'));
      }
    } catch {
      /* un sondeo fallido no apaga los avisos: se reintenta al siguiente */
    }
  }, [navigate]);

  // El intervalo vive mientras los avisos estén activados (también tras recargar).
  useEffect(() => {
    if (!on) return;
    void check();
    const t = setInterval(() => void check(), ALERT_POLL_MS);
    return () => clearInterval(t);
  }, [on, check]);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    try {
      sessionStorage.setItem(SS_ALERTS, next ? '1' : '');
    } catch {
      /* sin sessionStorage la preferencia no se recuerda, nada más */
    }
    seenRef.current = null;
    if (!next) return;
    // El permiso y el AudioContext SOLO se pueden pedir dentro de un gesto del usuario:
    // por eso esto vive en el clic del botón y no en el arranque del panel.
    void (async () => {
      try {
        if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      } catch {
        /* sin permiso, solo sonará */
      }
      beep();
      onActivated?.(
        'Notification' in window && Notification.permission === 'granted'
          ? 'Avisos activados ✓ — sonarán aunque estés en otra pestaña'
          : 'Avisos activados ✓ (sin permiso de notificaciones: solo sonará)',
      );
    })();
  }, [on, onActivated]);

  return { on, toggle };
}
