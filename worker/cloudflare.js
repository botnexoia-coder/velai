// Llamadas del worker a la API de Cloudflare (Turnstile y Access) con un token de
// cuenta de permisos mínimos (secret CF_API_TOKEN + var CF_ACCOUNT_ID).
//
// Regla de oro de estas dos APIs: son de SUSTITUCIÓN COMPLETA (los `domains` del widget
// y el `include` del grupo reemplazan la lista entera). Por eso toda lista se
// reconstruye SIEMPRE desde D1 antes de escribir — nunca se añade incrementalmente.

export function cloudflareConfigured(env) {
  return Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);
}

async function cfFetch(env, method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const code = data.errors && data.errors[0] ? (data.errors[0].code || data.errors[0].message) : response.status;
    throw new Error(`cf_api_${code}`);
  }
  return data.result;
}

// PUT del widget de Turnstile preservando su tipo: GET primero y copiar mode /
// bot_fight_mode / offlabel / clearance_level. Nuestro widget es 'invisible' —
// enviar el 'managed' de los ejemplos de la doc lo convertiría en interactivo y
// rompería execution:'execute' en funnel.js y en el widget de todas las webs.
export async function syncTurnstileDomains(env, hostnames) {
  if (!env.TURNSTILE_SITEKEY) throw new Error('turnstile_sitekey_missing');
  const widget = await cfFetch(env, 'GET', `/challenges/widgets/${env.TURNSTILE_SITEKEY}`);
  await cfFetch(env, 'PUT', `/challenges/widgets/${env.TURNSTILE_SITEKEY}`, {
    name: widget.name,
    mode: widget.mode,
    domains: hostnames,
    bot_fight_mode: widget.bot_fight_mode,
    offlabel: widget.offlabel,
    clearance_level: widget.clearance_level,
  });
  return hostnames;
}

// La puerta de Access: el grupo «Clientes Velai» se reescribe entero con los correos
// de tenant_users. Un include vacío no es válido para la API, así que sin correos se
// escribe un centinela inalcanzable — la puerta queda cerrada para todos, que es lo
// correcto cuando no hay usuarios de cliente. Los ADMIN_EMAILS NUNCA entran aquí:
// los admins pasan por su propia regla de la política.
export async function syncAccessGroup(env, emails) {
  if (!env.CF_ACCESS_GROUP_ID) throw new Error('access_group_missing');
  const include = emails.length
    ? emails.map((email) => ({ email: { email } }))
    : [{ email: { email: 'nadie@velai.invalid' } }];
  await cfFetch(env, 'PUT', `/access/groups/${env.CF_ACCESS_GROUP_ID}`, { name: 'Clientes Velai', include });
  return emails.length;
}
