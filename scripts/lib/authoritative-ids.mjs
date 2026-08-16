import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const ID_ROW = /^\| ([A-Z]{2,5}(?:-[A-Z]{2,5})?-[0-9]{3}) \|/gm;

function idsFrom(relativePath) {
  const text = readFileSync(resolve(root, relativePath), 'utf8');
  return [...text.matchAll(ID_ROW)].map((match) => match[1]);
}

export function getRequirementIds() {
  return new Set([
    ...idsFrom('docs/requirements/functional-requirements.md'),
    ...idsFrom('docs/requirements/non-functional-requirements.md'),
    ...idsFrom('docs/requirements/business-process-p0-functional-requirements.md'),
  ]);
}

export function getCapabilities() {
  const matrix = readFileSync(resolve(root, 'docs/product/current-capabilities.md'), 'utf8');
  const rows = [...matrix.matchAll(/^\| `([a-z0-9-]+)` \| ([^|]+) \| \*\*([^*]+)\*\* \|/gm)];
  return rows.map((row) => ({ id: row[1], name: row[2].trim(), status: row[3].trim() }));
}

export function getCapabilityIds() {
  return new Set(getCapabilities().map((capability) => capability.id));
}

export function getPersonaSlugs() {
  const catalogue = readFileSync(resolve(root, 'docs/requirements/actor-catalogue.md'), 'utf8');
  const rows = [...catalogue.matchAll(/^\| `([a-z0-9-]+)` \|/gm)];
  return new Set(rows.map((row) => row[1]));
}
