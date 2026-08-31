// Guardián de la separación producción ↔ staging, en cada `npm run check`.
//
// Wrangler tiene una asimetría que muerde: un [env.X] HEREDA `routes` y `triggers` del
// bloque raíz, pero NO hereda `vars`, `kv_namespaces` ni `d1_databases`. Traducido: lo
// peligroso se propaga solo y lo inofensivo hay que repetirlo a mano. Este script vigila
// las dos mitades de ese problema.
//
//  1. Nada de staging apunta a un recurso de producción (la KV, la D1 o los dominios).
//     Si alguien borra el `routes` de [env.staging], un deploy de staging reclamaría
//     admin.hirevai.com y api.hirevai.com y serviría a los clientes desde staging.
//  2. Las variables no se desincronizan: misma lista de claves en los dos entornos.
//     La duplicación no se puede evitar; que se pudra en silencio, sí.
//  3. Los ids de los grupos de Access siguen vacíos en staging — con ellos puestos, el
//     panel de staging reescribiría quién entra en el panel de los clientes reales.
import { readFile } from 'node:fs/promises';

const texto = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

// Lector mínimo de TOML: solo lo que este fichero usa (secciones, tablas repetidas,
// pares clave/valor y arrays multilínea). Se hace a mano porque el repo no tiene
// dependencias a propósito y meter uno por esto sería un mal negocio.
function leerToml(src) {
  const secciones = { '': {} };
  let actual = '';
  const lineas = src.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    let l = lineas[i].replace(/(^|\s)#.*$/, '').trim();
    if (!l) continue;
    let m = l.match(/^\[\[(.+?)\]\]$/);
    if (m) { actual = m[1] + '[]'; (secciones[actual] ||= []).push({}); continue; }
    m = l.match(/^\[(.+?)\]$/);
    if (m) { actual = m[1]; secciones[actual] ||= {}; continue; }
    m = l.match(/^([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let [, clave, valor] = m;
    // array multilínea: acumular hasta cerrar corchetes
    if (valor.startsWith('[') && (valor.match(/\[/g) || []).length > (valor.match(/\]/g) || []).length) {
      while (i + 1 < lineas.length && (valor.match(/\[/g) || []).length > (valor.match(/\]/g) || []).length) {
        valor += ' ' + lineas[++i].replace(/(^|\s)#.*$/, '').trim();
      }
    }
    const destino = actual.endsWith('[]') ? secciones[actual].at(-1) : secciones[actual];
    destino[clave] = valor.replace(/^["']|["']$/g, '');
  }
  return secciones;
}

const t = leerToml(texto);
const fallos = [];
const prodVars = t['vars'] || {};
const stgVars = t['env.staging.vars'] || {};

if (!Object.keys(stgVars).length) fallos.push('no hay bloque [env.staging.vars]: ¿se ha borrado el entorno de staging?');

// 1. Recursos: staging no puede compartir NADA con producción.
const kvProd = (t['kv_namespaces[]'] || []).map((x) => x.id);
const kvStg = (t['env.staging.kv_namespaces[]'] || []).map((x) => x.id);
const dbProd = (t['d1_databases[]'] || []).map((x) => x.database_id);
const dbStg = (t['env.staging.d1_databases[]'] || []).map((x) => x.database_id);
if (!kvStg.length) fallos.push('[env.staging] sin kv_namespaces propio: heredaría… nada, y el worker fallaría sin KV');
if (!dbStg.length) fallos.push('[env.staging] sin d1_databases propio');
for (const id of kvStg) if (kvProd.includes(id)) fallos.push(`staging usa la KV de PRODUCCIÓN (${id})`);
for (const id of dbStg) if (dbProd.includes(id)) fallos.push(`staging usa la D1 de PRODUCCIÓN (${id})`);

// 2. Dominios: el fallo caro. `routes` SE HEREDA, así que su ausencia no es neutra.
const rutasProd = t['']?.routes || '';
const rutasStg = t['env.staging']?.routes;
const dominiosProd = [...rutasProd.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((x) => x[1]);
if (rutasStg === undefined) {
  fallos.push('[env.staging] no declara `routes`: wrangler HEREDA las de producción y un '
    + `deploy --env staging reclamaría ${dominiosProd.join(' y ')}`);
} else {
  for (const d of dominiosProd) {
    if (rutasStg.includes(`"${d}"`)) fallos.push(`staging reclama el dominio de producción ${d}`);
  }
}

// 3. Access: los grupos de producción no se tocan desde staging.
for (const clave of ['CF_ACCESS_GROUP_ID', 'CF_ADMIN_GROUP_ID']) {
  if (stgVars[clave]) {
    fallos.push(`${clave} tiene valor en staging: el panel de staging podría reescribir `
      + 'quién entra en el panel de los clientes reales. Debe quedar vacío.');
  }
}

// 4. Paridad de variables — el precio de que wrangler no herede vars.
const soloProd = Object.keys(prodVars).filter((k) => !(k in stgVars));
const soloStg = Object.keys(stgVars).filter((k) => !(k in prodVars));
for (const k of soloProd) fallos.push(`la var ${k} existe en producción y falta en staging (staging probaría otra cosa)`);
for (const k of soloStg) fallos.push(`la var ${k} existe en staging y falta en producción (se desplegaría sin ella)`);

// 5. Aviso, no fallo: valores idénticos que casi nunca deberían serlo.
const sospechosas = ['ADMIN_ORIGIN', 'AI_DAILY_LIMIT', 'AI_TENANT_DAILY_LIMIT', 'ALLOWED_WEB_ORIGINS'];
const iguales = sospechosas.filter((k) => prodVars[k] && prodVars[k] === stgVars[k]);

console.log(`check-entornos: ${Object.keys(prodVars).length} vars en producción · ${Object.keys(stgVars).length} en staging`);
console.log(`  KV ${kvProd[0]?.slice(0, 8)}… vs ${kvStg[0]?.slice(0, 8)}… · D1 ${dbProd[0]?.slice(0, 8)}… vs ${dbStg[0]?.slice(0, 8)}…`);
if (iguales.length) console.log(`  aviso: mismo valor en los dos entornos → ${iguales.join(', ')}`);
if (fallos.length) {
  console.error(`\n✖ ${fallos.length} problemas en la separación de entornos:\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log('✔ staging y producción no comparten recursos, dominios ni grupos de Access');
