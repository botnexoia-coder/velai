import { readFile, readdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// La raíz del sitio es site/ (PLAN-SITE.md): ahí vive todo lo que Pages publica.
// Acepta otra raíz por argumento (p. ej. `node scripts/check-site.mjs .` para validar
// la copia de la raíz del repo durante la convivencia).
const root = path.resolve(process.argv[2] ?? 'site');
// Cinturón por si dentro de la raíz aparecen carpetas que no son el sitio publicado
// (node_modules, artefactos, worktrees de agentes bajo .claude/). Sin esto, el check
// validaría un index.html de Vite como si fuera una landing y fallaría por cosas que no aplican.
const EXCLUIR = new Set(['node_modules', 'panel', '.claude', '.git', '.wrangler', 'dist']);
async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    if (EXCLUIR.has(name)) continue;
    if (['.git', '.wrangler', 'node_modules'].includes(name)) continue;
    const full = path.join(dir, name); const info = await stat(full);
    if (info.isDirectory()) out.push(...await walk(full)); else out.push(full);
  }
  return out;
}
const files = await walk(root);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const failures = [];
// El chequeo de placeholders se salta con CHECK_ALLOW_PLACEHOLDERS=1 (CI de ramas
// donde la site key aún no existe); el deploy real nunca debe llevarlos.
const allowPlaceholders = process.env.CHECK_ALLOW_PLACEHOLDERS === '1';
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8'); const rel = path.relative(root, file);
  if (/velai-assistant-polish|assistant-brand\.js/.test(html)) failures.push(`${rel}: capa de marca externa retirada; usar widget v15`);
  const isDemo = rel === 'demo/index.html' || rel.startsWith(`demo${path.sep}`);
  const required = [['title', /<title>[\s\S]*?<\/title>/i], ['description', /name="description"/i]];
  if (!isDemo) required.push(['funnel', /assets\/funnel\.js/], ['widget', /assets\/vai-widget\.js/]);
  for (const [label, regex] of required) {
    if (!regex.test(html)) failures.push(`${rel}: falta ${label}`);
  }
  if (!allowPlaceholders && /REPLACE_WITH_[A-Z_]+/.test(html)) failures.push(`${rel}: marcador REPLACE_WITH_* sin sustituir`);
  if (/data-velai-leadform/.test(html) && !/assets\/leadform\.js/.test(html)) failures.push(`${rel}: usa data-velai-leadform pero no carga leadform.js`);
  // Los CSS son immutable 1 año en _headers: sin ?v= un cambio no llega a visitantes recurrentes.
  for (const cssMatch of html.matchAll(/href="(\/[^"]+\.css)(\?[^"]*)?"/g)) {
    const hasContentHash = isDemo && /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.css$/.test(cssMatch[1]);
    if (!cssMatch[2] && !hasContentHash) failures.push(`${rel}: CSS sin versión ?v= → ${cssMatch[1]}`);
  }
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]); } catch (error) { failures.push(`${rel}: JSON-LD inválido (${error.message})`); }
  }
  for (const match of html.matchAll(/<script(?![^>]*(?:src=|application\/ld\+json))[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { new vm.Script(match[1], { filename: rel }); }
    catch (error) { failures.push(`${rel}: JavaScript inline inválido (${error.message})`); }
  }
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    const target = match[1].split(/[?#]/)[0];
    if (!target || target === '/') continue;
    const local = path.join(root, target);
    try { await access(local); } catch (_) {
      try { await access(path.join(local, 'index.html')); } catch (_) { failures.push(`${rel}: recurso interno inexistente ${target}`); }
    }
  }
}

// El catálogo mantiene los demos desacoplados del sitio principal y hace explícito
// cuáles están activos, pausados o archivados.
{
  const manifestPath = path.join(root, 'demo', 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.demos)) failures.push('demo/manifest.json: formato de catálogo inválido');
    else {
      const ids = new Set(); const slugs = new Set();
      for (const demo of manifest.demos) {
        if (!demo || typeof demo !== 'object') { failures.push('demo/manifest.json: entrada de demo inválida'); continue; }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(demo.slug ?? '')) failures.push(`demo/manifest.json: slug inválido ${demo.slug ?? '(vacío)'}`);
        if (ids.has(demo.id)) failures.push(`demo/manifest.json: id duplicado ${demo.id}`); else ids.add(demo.id);
        if (slugs.has(demo.slug)) failures.push(`demo/manifest.json: slug duplicado ${demo.slug}`); else slugs.add(demo.slug);
        if (!['active', 'paused', 'archived'].includes(demo.status)) failures.push(`demo/manifest.json: estado inválido en ${demo.slug}`);
        const expectedPath = `/demo/${demo.slug}/`;
        if (demo.path !== expectedPath) failures.push(`demo/manifest.json: ${demo.slug} debe usar la ruta ${expectedPath}`);
        if (demo.image) {
          if (typeof demo.image !== 'string' || !demo.image.startsWith('/demo/')) failures.push(`demo/manifest.json: imagen inválida en ${demo.slug}`);
          else {
            try { await access(path.join(root, demo.image)); }
            catch (_) { failures.push(`demo/manifest.json: falta la imagen de ${demo.slug}`); }
          }
        }
        if (demo.status !== 'archived') {
          try { await access(path.join(root, 'demo', demo.slug, 'index.html')); }
          catch (_) { failures.push(`demo/manifest.json: falta el index de ${demo.slug}`); }
        }
      }
    }
  } catch (error) { failures.push(`demo/manifest.json: no se pudo validar (${error.message})`); }
}
// El widget se sirve con `Cache-Control: immutable` durante un año, así que el `?v=N` de la
// URL ES la clave de caché: cambiar el archivo SIN subir la versión significa que el archivo
// nuevo no llega a nadie — el CDN y los navegadores siguen dando el viejo. Pasó el
// 2026-08-26: se arregló la burbuja del equipo, se desplegó, y producción seguía sirviendo
// la anterior porque el ?v=9 ya estaba cacheado.
// Este check no puede saber si el archivo cambió, pero sí que la versión de su cabecera y la
// que piden los HTML coinciden: obliga a tocar las dos y deja el despiste a la vista.
{
  const widget = await readFile(path.join(root, 'assets/vai-widget.js'), 'utf8');
  const header = widget.match(/· v(\d+)/);
  if (!header) failures.push('assets/vai-widget.js: la cabecera no declara versión (· vN)');
  try {
    const loader = await readFile(path.join(root, 'assets/vai.js'), 'utf8');
    const version = loader.match(/\bV\s*=\s*['"](\d+)['"]/);
    if (!version || !header || version[1] !== header[1]) failures.push('loader y widget: versiones ausentes o distintas');
  } catch (_) { failures.push('falta assets/vai.js (loader sin versión)'); }
  const headers = await readFile(path.join(root, '_headers'), 'utf8');
  if (!/^\/assets\/vai\.js\r?\n[ \t]+! Cache-Control\r?\n[ \t]+Cache-Control: public, max-age=300, must-revalidate\s*$/m.test(headers)) {
    failures.push('_headers: falta la excepción de caché corta del loader /assets/vai.js');
  }
  const usadas = new Set();
  for (const rel of htmlFiles) {
    const html = await readFile(rel, 'utf8');
    for (const m of html.matchAll(/vai-widget\.js\?v=(\d+)/g)) usadas.add(m[1]);
  }
  if (!usadas.size) failures.push('los HTML no declaran ninguna versión del widget');
  if (usadas.size > 1) failures.push(`los HTML piden versiones distintas del widget: ${[...usadas].join(', ')}`);
  if (header && usadas.size === 1 && !usadas.has(header[1])) {
    failures.push(`el widget declara v${header[1]} y los HTML piden v${[...usadas][0]} — con caché immutable, los visitantes recurrentes podrían conservar el anterior`);
  }
}

if (htmlFiles.length < 26) failures.push(`se esperaban al menos 26 HTML y hay ${htmlFiles.length}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Sitio válido: ${htmlFiles.length} páginas, JSON-LD y recursos internos comprobados.`);
