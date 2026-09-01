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
// QUÉ CAZA desde la migración a Hono — y qué ya no hace falta cazar:
//  · La cadena identidad → scope → clienteAllowed es AHORA middleware sobre todo
//    /api/admin/* (worker/middleware.js): un endpoint no puede registrarse fuera del
//    perímetro, así que «handler sin scope resuelto» dejó de ser un fallo posible.
//    Tampoco hace falta reconstruir rutas desde los regex del router: las rutas son
//    declaraciones de Hono y un ejemplo concreto sale de sustituir sus parámetros.
//  · Lo que SÍ sigue pudiendo fallar — y es lo único que esto vigila — es el SQL de cada
//    handler: una consulta sobre una tabla con dueño que no lleve el filtro del scope ni
//    una puerta. El middleware sabe QUIÉN pregunta; solo el handler sabe qué WHERE escribe.
//
// Alcance: los dominios admin de worker/routes/*.js (el monolito adminRouter ya no
// existe: cada dominio vive en su módulo). publico.js queda fuera igual que quedaban
// fuera el cron y los webhooks: ahí no hay usuario del panel delante — el tenant lo
// resuelve el canal (firma de Twilio, slug del widget), no una identidad con alcance.
// Punto ciego asumido (el MISMO que tenía la versión anterior, que solo leía el cuerpo de
// adminRouter): las funciones auxiliares a nivel de módulo no se escanean — a ellas solo
// se llega a través de un handler, y la puerta debe estar en el handler que las llama.
//
// Cómo se justifica una consulta sin filtro (por orden de preferencia):
//   1. assertOwnTenant(scope, id)  — el recurso va por id en la ruta y se comprueba antes.
//   2. canAttend(env, scope, ...)  — puerta de la bandeja/handoff.
//   3. una consulta ANTERIOR del mismo handler ya filtrada por tenant. Para las tablas
//      HIJAS basta (es su única vía: no tienen tenant_id). Para una tabla con dueño propio
//      hace falta además que esa consulta padre cerrara con un 404 antes de seguir.
//   3b. `if (scope.role !== 'velai') throw` — handler vetado al cliente en el propio código.
//   4. el id sale del scope       — .bind(scope.tenantId ...) o un ?tenant= validado
//                                    contra el scope: el cliente no puede nombrar otro.
//   5. // scope-ok: <motivo>       — escape explícito, para lo que no encaje arriba.
import { readFile, readdir } from 'node:fs/promises';
import { clienteAllowed } from '../worker/middleware.js';

const DIRECTAS = ['leads', 'conversations', 'conv_daily', 'appointments', 'agent_presence',
  'ai_usage', 'tenant_channels', 'tenant_calendars', 'tenant_reports', 'tenant_versions',
  'tenant_users', 'tenants', 'settings', 'tenant_templates'];
const HIJAS = ['conv_messages', 'lead_notes', 'lead_events', 'lead_notifications', 'appointment_reminders'];
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
const METODOS = ['GET', 'POST', 'PATCH', 'DELETE'];

// De una ruta de Hono a rutas de EJEMPLO concretas, para preguntarle a la propia
// clienteAllowed (una sola fuente de verdad, la misma que usa el middleware). Un
// parámetro con regex de alternativas genera UN ejemplo por alternativa: en
// /leads/:id/:accion{notes|retry} el cliente puede notes pero no retry, y con un solo
// ejemplo el veredicto dependería de cuál se eligiera.
function ejemplosDeRuta(ruta) {
  let ejemplos = [ruta];
  const PARAM = /:(\w+)(\{[^}]*\})?/;
  while (ejemplos.some((e) => PARAM.test(e))) {
    ejemplos = ejemplos.flatMap((e) => {
      const m = e.match(PARAM);
      if (!m) return [e];
      const valores = m[2]
        // Un patrón numérico ({\d+} en runtime, {\\d+} tal y como se lee del fuente)
        // se sustituye por '1'; el resto de alternativas se usan literales.
        ? m[2].slice(1, -1).split('|').map((alt) => alt.replace(/\\+d\+/g, '1'))
        : ['00000000-0000-4000-8000-000000000001'];
      return valores.map((v) => e.replace(m[0], v));
    });
  }
  return ejemplos;
}

const alcanzablePorCliente = (rutas) => rutas.some((ruta) =>
  ejemplosDeRuta(ruta).some((ej) => METODOS.some((m) => clienteAllowed(ej, m))));

// ── Escaneo de un dominio (worker/routes/<dominio>.js) ───────────────────────
// Cada handler es o una función inline en el registro (`x.get('/ruta', async (c) => {`)
// o una constante a nivel de módulo (`const grupoX = async (c) => {`) registrada después
// en una o varias rutas (`x.all('/ruta', grupoX);`). El bloque del handler va de su
// primera línea hasta el cierre a columna cero — y toda consulta se busca DENTRO de él.
function escanearDominio(nombre, lineas, registrar) {
  // Pasada 1: rutas de cada handler con nombre.
  const rutasDe = new Map();
  const REG_NOMBRE = /^\w+\.(?:get|post|patch|delete|all|on)\((?:\[[^\]]*\],\s*)?'([^']+)',\s*(\w+)\);/;
  for (const l of lineas) {
    const m = l.match(REG_NOMBRE);
    if (m) (rutasDe.get(m[2]) || rutasDe.set(m[2], []).get(m[2])).push(m[1]);
  }
  // Pasada 2: bloques y sus consultas.
  const REG_INLINE = /^\w+\.(?:get|post|patch|delete|all|on)\((?:\[[^\]]*\],\s*)?'([^']+)',\s*async/;
  const DEF_NOMBRE = /^(?:export )?const (\w+) = async \(c\) => \{/;
  let bloque = null; // { rutas, inicio }
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    let m = l.match(REG_INLINE);
    if (m && !REG_NOMBRE.test(l)) { bloque = { rutas: [m[1]], inicio: i }; continue; }
    m = l.match(DEF_NOMBRE);
    if (m) { bloque = { rutas: rutasDe.get(m[1]) || [], inicio: i }; continue; }
    if (bloque && /^\}\)?;/.test(l)) { registrar(nombre, bloque, lineas, bloque.inicio, i); bloque = null; }
  }
}

