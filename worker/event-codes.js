import { tieneModulo } from './tenant-planes.js';

// NAYA's campaign vocabulary is intentionally tenant-specific. Other assistants do
// not interpret these names as invitation codes or inherit this booking protocol.
export const NAYA_TENANT_ID = '653aaff5-8b17-4d71-a181-aa4b3c9f688d';
const known = new Set(['CAVERNICOLA', 'DIDIER', 'JAMES', 'SIN CÓDIGO']);
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[*_`]/g, '').trim();
const text = (m) => String(m?.content ?? m?.text ?? '');

export function normalizeEventCode(value) {
  const key = plain(value).toUpperCase().replace(/\s+/g, ' ').trim();
  const compact = key.replace(/ /g, '');
  if (compact === 'CAVERNA' || compact === 'CAVERNICOLA') return 'CAVERNICOLA';
  if (compact === 'DIDIER' || compact === 'JAMES') return compact;
  if (key === 'SIN CODIGO') return 'SIN CÓDIGO';
  return key;
}

function answerCode(value, previous) {
  const raw = String(value || '').trim();
  const simple = plain(raw);
  const explicit = simple.match(/\b(?:mi\s+)?codigo(?:\s+de\s+invitacion)?\s*(?:es\s+|:\s*|=\s*)([^\n.!?]{1,80})/i);
  if (explicit && !/^(?:no|ninguno|no tengo)\b/i.test(simple)) return explicit[1].trim();
  if (/^(?:caverna|cavernicola|didier|james)$/i.test(simple.replace(/\s/g, ''))) return raw;
  const asked = /(?:tienes|tienen|tengas|algun|cual|indica)[\s\S]{0,90}codigo|codigo\s+(?:de\s+invitacion\s*)?:/i.test(plain(previous));
  if (!asked || /[?¿]/.test(simple)) return null;
  if (/^(?:no|ninguno|ningun codigo|sin codigo|no tengo(?: codigo)?)(?:[,.!\s]|$)/i.test(simple)) return 'SIN CÓDIGO';
  if (/^(?:si|claro|confirmo|confirmar|correcto|todo correcto|vale|ok|okay|perfecto|gracias|hola|baja|somos|quiero|estoy|ya|pero|mi nombre)\b/i.test(simple)) return null;
  // A free-form explanation is not a code. Preserve it in the conversation; ask
  // for the actual code rather than attributing a whole sentence to a promoter.
  return /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,59}$/u.test(raw) && raw.split(/\s+/).length <= 3 ? raw : null;
}

export function nayaConversationFacts(messages) {
  let previous = '', attribution = null;
  for (const m of messages) {
    if (m.role === 'assistant' || m.role === 'agent') previous = text(m);
    if (m.role !== 'user') continue;
    const code = answerCode(text(m), previous);
    if (code) attribution = { original: code, code: normalizeEventCode(code) };
  }
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  let beforeIndex = messages.slice(0, lastUser).findLastIndex((m) => m.role === 'assistant');
  // A reminder to type the exact phrase is not a new summary. Recover the
  // immediately preceding summary only across generic confirmations, never across
  // a changed name, party size or other new customer instruction.
  if (/responde\s+(?:exactamente\s+)?confirmo reserva/i.test(plain(text(messages[beforeIndex])))
      && !/(?:^|\n)\s*[-•]?\s*Nombre\s*:/i.test(plain(text(messages[beforeIndex])))) {
    for (let i = beforeIndex - 1; i >= Math.max(0, beforeIndex - 6); i--) {
      if (messages[i].role === 'user' && !/^(?:confirmo|si|vale|ok)[.!\s]*$/i.test(plain(text(messages[i])))) break;
      if (messages[i].role === 'assistant' && /(?:^|\n)\s*[-•]?\s*Nombre(?:\s+completo)?\s*:/i.test(plain(text(messages[i])))) { beforeIndex = i; break; }
    }
  }
  const summary = text(messages[beforeIndex]);
  const flat = plain(summary);
  const answer = plain(text(messages[lastUser])).replace(/[.!¡¿?]/g, '').replace(/\s+/g, ' ').toLowerCase();
  // NAYA asks for this exact phrase; a generic «sí» may be consent or a question.
  const confirmed = answer === 'confirmo reserva'
    && /(?:esta todo correcto|responde\s+confirmo reserva|confirmas?\s+(?:la\s+)?reserva)/i.test(flat);
  const name = flat.match(/(?:^|\n)\s*[-•]?\s*Nombre(?:\s+completo)?\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const attendees = Number(flat.match(/(?:asistentes|personas)\s*:\s*(\d{1,3})\b/i)?.[1]);
  const totalText = flat.match(/(?:total(?:\s+anunciado)?\s*:?\s*)(\d+(?:[.,]\d{1,2})?)\s*€/i)?.[1]
    || flat.match(/(\d+(?:[.,]\d{1,2})?)\s*€\s*(?:en\s+)?total/i)?.[1];
  const totalCents = totalText ? Math.round(Number(totalText.replace(',', '.')) * 100) : null;
  const booking = confirmed && name?.split(/\s+/).length >= 2 && attendees >= 1 && attendees <= 999
    ? { name: name.slice(0, 100), attendees, totalCents, summary: summary.slice(0, 1600) } : null;
  return { attribution, booking };
}

// Statements join the SAME D1 batch as the incoming message and reply. A booking
// is durable before the assistant says it is recorded, independently of lead/KV
// capture having already finished. No notification, payment or benefit is issued.
export async function nayaEventStatements(env, conv, turns) {
  if (!env.DB || conv.tenant !== NAYA_TENANT_ID || conv.demo || !turns.some((t) => t.role === 'user')) return [];
  if (!await tieneModulo(env, conv.tenant, 'eventos')) return [];
  const event = await env.DB.prepare("SELECT id FROM tenant_events WHERE tenant_id=? AND status='active' ORDER BY starts_at ASC LIMIT 1").bind(conv.tenant).first();
  if (!event) return [];
  const rows = conv.isNew ? [] : (await env.DB.prepare(`SELECT role,text FROM
    (SELECT id,role,text FROM conv_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 200) ORDER BY id ASC`).bind(conv.id).all()).results || [];
  const facts = nayaConversationFacts([...rows, ...turns]);
  if (!facts.attribution && !facts.booking) return [];
  const now = new Date().toISOString();
  const statements = [];
  const contact = String(conv.externalId || '').replace(/^whatsapp:/i, '').slice(0, 100);
  const contactKey = conv.channel === 'whatsapp' ? `phone:${contact.replace(/[^0-9]/g, '')}` : `${conv.channel}:${contact}`;
  if (facts.booking) {
    const b = facts.booking;
    statements.push(env.DB.prepare(`INSERT INTO event_reservations
      (id,tenant_id,event_id,conversation_id,lead_id,kind,name,contact,details,status,created_at,updated_at,
       individual_tickets,couple_tickets,quoted_total_cents,currency,promotion_applied,payment_status)
      VALUES (?,?,?,?,(SELECT lead_id FROM conversations WHERE id=? AND tenant_id=?),'event_reservation',?,?,?,'pending',?,?,?,0,?,'EUR',0,'pending')
      ON CONFLICT(tenant_id,conversation_id,kind) WHERE conversation_id IS NOT NULL DO UPDATE SET
        name=excluded.name,details=excluded.details,updated_at=excluded.updated_at,
        individual_tickets=excluded.individual_tickets,couple_tickets=0,quoted_total_cents=excluded.quoted_total_cents`)
      .bind(crypto.randomUUID(), conv.tenant, event.id, conv.id, conv.id, conv.tenant,
        b.name, contact, b.summary, now, now, b.attendees, b.totalCents));
  }
  if (facts.attribution) {
    const a = facts.attribution;
    statements.push(env.DB.prepare(`INSERT INTO event_code_attributions
      (id,tenant_id,event_id,contact_key,conversation_id,original_code,code,validation_status,attendees,reservation_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,(SELECT id FROM event_reservations WHERE tenant_id=? AND conversation_id=? AND kind='event_reservation'),?,?)
      ON CONFLICT(tenant_id,event_id,contact_key) DO UPDATE SET
        conversation_id=excluded.conversation_id,original_code=excluded.original_code,code=excluded.code,
        validation_status=CASE WHEN event_code_attributions.code=excluded.code THEN event_code_attributions.validation_status ELSE excluded.validation_status END,
        reviewed_by=CASE WHEN event_code_attributions.code=excluded.code THEN event_code_attributions.reviewed_by ELSE NULL END,
        reviewed_at=CASE WHEN event_code_attributions.code=excluded.code THEN event_code_attributions.reviewed_at ELSE NULL END,
        attendees=COALESCE(excluded.attendees,event_code_attributions.attendees),
        reservation_id=COALESCE(excluded.reservation_id,event_code_attributions.reservation_id),updated_at=excluded.updated_at`)
      .bind(crypto.randomUUID(), conv.tenant, event.id, contactKey, conv.id, a.original, a.code,
        known.has(a.code) ? 'recognized' : 'pending', facts.booking?.attendees ?? null,
        conv.tenant, conv.id, now, now));
  }
  return statements;
}
