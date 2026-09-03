// El runner backend usa una lista explícita para ser portable entre Node 20 y 24 y
// no descubrir los tests TypeScript del subproyecto panel/. Este guardián evita el
// coste de esa decisión: todo test/*.test.js debe figurar en test:backend.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const command = String(pkg.scripts?.['test:backend'] || '');
const expected = (await readdir(join(root, 'test')))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => `test/${name}`)
  .sort();
const listed = [...command.matchAll(/\btest\/[A-Za-z0-9._-]+\.test\.js\b/g)]
  .map((match) => match[0])
  .filter((name, index, all) => all.indexOf(name) === index)
  .sort();
const missing = expected.filter((name) => !listed.includes(name));
const stale = listed.filter((name) => !expected.includes(name));

if (missing.length || stale.length) {
  if (missing.length) console.error(`Tests omitidos de test:backend: ${missing.join(', ')}`);
  if (stale.length) console.error(`Tests inexistentes en test:backend: ${stale.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Catálogo backend completo: ${expected.length} ficheros.`);
}
