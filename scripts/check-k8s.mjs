#!/usr/bin/env node
// The Kubernetes manifests must build and be deployable (BL-012). When this
// check was written, none of the three overlays built (patches without a
// target, an invalid field), and four of five container commands ran entry
// points that do not exist in their images.
//
// For base and every overlay, with `kubectl kustomize`:
// - the build succeeds;
// - every service Deployment spreads its replicas across nodes and zones;
// - every container command that runs `node <file>` names an entry point
//   the service's source compiles to (src/<name>.ts -> dist/<name>.js);
// - in production, NATS runs at least 3 nodes and SRS_EVENTS has as many
//   replicas.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const SOURCE = {
  'srs-api': 'apps/api', 'srs-worker': 'apps/api', 'srs-wellbeing': 'modules/wellbeing',
  'srs-attendance': 'modules/attendance', 'srs-vle-adapter': 'adapters/vle', 'srs-admin': null, 'srs-portal': null,
};
const targets = ['base', ...readdirSync(join(root, 'infra/k8s/overlays')).map((o) => `overlays/${o}`)];
const errors = [];

function build(target) {
  try {
    return execFileSync('kubectl', ['kustomize', join(root, 'infra/k8s', target)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') { console.error('check:k8s needs kubectl on the PATH'); process.exit(2); }
    errors.push(`${target}: kustomize build failed: ${String(err.stderr ?? err.message).split('\n').filter((l) => !l.startsWith('# Warning')).join(' ').trim()}`);
    return null;
  }
}

for (const target of targets) {
  const out = build(target);
  if (!out) continue;
  const docs = YAML.parseAllDocuments(out).map((d) => d.toJS()).filter(Boolean);
  for (const d of docs.filter((x) => x.kind === 'Deployment')) {
    const base = Object.keys(SOURCE).find((n) => d.metadata.name.endsWith(n));
    if (!base) continue;
    const spec = d.spec.template.spec;
    const keys = (spec.topologySpreadConstraints ?? []).map((c) => c.topologyKey);
    if (!keys.includes('kubernetes.io/hostname') || !keys.includes('topology.kubernetes.io/zone')) {
      errors.push(`${target}: ${d.metadata.name} does not spread across nodes and zones`);
    }
    const src = SOURCE[base];
    if (!src) continue;
    for (const c of spec.containers) {
      const cmd = [...(c.command ?? []), ...(c.args ?? [])].join(' ');
      for (const m of cmd.matchAll(/\bnode\s+(?:\S*\/)?dist\/([\w-]+)\.js\b/g)) {
        if (!existsSync(join(root, src, 'src', `${m[1]}.ts`))) {
          errors.push(`${target}: ${d.metadata.name} runs dist/${m[1]}.js, but ${src}/src/${m[1]}.ts does not exist`);
        }
      }
      if (/\bnode\s+apps\//.test(cmd)) errors.push(`${target}: ${d.metadata.name} runs a repository path; the image holds the deployed package at /app`);
    }
  }
  if (target === 'overlays/production') {
    const nats = docs.find((x) => x.kind === 'StatefulSet' && x.metadata.name === 'srs-nats');
    const job = docs.find((x) => x.kind === 'Job' && x.metadata.name === 'srs-nats-streams');
    const streamReplicas = Number(job?.spec.template.spec.containers[0].env?.find((e) => e.name === 'STREAM_REPLICAS')?.value);
    if (!nats || nats.spec.replicas < 3) errors.push('production: srs-nats must run at least 3 nodes');
    if (!job) errors.push('production: the srs-nats-streams Job that declares SRS_EVENTS is missing');
    else if (streamReplicas !== nats?.spec.replicas) errors.push(`production: SRS_EVENTS has ${streamReplicas} replicas but NATS runs ${nats?.spec.replicas} nodes`);
  }
}

if (errors.length) {
  console.error(`check:k8s found ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check:k8s ok: ${targets.length} builds (${targets.join(', ')})`);
