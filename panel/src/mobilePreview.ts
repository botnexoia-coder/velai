export const MOBILE_PREVIEW = import.meta.env.MODE === 'mobile-preview';
export function adminReadHref(path: string): string {
  return MOBILE_PREVIEW && path.startsWith('/api/admin/') ? path.replace('/api/admin/', '/api/admin/mobile-preview/') : path;
}
