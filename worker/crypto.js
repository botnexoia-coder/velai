// Cifrado de secretos de cliente en D1 (auth tokens de subcuentas de Twilio).
// AES-256-GCM con la KEK en un secret del Worker. Formato: v1:<iv_b64>:<ciphertext_b64>.
// AAD = tenant_id, para que un ciphertext copiado de otra fila no descifre.
// Protege ante una fuga del CONTENIDO de D1, no ante quien ya ejecuta código aquí.
const KEYS = new Map();

function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(text) {
  try { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); }
  catch (_) { throw new Error('cipher_format'); }
}

async function kek(env, name) {
  const raw = env[name];
  if (!raw) return null;
  if (!KEYS.has(raw)) {
    const bytes = unb64(raw);
    if (bytes.length !== 32) throw new Error('kek_bad_length');
    KEYS.set(raw, await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  }
  return KEYS.get(raw);
}

export async function encryptSecret(env, tenantId, plaintext) {
  const key = await kek(env, 'SECRETS_KEK');
  if (!key) throw new Error('kek_not_configured');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(tenantId) },
    key, encoder.encode(plaintext));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

// Rotación perezosa: si no descifra con la KEK actual, se intenta con SECRETS_KEK_OLD y
// el llamante puede reescribir la fila con la nueva.
export async function decryptSecret(env, tenantId, stored) {
  if (!stored) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('cipher_format');
  const iv = unb64(parts[1]); const ct = unb64(parts[2]);
  const aad = new TextEncoder().encode(tenantId);
  for (const name of ['SECRETS_KEK', 'SECRETS_KEK_OLD']) {
    const key = await kek(env, name);
    if (!key) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
      return { value: new TextDecoder().decode(plain), stale: name === 'SECRETS_KEK_OLD' };
    } catch (_) { /* siguiente clave */ }
  }
  throw new Error('cipher_undecryptable');
}
