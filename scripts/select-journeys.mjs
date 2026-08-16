import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getCapabilityIds, getPersonaSlugs, getRequirementIds } from './lib/authoritative-ids.mjs';

const metadata = JSON.parse(readFileSync('e2e/journey-metadata.json', 'utf8'));
const allowedEvidence = new Set(['real-journey', 'mocked-ui', 'service-integration', 'component', 'unit']);

// 'evaluator' is a meta-role for the appraisal/CI workflow itself (see TRY.md,
// scripts/evaluate.mjs), not a product RBAC role — it is deliberately allowed
// alongside the actor-catalogue's role slugs rather than forcing every
// diagnostic/tooling journey onto a persona that doesn't act as that persona.
const allowedPersonas = new Set([...getPersonaSlugs(), 'evaluator']);
const requirementIds = getRequirementIds();
const capabilityIds = getCapabilityIds();

function errors() {
  const found = [];
  if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.journeys)) found.push('metadata must have schemaVersion 1 and a journeys array');
  const ids = new Set();
  for (const journey of metadata.journeys ?? []) {
    if (!journey.id || ids.has(journey.id)) found.push(`journey id is missing or duplicated: ${journey.id}`);
    ids.add(journey.id);
    for (const key of ['titlePattern', 'scenario', 'evidenceClass']) if (!journey[key]) found.push(`${journey.id}: ${key} is required`);
    for (const key of ['capabilities', 'requirements', 'personas']) if (!Array.isArray(journey[key]) || journey[key].length === 0) found.push(`${journey.id}: ${key} must be non-empty`);
    if (!allowedEvidence.has(journey.evidenceClass)) found.push(`${journey.id}: invalid evidence class ${journey.evidenceClass}`);
    for (const capability of journey.capabilities ?? []) {
      if (!capabilityIds.has(capability)) found.push(`${journey.id}: unknown capability "${capability}" (not a current-capabilities.md ID)`);
    }
    for (const requirement of journey.requirements ?? []) {
      if (!requirementIds.has(requirement)) found.push(`${journey.id}: unknown requirement "${requirement}" (not in the functional/non-functional/P0 requirement docs)`);
    }
    for (const persona of journey.personas ?? []) {
      if (!allowedPersonas.has(persona)) found.push(`${journey.id}: unknown persona "${persona}" (not an actor-catalogue role and not "evaluator")`);
    }
  }
  return found;
}

const mode = process.argv[2];
if (mode === 'validate') {
  const found = errors();
  if (found.length) { console.error(found.join('\n')); process.exit(1); }
  console.log(`Journey metadata valid: ${metadata.journeys.length} principal journeys.`);
  process.exit(0);
}
if (!['capability', 'persona'].includes(mode)) {
  console.error('Usage: pnpm test:capability <id> | pnpm test:persona <id> | pnpm check:journey-metadata');
  process.exit(2);
}
const value = process.argv[3];
if (!value) { console.error(`${mode} identifier is required.`); process.exit(2); }
const property = mode === 'capability' ? 'capabilities' : 'personas';
const selected = metadata.journeys.filter((journey) => journey[property].includes(value));
if (selected.length === 0) {
  const known = [...new Set(metadata.journeys.flatMap((journey) => journey[property]))].sort();
  console.error(`Unknown ${mode} "${value}". Known values: ${known.join(', ')}`);
  process.exit(2);
}
console.log(`Selected ${selected.length} real journey metadata record(s): ${selected.map((journey) => journey.id).join(', ')}`);
const grep = selected.map((journey) => journey.titlePattern).join('|');
const result = spawnSync('pnpm', ['test:journey', '--', '--grep', grep], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