// ── El análisis de cada consulta: idéntico criterio que siempre ──────────────
const fallos = []; let total = 0, filtradas = 0, conPuerta = 0, soloVelai = 0;
const RE_PREPARE = /prepare\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g;

function analizar(archivo, rutas, texto, lineaBase) {
  let m;
  while ((m = RE_PREPARE.exec(texto))) {
    const sql = m[1].slice(1, -1);
    const plano = sql.replace(/\s+/g, ' ');
    const tocadas = [...DIRECTAS, ...HIJAS].filter((t) =>
      new RegExp(`(?:FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, 'i').test(plano));
    if (!tocadas.length) continue;
    total++;
    if (CLAUSULAS.some((c) => plano.includes(c))) { filtradas++; continue; }
    if (!alcanzablePorCliente(rutas)) { soloVelai++; continue; }
    // La ventana de búsqueda de puertas: el handler entero hasta esta consulta.
    const antes = texto.slice(0, m.index);
    const yaFiltrado = CLAUSULAS.some((c) => antes.includes(c));
    // Una consulta ANTERIOR filtrada no basta por sí sola: en un handler con varias
    // —/api/admin/stats tiene siete— bastaba con que UNA llevara el filtro para excusar a
    // sus hermanas. Se descubrió el 2026-08-31 quitándole el filtro a la consulta de
    // fuentes: el test de aislamiento la cazó y este chequeo no. Se distingue:
    //  · tablas HIJAS (sin tenant_id): les vale la consulta padre filtrada — es su única vía.
    //  · tablas con dueño propio: hace falta además una PUERTA de verdad, o sea que el padre
    //    filtrado haya cerrado con 404 («no existe para ti») antes de tocar la fila.
    const soloHijas = tocadas.every((t) => HIJAS.includes(t));
    const puertaConCierre = yaFiltrado && /throw new HttpError\(404/.test(antes);
    // Handler vetado al rol cliente EN CÓDIGO (defensa en profundidad): la consulta no es
    // alcanzable aunque la ruta sí lo sea.
    const vetadoACliente = /scope\.role !== 'velai'\) throw/.test(antes);
    // Las puertas se buscan hasta el FINAL de la línea de la consulta (así cuentan los
    // `// scope-ok:` anotados en la misma línea), nunca en lo que viene después: una
    // puerta que llega tarde no protege nada.
    const hastaLinea = texto.indexOf('\n', m.index);
    const conLinea = texto.slice(0, hastaLinea < 0 ? texto.length : hastaLinea);
    const puerta = PUERTAS.some((p) => conLinea.includes(p))
      || DESDE_EL_SCOPE.some((p) => conLinea.includes(p))
      || vetadoACliente
      || (soloHijas ? yaFiltrado : puertaConCierre);
    if (puerta) { conPuerta++; continue; }
    const linea = lineaBase + texto.slice(0, m.index).split('\n').length;
    fallos.push({ donde: `${archivo}:${linea}`, rutas: rutas.join(' '), tablas: tocadas.join(','), sql: plano.slice(0, 90) });
  }
}

// A) Dominios admin en worker/routes/ (publico.js fuera: sin usuario del panel delante).
const dir = new URL('../worker/routes/', import.meta.url);
const dominios = (await readdir(dir)).filter((f) => f.endsWith('.js') && f !== 'publico.js').sort();
for (const archivo of dominios) {
  const lineas = (await readFile(new URL(archivo, dir), 'utf8')).split('\n');
  escanearDominio(`worker/routes/${archivo}`, lineas, (nombre, bloque, todas, desde, hasta) => {
    analizar(nombre, bloque.rutas, todas.slice(desde, hasta + 1).join('\n'), desde);
  });
}

console.log(`check-aislamiento: ${total} consultas del panel sobre tablas de tenant (${dominios.length} dominios)`);
console.log(`  ${filtradas} filtradas por tenant · ${conPuerta} con puerta o id del scope · ${soloVelai} en rutas solo-Velai`);
if (fallos.length) {
  console.error(`\n✖ ${fallos.length} consultas alcanzables por un CLIENTE sin filtro ni puerta:\n`);
  for (const f of fallos) {
    console.error(`  ${f.donde}  [${f.tablas}]  ruta ${f.rutas}`);
    console.error(`    ${f.sql}`);
  }
  console.error(`\nAñade el filtro (scopeClause), una puerta (assertOwnTenant / canAttend)`);
  console.error(`o, si de verdad es segura, un comentario "// scope-ok: <motivo>" en el bloque.`);
  process.exit(1);
}
console.log('✔ ninguna consulta del panel queda sin filtro ni puerta');
