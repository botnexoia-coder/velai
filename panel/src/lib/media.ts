const origins = new Set(['https://api.hirevai.com', 'https://vai-worker-staging.botnexo-ia.workers.dev', 'https://vai-worker.botnexo-ia.workers.dev']);
export function mediaHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return origins.has(url.origin) && !url.username && !url.password && !url.hash && !url.search && /^\/media\/lib\/[0-9a-f-]{36}\/[0-9a-f-]+\.(png|jpg|webp|pdf|mp3|ogg|m4a|mp4)$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function messageAttachments(raw?: string | null): { name: string; url: string }[] {
  try {
    const items: unknown = JSON.parse(raw || '[]');
    return Array.isArray(items) ? items.filter((a) => a && typeof a.name === 'string' && mediaHref(a.url)).slice(0, 2) : [];
  } catch { return []; }
}
