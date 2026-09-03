// Decisiones puras y CLI de la puerta CI → CD. El CI genera un manifiesto con el
// diff completo del push; CD solo acepta ese manifiesto para el mismo SHA/run verde.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/;
const ZERO_SHA = '0'.repeat(40);

function normalizedPaths(files) {
  return [...new Set((files || []).map((file) => String(file).trim().replaceAll('\\', '/')).filter(Boolean))].sort();
}

export function deploymentScope(files) {
  const changedFiles = normalizedPaths(files);
  // Los Markdown son documentación aunque vivan junto al código (por ejemplo,
  // panel/INTEGRACION.md). Todo lo demás se considera desplegable por defecto: una
  // lista positiva de carpetas acabaría olvidando un componente nuevo.
  const deployFiles = changedFiles.filter((file) => !file.startsWith('docs/') && !file.toLowerCase().endsWith('.md'));
  return {
    deploy: deployFiles.length > 0,
    reason: changedFiles.length === 0 ? 'no_changes' : deployFiles.length ? 'deployable_changes' : 'documentation_only',
    changedFiles,
    deployFiles,
  };
}

export function deploymentScopeForPush(before, files) {
  return before === ZERO_SHA
    ? { deploy: true, reason: 'initial_push', changedFiles: [], deployFiles: [] }
    : deploymentScope(files);
}

export function deploymentDecision({ candidateSha, currentSha, ciRunId, metadata }) {
  if (!SHA_RE.test(String(candidateSha)) || !SHA_RE.test(String(currentSha))) throw new Error('invalid_sha');
  if (!metadata || metadata.version !== 1 || metadata.sha !== candidateSha
      || String(metadata.ciRunId) !== String(ciRunId)) throw new Error('invalid_ci_metadata');
  if (currentSha !== candidateSha) return { deploy: false, reason: 'superseded' };
  if (metadata.deploy !== true) return { deploy: false, reason: metadata.reason || 'documentation_only' };
  return { deploy: true, reason: 'validated' };
}

async function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

async function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function stdinText() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function createMetadata() {
  const before = String(process.env.DEPLOY_BEFORE || '').toLowerCase();
  const sha = String(process.env.DEPLOY_SHA || '').toLowerCase();
  const ciRunId = String(process.env.DEPLOY_CI_RUN_ID || '');
  const destination = resolve(process.env.DEPLOY_METADATA_PATH || 'deploy-metadata.json');
  if ((!SHA_RE.test(before) && before !== ZERO_SHA) || !SHA_RE.test(sha) || !/^\d+$/.test(ciRunId)) {
    throw new Error('invalid_metadata_input');
  }
  const files = before === ZERO_SHA ? [] : (await stdinText()).split(/\r?\n/);
  const scope = deploymentScopeForPush(before, files);
  const metadata = { version: 1, sha, before, ciRunId, ...scope };
  await writeFile(destination, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Alcance de deploy: ${scope.reason} (${scope.deployFiles.length}/${scope.changedFiles.length} ficheros).`);
}

async function verifyMetadata() {
  const candidateSha = String(process.env.DEPLOY_SHA || '').toLowerCase();
  const currentSha = String(process.env.DEPLOY_CURRENT_SHA || '').toLowerCase();
  const ciRunId = String(process.env.DEPLOY_CI_RUN_ID || '');
  const metadata = JSON.parse(await readFile(resolve(process.env.DEPLOY_METADATA_PATH || 'deploy-metadata.json'), 'utf8'));
  const decision = deploymentDecision({ candidateSha, currentSha, ciRunId, metadata });
  await output({ deploy: String(decision.deploy), sha: candidateSha, ci_run_id: ciRunId, reason: decision.reason });
  if (decision.deploy) {
    await summary(`### Despliegue autorizado\n\nSHA \`${candidateSha}\` validado por CI (run \`${ciRunId}\`) con cambios desplegables.`);
  } else if (decision.reason === 'superseded') {
    await summary(`### Despliegue omitido limpiamente\n\nEl SHA verde \`${candidateSha}\` fue superado por \`${currentSha}\`; no se ejecutará ningún paso de staging ni producción.`);
  } else {
    await summary(`### Despliegue omitido limpiamente\n\nEl SHA verde \`${candidateSha}\` solo contiene cambios documentales; no requiere staging ni producción.`);
  }
}

async function checkFreshness() {
  const candidateSha = String(process.env.DEPLOY_SHA || '').toLowerCase();
  const currentSha = String(process.env.DEPLOY_CURRENT_SHA || '').toLowerCase();
  if (!SHA_RE.test(candidateSha) || !SHA_RE.test(currentSha)) throw new Error('invalid_sha');
  const fresh = candidateSha === currentSha;
  await output({ fresh: String(fresh) });
  if (!fresh) {
    await summary(`### Despliegue omitido limpiamente\n\nMientras esperaba, \`main\` avanzó de \`${candidateSha}\` a \`${currentSha}\`; los pasos posteriores quedan omitidos.`);
  }
}

async function main() {
  if (process.argv[2] === 'metadata') return createMetadata();
  if (process.argv[2] === 'verify') return verifyMetadata();
  if (process.argv[2] === 'freshness') return checkFreshness();
  throw new Error('usage: deploy-scope.mjs metadata|verify|freshness');
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) await main();
