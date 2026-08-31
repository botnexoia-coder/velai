// Gráficas del panel: barras verticales por día (con desglose en el globo) y barra
// horizontal etiquetada. Un solo lenguaje visual para todo el dashboard, como en el v1.
// Los valores dinámicos van por el prop style de React (CSSOM, no atributo style=""):
// compatible con una CSP de style-src con nonce.
import { diaLargo, tipRows } from '../lib/format';

export interface DayBar {
  /** Fecha ISO (yyyy-mm-dd): el globo la dice «como se dice». */
  d: string;
  /** Valor que dimensiona la barra. */
  value: number;
  /** Filas clave/valor del globo (Leads: 7, WhatsApp: 4…). */
  rows: [string, string | number][];
}

/** Barras por día. tabIndex para que el desglose exista también con teclado. */
export function DayChart({ bars, small = false, minPct = 12 }: { bars: DayBar[]; small?: boolean; minPct?: number }) {
  const max = Math.max(1e-9, ...bars.map((b) => b.value));
  return (
    <div className={`chart${small ? ' chart-sm' : ''}`}>
      {bars.map((b) => (
        <div
          key={b.d}
          className="bar"
          tabIndex={0}
          style={{ height: `${b.value === 0 ? (small ? 4 : 6) : Math.max(minPct, Math.round((b.value / max) * 100))}%` }}
          data-tip={diaLargo(b.d)}
          data-tip-rows={tipRows(b.rows)}
        />
      ))}
    </div>
  );
}

/** Barra horizontal etiquetada (leads por canal, tasa de captura). */
export function Brow({ label, pct, right, cls }: { label: string; pct: number; right: string; cls?: '' | 'warn' | 'bad' }) {
  return (
    <div className={`brow${cls ? ` ${cls}` : ''}`}>
      <span>{label}</span>
      <span className="bt">
        <i style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} />
      </span>
      <span className="bv">{right}</span>
    </div>
  );
}
