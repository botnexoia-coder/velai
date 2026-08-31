// Guardián del aislamiento multi-tenant, en CI y sin coste en producción.
//
// El problema que resuelve: el panel construye ~100 consultas a mano y en la mitad la única
// defensa entre el cliente A y los datos del cliente B es que quien escribió el handler se
// acordara de la puerta. Con 4 clientes cabe en la cabeza; con 30, no. Esto lo convierte en
// una condición de CI: toda consulta del panel ALCANZABLE POR UN CLIENTE tiene que estar
// filtrada por tenant o justificada por una puerta explícita.
//
// Se eligió chequeo ESTÁTICO y no un proxy en runtime a propósito: un guardián que lanza en
// producción puede tumbar el panel de un cliente por un falso positivo. Este, como mucho,
// pone el build en rojo.
//
// Alcance: solo adminRouter — es el único sitio donde la identidad de quien pregunta decide
// qué filas se leen. El cron y los webhooks no tienen usuario delante.
//
// Cómo se justifica una consulta sin filtro (por orden de preferencia):
//   1. assertOwnTenant(scope, id)  — el recurso va por id en la ruta y se comprueba antes.
//   2. canAttend(env, scope, ...)  — puerta de la bandeja/handoff.
//   3. una consulta ANTERIOR del mismo handler ya filtrada por tenant (patrón padre→hijas:
//      se comprueba el padre con filtro y las hijas van por su FK).
//   4. el id sale del scope       — .bind(scope.tenantId ...) o un ?tenant= validado
//                                    contra el scope: el cliente no puede nombrar otro.
//   5. // scope-ok: <motivo>       — escape explícito, para lo que no encaje arriba.
import { readFile } from 'node:fs/promises';
import { testing } from '../worker/app.js';

const { clienteAllowed } = testing;

const DIRECTAS = ['leads', 'conversations', 'conv_daily', 'appointments', 'agent_presence',
  'ai_usage', 'tenant_channels', 'tenant_calendars', 'tenant_reports', 'tenant_versions',
  'tenant_users', 'tenants', 'settings'];
const HIJAS = ['conv_messages', 'lead_notes', 'lead_events', 'lead_notifications'];
// Interpolaciones que SON el filtro de tenant (scopeClause y sus dos variantes locales).
const CLAUSULAS = ['sc.sql', 'scc.sql', 'leadW', "tenant_id = ?", 'tenant_id=?'];
const PUERTAS = ['assertOwnTenant(', 'canAttend(', 'scope-ok:'];
// Cuarto patrón, y el más fuerte de todos: el id NO viene de la petición, viene del scope.
// O se ata scope.tenantId directamente, o se acepta un ?tenant= solo tras comprobar que
// coincide con el del scope. En ambos casos un cliente no puede nombrar un tenant ajeno,
// así que no hay nada que filtrar. Se detecta en vez de anotarse a mano porque es una
// forma legítima y repetida —/me, /availability, /ai-balance— y taparla con comentarios
// enseñaría a silenciar el guardián.
const DESDE_EL_SCOPE = ['.bind(scope.tenantId', 'asked !== scope.tenantId'];

const src = await readFile(new URL('../worker/app.js', import.meta.url), 'utf8');
const lineas = src.split('\n');

const ini = lineas.findIndex((l) => l.startsWith('async function adminRouter'));
if (ini < 0) { console.error('check-aislamiento: no encuentro adminRouter'); process.exit(2); }
let fin = lineas.length;
for (let i = ini + 1; i < lineas.length; i++) if (/^\}/.test(lineas[i])) { fin = i; break; }

// Rutas abiertas al rol cliente, leídas de clienteAllowed (misma fuente que el router).
const ca = lineas.findIndex((l) => l.startsWith('function clienteAllowed'));
let caFin = ca; for (let i = ca + 1; i < lineas.length; i++) if (lineas[i] === '}') { caFin = i; break; }
const permitidas = lineas.slice(ca, caFin).join('\n');

