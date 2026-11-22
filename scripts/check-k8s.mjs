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
  // ADR-030: the malware scanner, who may reach it, and who uses it.
  {
    const named = (kind, name) => docs.find((x) => x.kind === kind && x.metadata.name.endsWith(name)); // overlays may prefix names
    const clamav = named('Deployment', 'srs-clamav');
    if (!clamav) errors.push(`${target}: Deployment srs-clamav is missing`);
    else {
      const spec = clamav.spec.template.spec;
      const keys = (spec.topologySpreadConstraints ?? []).map((c) => c.topologyKey);
      if (!keys.includes('kubernetes.io/hostname') || !keys.includes('topology.kubernetes.io/zone')) errors.push(`${target}: srs-clamav does not spread across nodes and zones`);
      const clamd = spec.containers.find((c) => c.name === 'clamd');
      if (!clamd?.startupProbe || !clamd?.readinessProbe || !clamd?.livenessProbe) errors.push(`${target}: srs-clamav needs startup, readiness and liveness probes`);
      const scanTmp = spec.volumes?.find((v) => v.name === 'scan-tmp');
      if (scanTmp?.emptyDir?.medium !== 'Memory') errors.push(`${target}: srs-clamav must spool scans to memory, not node disk`);
    }
    const conf = named('ConfigMap', 'srs-clamav-config')?.data?.['clamd.conf'] ?? '';
    const mb = (k) => { const m = new RegExp(`^${k}\\s+(\\d+)M$`, 'm').exec(conf); return m ? Number(m[1]) : 0; };
    // The document store refuses anything over 15 MB; clamd must accept at least that much.
    for (const k of ['StreamMaxLength', 'MaxFileSize']) if (mb(k) < 15) errors.push(`${target}: clamd ${k} must be at least 15M (the upload limit)`);
    if (!/^AlertExceedsMax yes$/m.test(conf)) errors.push(`${target}: clamd must refuse content it cannot fully scan (AlertExceedsMax yes)`);
    const policy = named('NetworkPolicy', 'allow-ingress-to-clamav');
    const allowed = (policy?.spec.ingress ?? []).flatMap((r) => (r.from ?? []).flatMap((f) => f.podSelector?.matchExpressions?.flatMap((e) => e.values) ?? [f.podSelector?.matchLabels?.['app.kubernetes.io/name']]));
    if (JSON.stringify([...allowed].sort()) !== JSON.stringify(['srs-api', 'srs-wellbeing', 'srs-worker'])) errors.push(`${target}: allow-ingress-to-clamav must admit exactly srs-api, srs-worker and srs-wellbeing, not ${allowed.join(', ')}`);
    for (const d of docs.filter((x) => x.kind === 'Deployment')) {
      for (const c of d.spec.template.spec.containers) {
        const env = Object.fromEntries((c.env ?? []).map((e) => [e.name, e.value]));
        if ('DOCUMENT_SCANNER' in env && (env['DOCUMENT_SCANNER'] !== 'clamd' || !env['CLAMD_HOST'])) errors.push(`${target}: ${d.metadata.name} must use DOCUMENT_SCANNER=clamd with CLAMD_HOST`);
      }
    }
    for (const name of ['srs-api', 'srs-worker', 'srs-wellbeing']) {
      const d = named('Deployment', name);
      if (d && !d.spec.template.spec.containers.some((c) => (c.env ?? []).some((e) => e.name === 'DOCUMENT_SCANNER'))) errors.push(`${target}: ${name} stores documents but sets no DOCUMENT_SCANNER`);
    }
  }
  if (target === 'overlays/production') {
    if (!docs.some((x) => x.kind === 'PodDisruptionBudget' && x.metadata.name === 'srs-clamav-pdb')) errors.push('production: PodDisruptionBudget srs-clamav-pdb is missing');
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
