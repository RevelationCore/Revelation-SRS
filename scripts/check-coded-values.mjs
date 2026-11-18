#!/usr/bin/env node
// Screens show every coded value with its label, and every picker of codes
// is backed by the value-set system (CodeLabel / CodeBadge / CodeSelect /
// useCodes in @revelation-srs/ui). This check fails on the patterns that
// show a bare code or hard-code a list of codes in a screen:
//
//   - an <option value="literal"> (a code list written into the page)
//   - <Badge value={...} /> with no label (the badge shows the code)
//   - {x.somethingCode} rendered as text, or a code "prettified" with
//     .replace(/-/g, ' ')
//   - an in-page label map: const SOMETHING_LABELS = { ... }
//
// and on any value-set field a screen asks for that is not registered (a
// typo in an entity or field name), using test/fixtures/value-sets.json.
//
// A line that is genuinely not a code (a view mode, a UI preset) carries
// the marker `coded-values: not a code` in a comment on that line or one
// of the three lines before.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const APPS = ['apps/admin/src', 'apps/portal/src'];
const MARKER = 'coded-values: not a code';

// Codes that are identifiers or references, not values from a value set.
const IDENTIFIERS = new Set([
  'moduleCode', 'periodCode', 'setCode', 'programmeCode', 'definitionCode', 'environmentCode', 'intakeCode',
  'verificationCode', 'ceremonyCode', 'cycleCode', 'groupCode', 'groupSetCode', 'flowCode', 'objectCode', 'ruleSetCode',
  'qualificationCode', 'templateCode', 'tenantCode', 'policyCode', 'ruleCode', 'exchangeTypeCode', 'sourceSystemCode',
  'ownerModuleCode', 'localeCode', 'currencyCode', 'countryCode', 'ucasCode', 'ucasProviderCode', 'defaultCurrencyCode',
  'integrationCode', 'workflowCode', 'fieldCode', 'shareCode', 'routeCode', 'patternCode', 'collectionTypeCode',
  'rationaleCode', 'attendanceTypeCode', 'code',
]);

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/value-sets.json'), 'utf8'));
const errors = [];
let checked = 0;

for (const app of APPS) {
  for (const file of files(join(root, app))) {
    const rel = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const allowed = [0, 1, 2, 3].some((back) => (lines[i - back] ?? '').includes(MARKER));
      const at = `${rel}:${i + 1}`;
      if (!allowed) {
        if (/<option value="[A-Za-z][^"]*"/.test(line)) errors.push(`${at}: an <option> with a literal value — use CodeSelect or useCodes`);
        if (/<Badge value=\{[^}]+\}\s*\/>/.test(line)) errors.push(`${at}: a <Badge> with no label shows the code — use CodeBadge or pass label`);
        for (const m of line.matchAll(/(?:>|^\s*)\{\s*([\w.?!]+\.([a-z]\w*Code))\s*(?:\?\?[^}]*)?\}/g)) {
          if (!IDENTIFIERS.has(m[2])) errors.push(`${at}: ${m[1]} is shown as a bare code — use CodeLabel or useCodes().label`);
        }
        if (/Code\.replace\(\/[-_]+\/g, ' '\)/.test(line)) errors.push(`${at}: a code made readable by replacing dashes — use CodeLabel`);
        if (/^(export )?const [A-Z_]*LABELS?\b[^=]*= \{/.test(line.trim())) errors.push(`${at}: an in-page label map — labels belong in a value set`);
      }
      for (const m of line.matchAll(/(?:entity="([\w.]+)"\s+field="(\w+)"|use(?:Codes|ValueSet)\('([\w.]+)',\s*'(\w+)'\))/g)) {
        const key = `${m[1] ?? m[3]}/${m[2] ?? m[4]}`;
        checked += 1;
        if (!fixture[key]) errors.push(`${at}: no value set is registered for ${key}`);
      }
      for (const m of line.matchAll(/useWellbeingCodes\('(\w+)',\s*'(\w+)'\)/g)) {
        checked += 1;
        if (!fixture[`wellbeing.${m[1]}/${m[2]}`]) errors.push(`${at}: no value set is registered for wellbeing.${m[1]}/${m[2]}`);
      }
    });
  }
}

if (errors.length > 0) {
  console.error(`Coded-value checks failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Coded-value checks passed: no bare codes or hard-coded code lists; ${checked} value-set references resolve.`);
