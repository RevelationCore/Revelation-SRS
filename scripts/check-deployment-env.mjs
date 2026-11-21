#!/usr/bin/env node
// Every environment variable a Kubernetes manifest sets on a service's
// container must be one that service reads (BL-033). Kubernetes set
// ALLOWED_ORIGINS while the API read CORS_ORIGINS, so a deployed API would
// have refused the real admin and portal origins, and nothing noticed.
//
// For each Deployment in infra/k8s, the variables come from the container's
// `env` entries (base and overlay patches). The variables a service reads
// come from its source: process.env['X'], process.env.X, and the config
// helpers optional('X'), required('X'), optionalInt('X', …). Variables the
// start command exports (secrets read from files) count as set. And every
// variable a service require()s must be set (BL-333), apart from the
// KNOWN_GAPS below.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

const root = new URL('..', import.meta.url).pathname;

// Which source a deployment's containers run. Shared packages are read by all.
const SHARED = ['packages/auth/src', 'packages/db/src', 'packages/documents/src', 'packages/workflow/src', 'packages/domain/src'];
const SERVICES = {
  'srs-api':         ['apps/api/src'],
  'srs-worker':      ['apps/api/src'],
  'srs-wellbeing':   ['modules/wellbeing/src'],
  'srs-attendance':  ['modules/attendance/src'],
  'srs-vle-adapter': ['adapters/vle/src'],
};
// Read by the runtime or a library rather than our code.
const RUNTIME = new Set(['NODE_ENV', 'NODE_OPTIONS', 'TZ', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME', 'OTEL_RESOURCE_ATTRIBUTES', 'OTEL_TRACES_SAMPLER', 'OTEL_TRACES_SAMPLER_ARG']);

function files(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'dist') out.push(...files(path)); }
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(path);
  }
  return out;
}

const READ_PATTERNS = [
  /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  // Helpers handed an env object, such as tokenEnv(env = process.env).
  /\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /\b(?:optional|required|optionalInt|optionalBool|requiredInt|requiredUuid)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];
function readsOf(dirs) {
  const names = new Set();
  for (const dir of dirs) for (const file of files(join(root, dir))) {
    const text = readFileSync(file, 'utf8');
    for (const re of READ_PATTERNS) for (const m of text.matchAll(re)) names.add(m[1]);
  }
  return names;
}

function manifests(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .map(String).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(root, dir, f));
}

// Collect env names per deployment from every YAML document, including
// overlay patches (which repeat the deployment name and container env).
const setBy = new Map();
for (const file of manifests('infra/k8s')) {
  for (const doc of YAML.parseAllDocuments(readFileSync(file, 'utf8'))) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'Deployment' && node.metadata?.name) {
        for (const c of node.spec?.template?.spec?.containers ?? []) {
          const list = setBy.get(node.metadata.name) ?? [];
          for (const e of c.env ?? []) list.push({ name: e.name, file: file.replace(root, '') });
          // Secrets injected as files are exported by the start command:
          //   export DATABASE_URL="$(cat /vault/secrets/db)"
          for (const line of [...(c.command ?? []), ...(c.args ?? [])].join('\n').split('\n')) {
            const m = /^\s*export\s+([A-Z][A-Z0-9_]*)=/.exec(line);
            if (m) list.push({ name: m[1], file: file.replace(root, '') });
          }
          setBy.set(node.metadata.name, list);
        }
      }
      for (const v of Object.values(node)) if (typeof v === 'object') visit(v);
      // Kustomize inline patches are YAML strings.
      for (const v of Object.values(node)) if (typeof v === 'string' && v.includes('kind: Deployment')) {
        try { for (const d of YAML.parseAllDocuments(v)) visit(d.toJS()); } catch { /* not YAML */ }
      }
    };
    visit(doc.toJS());
  }
}

// Variables a service cannot start without: required('X') in its own source.
function requiredOf(dirs) {
  const names = new Set();
  for (const dir of dirs) for (const file of files(join(root, dir))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\brequired(?:Int|Uuid)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) names.add(m[1]);
  }
  return names;
}
// Required variables a deployment knowingly does not set yet, each with the
// backlog row that removes it. The check fails if a listed gap is closed, so
// the list cannot go stale.
const KNOWN_GAPS = {
  'srs-vle-adapter': { SERVICE_ACCOUNT_TOKEN: 'BL-333 (replace the static token with a tenant-bound service identity)' },
};

const errors = [];
const gaps = [];
let checked = 0;
for (const [deployment, envs] of setBy) {
  const dirs = SERVICES[deployment];
  if (!dirs) continue; // third-party images (Temporal, NATS, observability)
  const reads = readsOf([...dirs, ...SHARED]);
  for (const { name, file } of envs) {
    checked++;
    if (!RUNTIME.has(name) && !reads.has(name)) errors.push(`${file}: ${deployment} sets ${name}, which its source never reads`);
  }
  const set = new Set(envs.map((e) => e.name));
  const known = KNOWN_GAPS[deployment] ?? {};
  for (const name of requiredOf(dirs)) {
    if (set.has(name)) {
      if (known[name]) errors.push(`${deployment} now sets ${name}: remove it from KNOWN_GAPS (${known[name]})`);
    } else if (known[name]) gaps.push(`${deployment} does not set required ${name}: ${known[name]}`);
    else errors.push(`${deployment} does not set ${name}, which its source requires to start`);
  }
}

if (errors.length) {
  console.error(`check:deployment-env found ${errors.length} problem(s):`);
  for (const e of [...new Set(errors)]) console.error(`  - ${e}`);
  process.exit(1);
}
for (const g of gaps) console.warn(`  known gap: ${g}`);
console.log(`check:deployment-env ok: ${checked} variables across ${[...setBy.keys()].filter((d) => SERVICES[d]).length} service deployments are all read, and every required variable is set${gaps.length ? ` (${gaps.length} known gap)` : ''}`);