// Ruta vigente en cada línea del router.
const rutaEn = [];
let actual = '(cabecera del router)';
for (let i = ini; i < fin; i++) {
  const l = lineas[i];
  let m = l.match(/if \(path === '([^']+)'/);
  if (m) actual = m[1];
  else { m = l.match(/path\.match\((\/\^[^;]*?\/i?)\)/); if (m) actual = m[1]; }
  rutaEn[i] = actual;
}
// Reachability EXACTA: en vez de comparar fragmentos (que daba falsos positivos —
// /tenants/:id salía "de cliente" solo porque la palabra tenants aparece en otras rutas),
// se reconstruye una ruta de ejemplo desde el regex del router y se le pregunta a la
// propia clienteAllowed. Una sola fuente de verdad, la misma que usa el worker.
const METODOS = ['GET', 'POST', 'PATCH', 'DELETE'];
// Del regex del router a rutas de ejemplo concretas. Los grupos OPCIONALES se expanden en
// las dos variantes (con y sin): /leads/:id y /leads/:id/notes son rutas distintas y una
// está abierta al cliente aunque la otra no. Antes se generaba una sola variante y los
// grupos anidados salían como basura — que marcaba rutas DE CLIENTE como solo-Velai, que
// es justo el lado por el que un guardián no puede equivocarse.
function rutasDeEjemplo(regexSrc) {
  let base = regexSrc.replace(/^\//, '').replace(/\/i?$/, '').replace(/^\^/, '').replace(/\$$/, '');
  const expandir = (r) => {
    const i = r.search(/\(\?:/);
    if (i < 0) return [r];
    // cerrar el grupo contando paréntesis (pueden venir anidados)
    let prof = 0, j = i;
    for (; j < r.length; j++) {
      if (r[j] === '(' && r[j - 1] !== '\\') prof++;
      else if (r[j] === ')' && r[j - 1] !== '\\') { prof--; if (!prof) break; }
    }
    const opcional = r[j + 1] === '?';
    const dentro = r.slice(i + 3, j);
    const resto = r.slice(j + (opcional ? 2 : 1));
    const con = expandir(r.slice(0, i) + dentro + resto);
    return opcional ? [...expandir(r.slice(0, i) + resto), ...con] : con;
  };
  return [...new Set(expandir(base))].map((r) => r
    .replace(/\(([^()|]*)\|[^()]*\)/g, '$1')       // (a|b) → a
    .replace(/\[0-9a-f-\]\+/gi, '00000000-0000-4000-8000-000000000001')
    .replace(/\\d\+/g, '1')
    .replace(/[()]/g, '')
    .replace(/\\\//g, '/'));
}
const alcanzablePorCliente = (ruta) => {
  if (ruta.startsWith('(')) return true;                       // antes de cualquier if: siempre
  if (ruta.startsWith('/^')) {
    return rutasDeEjemplo(ruta).some((ej) => METODOS.some((m) => clienteAllowed(ej, m)));
  }
  return METODOS.some((m) => clienteAllowed(ruta, m));
};
// Línea donde arranca el bloque de la ruta vigente (para buscar la puerta dentro de ÉL).
const inicioRuta = [];
for (let i = ini; i < fin; i++) inicioRuta[i] = (i > ini && rutaEn[i] === rutaEn[i - 1]) ? inicioRuta[i - 1] : i;

const region = lineas.slice(ini, fin).join('\n');
const re = /prepare\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g;
const fallos = []; let total = 0, filtradas = 0, conPuerta = 0, soloVelai = 0;
let m;
while ((m = re.exec(region))) {
  const sql = m[1].slice(1, -1);
  const linea = ini + region.slice(0, m.index).split('\n').length - 1;
  const plano = sql.replace(/\s+/g, ' ');
  const tocadas = [...DIRECTAS, ...HIJAS].filter((t) =>
    new RegExp(`(?:FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, 'i').test(plano));
  if (!tocadas.length) continue;
  total++;
  if (CLAUSULAS.some((c) => plano.includes(c))) { filtradas++; continue; }
  const ruta = rutaEn[linea] || '';
  if (!alcanzablePorCliente(ruta)) { soloVelai++; continue; }
  // Buscar una puerta en el bloque de la ruta, por encima de la consulta.
  const bloque = lineas.slice(inicioRuta[linea], linea + 1).join('\n');
  const puerta = PUERTAS.some((p) => bloque.includes(p))
    || DESDE_EL_SCOPE.some((p) => bloque.includes(p))
    // patrón padre→hijas: alguna consulta anterior del bloque ya iba filtrada
    || CLAUSULAS.some((c) => bloque.slice(0, bloque.lastIndexOf('prepare(')).includes(c));
  if (puerta) { conPuerta++; continue; }
  fallos.push({ linea: linea + 1, ruta, tablas: tocadas.join(','), sql: plano.slice(0, 90) });
}

console.log(`check-aislamiento: ${total} consultas del panel sobre tablas de tenant`);
console.log(`  ${filtradas} filtradas por tenant · ${conPuerta} con puerta o id del scope · ${soloVelai} en rutas solo-Velai`);
if (fallos.length) {
  console.error(`\n✖ ${fallos.length} consultas alcanzables por un CLIENTE sin filtro ni puerta:\n`);
  for (const f of fallos) {
    console.error(`  worker/app.js:${f.linea}  [${f.tablas}]  ruta ${f.ruta}`);
    console.error(`    ${f.sql}`);
  }
  console.error(`\nAñade el filtro (scopeClause), una puerta (assertOwnTenant / canAttend)`);
  console.error(`o, si de verdad es segura, un comentario "// scope-ok: <motivo>" en el bloque.`);
  process.exit(1);
}
console.log('✔ ninguna consulta del panel queda sin filtro ni puerta');
