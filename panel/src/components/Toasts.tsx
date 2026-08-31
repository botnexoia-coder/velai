// Aviso de resultado de CADA acción que guarda: éxito verde (2,6 s) o error rojo (6 s).
// El contenedor es un popover manual para quedar en el top layer POR ENCIMA de los
// <dialog> abiertos — un fixed normal quedaría detrás. showPopover va en try/catch: si
// el navegador no lo soporta, el div es visible igual.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  msg: string;
  ok: boolean;
  on: boolean;
}

type ToastFn = (msg: string, ok?: boolean) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const toast = useCallback<ToastFn>((msg, ok = true) => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, msg, ok, on: false }]);
    // La transición necesita un frame con el toast ya en el DOM.
    requestAnimationFrame(() => {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, on: true } : t)));
    });
    setTimeout(() => {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, on: false } : t)));
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 250);
    }, ok ? 2600 : 6000);
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    try {
      if (items.length && !box.matches(':popover-open')) box.showPopover();
      if (!items.length && box.matches(':popover-open')) box.hidePopover();
    } catch {
      /* sin soporte de popover, el div fijo se ve igual */
    }
  }, [items.length]);

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div id="toasts" popover="manual" ref={boxRef}>
        {items.map((t) => (
          <div key={t.id} className={`toast${t.ok ? '' : ' err'}${t.on ? ' on' : ''}`} role="status">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
