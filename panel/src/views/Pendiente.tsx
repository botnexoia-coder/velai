// Vistas aún no migradas del panel v1 (ver panel/TODO.md). Mientras el v2 no las tenga,
// el panel v1 sigue sirviéndolas: esta pantalla lo dice en vez de fingir que no existen.
export function Pendiente({ titulo }: { titulo: string }) {
  return (
    <div>
      <div className="vhead">
        <div>
          <h1>{titulo}</h1>
          <p>Esta vista aún no está migrada al panel nuevo.</p>
        </div>
      </div>
      <div className="chartcard">
        <b>En construcción</b>
        <p className="muted mt6">
          Mientras tanto sigue disponible en el panel clásico. El detalle de lo que falta está en{' '}
          <span className="mono">panel/TODO.md</span>.
        </p>
      </div>
    </div>
  );
}
