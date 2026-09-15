// ── Sesión de Cloudflare Access caducada ─────────────────────────────────────
// Access NO responde 401 a las peticiones del panel: responde 302 hacia su pantalla de
// login, que vive en otro origen. Con el redirect por defecto ('follow') el navegador
// intenta seguirla, la CSP del panel (connect-src 'self') la bloquea y fetch cae con un
// TypeError genérico. El usuario ve «la petición falló» y parece que el botón está roto:
// pasó el 2026-09-14 subiendo el retrato de un asistente, con la consola llena de avisos
// de CSP que no señalaban la causa real.
//
// Por eso api() pide redirect:'manual' —la respuesta opaca es la señal limpia— y avisa
// aquí. Un solo aviso para todo el panel: cuando la sesión cae, cae para TODAS las
// vistas, así que el marco enseña una barra una vez en lugar de que cada botón invente
// su propio mensaje.

let expired = false;
const subs = new Set<() => void>();

export function markSessionExpired(): void {
  if (expired) return; // una petición más tarde no vuelve a notificar: ya está avisado
  expired = true;
  for (const fn of subs) fn();
}

export function isSessionExpired(): boolean {
  return expired;
}

/** Suscripción al estilo useSyncExternalStore; devuelve la baja. */
export function subscribeSession(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Solo para tests: deja el módulo como recién cargado. */
export function resetSession(): void {
  expired = false;
  subs.clear();
}
