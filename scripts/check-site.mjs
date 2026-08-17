import { readFile, readdir, stat, access } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
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
  for (const [label, regex] of [['title', /<title>[\s\S]*?<\/title>/i], ['description', /name="description"/i], ['funnel', /assets\/funnel\.js/], ['widget', /assets\/vai-widget\.js/]]) {
    if (!regex.test(html)) failures.push(`${rel}: falta ${label}`);
  }
  if (!allowPlaceholders && /REPLACE_WITH_[A-Z_]+/.test(html)) failures.push(`${rel}: marcador REPLACE_WITH_* sin sustituir`);
  if (/data-velai-leadform/.test(html) && !/assets\/leadform\.js/.test(html)) failures.push(`${rel}: usa data-velai-leadform pero no carga leadform.js`);
  // Los CSS son immutable 1 año en _headers: sin ?v= un cambio no llega a visitantes recurrentes.
  for (const cssMatch of html.matchAll(/href="(\/[^"]+\.css)(\?[^"]*)?"/g)) {
    if (!cssMatch[2]) failures.push(`${rel}: CSS sin versión ?v= → ${cssMatch[1]}`);
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
if (htmlFiles.length < 26) failures.push(`se esperaban al menos 26 HTML y hay ${htmlFiles.length}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Sitio válido: ${htmlFiles.length} páginas, JSON-LD y recursos internos comprobados.`);
