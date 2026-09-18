// Fixture de navegador: handlers reales y SQLite real; sin red ni credenciales.
import { testing } from '../../worker/app.js';
import { sqliteD1 } from './sqlite-d1.js';
export async function finanzasFixture() {
  const DB = await sqliteD1();
  await DB.exec('PRAGMA foreign_keys=ON;');
  const env = { DB, SOCIOS_EMAILS: 'uno@velai.test,dos@velai.test' };
  await DB.exec("DELETE FROM fin_socios; INSERT INTO fin_socios (email,nombre) VALUES ('uno@velai.test','Ana'),('dos@velai.test','Luis');");
  const scope = { role: 'velai', tenantId: null, email: 'uno@velai.test' };
  const pending = [];
  return {
    DB, scope,
    async request(request) {
      const url = new URL(request.url);
      try { return await testing.adminRouter(request, env, { waitUntil(p) { pending.push(p); } }, url.pathname, url, {}, scope); }
      catch (e) { return Response.json({ error: e.code || e.message }, { status: e.status || 500 }); }
    },
    async close() { await Promise.allSettled(pending); DB.close(); },
  };
}
