// Piezas pequeñas compartidas: píldora de estado del lead, chip de tenant con su color
// estable, y los chips de estado de avisos con su globo explicativo.
import { NB_TIP, ST_LABEL } from '../api/errors';
import { tenantColor } from '../lib/format';
import type { LeadStatus } from '../api/types';

export function StatusPill({ status }: { status: LeadStatus | string }) {
  return (
    <span className={`pill s-${status}`}>
      <b style={{ width: 6 }} />
      {ST_LABEL[status] ?? status}
    </span>
  );
}

export function TenantChip({ id, name }: { id: string | undefined; name: string | null | undefined }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span className="tenant">
      <i style={{ background: tenantColor(id ?? name) }} />
      {name}
    </span>
  );
}

// Los chips de aviso llevaban el color del estado y NADA que lo explicara: un punto rojo
// no dice si el aviso falló, está en cola o se saltó a propósito — de eso se encarga el globo.
export function NbChips({ summary }: { summary: string | null | undefined }) {
  if (!summary) return <span className="muted">—</span>;
  return (
    <>
      {String(summary)
        .split(',')
        .map((p, idx) => {
          const [ch, st = ''] = p.split(':');
          const cls = st === 'sent' ? 'ok' : st === 'failed' ? 'bad' : 'wait';
          const canal = ch === 'telegram' ? 'Telegram' : 'WhatsApp';
          return (
            <span key={idx} className={`nb ${cls}`} tabIndex={0} data-tip={`${canal}\n${NB_TIP[st] ?? st}`}>
              <i />
              {canal}
            </span>
          );
        })}
    </>
  );
}
