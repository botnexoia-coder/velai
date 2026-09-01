// La rejilla de horario semanal: una fila por día, DOS tramos (la jornada partida es la
// norma aquí). Una sola pieza para los dos horarios del panel — el laboral del
// calendario (variant plain) y el de atención humana de Conexiones (variant toggles,
// con el interruptor por día: apagarlo borra sus horas, encenderlo pone 9:00–19:00).
import { DIAS, DIA_LABEL, dayOn, setDay, type Dia, type DiaGrid, type Grid } from '../lib/horario';

interface Props {
  grid: Grid;
  onChange: (g: Grid) => void;
  variant?: 'plain' | 'toggles';
  /** Prefijo de ids para los inputs (accesibilidad/labels), p. ej. 'sh' o 'cal'. */
  idPrefix: string;
}

export function HoursGrid({ grid, onChange, variant = 'plain', idPrefix }: Props) {
  const toggles = variant === 'toggles';
  const set = (d: Dia, campo: keyof DiaGrid, v: string) => onChange({ ...grid, [d]: { ...grid[d], [campo]: v } });
  return (
    <div className={`shgrid${toggles ? ' cxsh' : ''}`}>
      {DIAS.map((d) => {
        const on = dayOn(grid, d);
        return (
          <div key={d} className={`shrow${toggles && !on ? ' off' : ''}`}>
            <span className="shday">
              {toggles ? (
                <button
                  className={`sw${on ? ' on' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={DIA_LABEL[d]}
                  onClick={() => onChange(setDay(grid, d, !on))}
                >
                  <i />
                </button>
              ) : null}
              {DIA_LABEL[d]}
            </span>
            <Tramo d={d} n={1} grid={grid} set={set} idPrefix={idPrefix} />
            <Tramo d={d} n={2} grid={grid} set={set} idPrefix={idPrefix} />
            {toggles && !on ? <span className="cxclosed">Cerrado — Vai atiende y captura el lead</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function Tramo({
  d,
  n,
  grid,
  set,
  idPrefix,
}: {
  d: Dia;
  n: 1 | 2;
  grid: Grid;
  set: (d: Dia, campo: keyof DiaGrid, v: string) => void;
  idPrefix: string;
}) {
  const a: keyof DiaGrid = n === 1 ? 'a1' : 'a2';
  const b: keyof DiaGrid = n === 1 ? 'b1' : 'b2';
  return (
    <span className="shpair">
      <input
        type="time"
        id={`${idPrefix}_${d}_${n}a`}
        aria-label={`${DIA_LABEL[d]}, tramo ${n}, desde`}
        value={grid[d][a]}
        onChange={(e) => set(d, a, e.target.value)}
      />
      <span className="shsep">a</span>
      <input
        type="time"
        id={`${idPrefix}_${d}_${n}b`}
        aria-label={`${DIA_LABEL[d]}, tramo ${n}, hasta`}
        value={grid[d][b]}
        onChange={(e) => set(d, b, e.target.value)}
      />
    </span>
  );
}
