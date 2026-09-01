// El semáforo de configuración del listado de Clientes (portado de semaforo() en
// admin-panel.js): un chip por canal REAL (la web entra por slug y está siempre) más
// los avisos de configuración. El estado veraz del canal WhatsApp es el del sender.
import type { TenantRow } from '../api/types';

export interface SemaforoChip {
  cls: '' | 'ok' | 'off' | 'web';
  text: string;
}

export function semaforo(t: TenantRow): SemaforoChip[] {
  if (!t.active && String(t.channel_address).startsWith('pending:')) return [{ cls: 'off', text: 'prospecto' }];
  const kinds = new Set(String(t.channels ?? '').split(',').filter(Boolean));
  const m = /^(whatsapp|messenger):/.exec(String(t.channel_address));
  if (m && m[1]) kinds.add(m[1]);
  const chips: SemaforoChip[] = [{ cls: 'web', text: 'web' }];
  if (kinds.has('whatsapp')) {
    chips.push(
      t.sender_status === 'ONLINE' || (t.has_from && !t.has_subaccount)
        ? { cls: 'ok', text: 'whatsapp' }
        : { cls: '', text: 'whatsapp: verificando' },
    );
  } else if (t.sender_status === 'ONLINE' || t.has_from) {
    // Sender vivo en Twilio y NINGÚN canal que lo enrute: el bot calla en verde
    // (gogestion, 2026-08-24). Antes no se pintaba nada y el cliente pasaba por «solo web».
    chips.push({ cls: 'off', text: 'whatsapp: sin enrutar' });
  }
  if (kinds.has('messenger')) chips.push({ cls: 'ok', text: 'messenger' });
  const f: string[] = [];
  if (t.prompt_len > 8000) f.push('contexto muy largo');
  if (t.prompt_len < 200) f.push('contexto corto');
  if (!t.has_team && !t.has_telegram) f.push('sin canal de aviso');
  if (kinds.has('whatsapp')) {
    if (!t.has_template) f.push('sin plantilla');
    if (t.has_subaccount && !t.has_twilio_token) f.push('sin token');
    if (t.has_subaccount && !t.has_from) f.push('sin From');
  }
  if (f.length) return chips.concat(f.map((text) => ({ cls: '' as const, text })));
  return chips.concat([{ cls: 'ok', text: 'listo' }]);
}
