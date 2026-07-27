import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backlogPath = resolve(root, 'docs/business-processes/revelation-change-backlog.md');
const requirementsPath = resolve(root, 'docs/requirements/business-process-p0-functional-requirements.md');
const tracePath = resolve(root, 'docs/business-processes/p0-requirements-and-adr-traceability.md');
const errors = [];

const backlog = readFileSync(backlogPath, 'utf8');
const requirements = readFileSync(requirementsPath, 'utf8');
const trace = readFileSync(tracePath, 'utf8');

const p0Ids = new Set(
  [...backlog.matchAll(/^\| (BPR-[WDI]\d{2}) \| P0 \|/gm)].map((match) => match[1]),
);
const tracedP0Ids = new Set(
  [...trace.matchAll(/^\| (BPR-[WDI]\d{2}) \|/gm)].map((match) => match[1]),
);
const requirementIds = [
  ...requirements.matchAll(/^\| ((?:BPC|ESP|ABR|RSS|IGA|XIC)-\d{3}) \|/gm),
].map((match) => match[1]);
const knownRequirementIds = new Set(requirementIds);

for (const id of p0Ids) {
  if (!tracedP0Ids.has(id)) errors.push(`P0 backlog item ${id} has no traceability row`);
}
for (const id of tracedP0Ids) {
  if (!p0Ids.has(id)) errors.push(`Traceability row ${id} is not a P0 backlog item`);
}
if (knownRequirementIds.size !== requirementIds.length) {
  errors.push('P0 functional requirements contain a duplicate requirement ID');
}

for (const referencedId of new Set(
  [...trace.matchAll(/\b(?:BPC|ESP|ABR|RSS|IGA|XIC)-\d{3}\b/g)].map((match) => match[0]),
)) {
  if (!knownRequirementIds.has(referencedId)) {
    errors.push(`Traceability references unknown requirement ${referencedId}`);
  }
}

for (let number = 16; number <= 22; number += 1) {
  const prefix = `ADR-${String(number).padStart(3, '0')}-`;
  const adrReference = trace.match(new RegExp(`ADR-${String(number).padStart(3, '0')}`));
  const adrPath = [
    'ADR-016-authoritative-business-state-and-workflow-separation.md',
    'ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md',
    'ADR-018-versioned-regulatory-submission-lineage.md',
    'ADR-019-per-target-exchange-ledger-and-reconciliation.md',
    'ADR-020-staged-assessment-authority-and-ratification-lock.md',
    'ADR-021-governed-identity-rights-retention-and-audit.md',
    'ADR-022-cas-and-sponsor-compliance-evidence-boundary.md',
  ].find((filename) => filename.startsWith(prefix));
  const fullPath = resolve(root, 'docs/decisions', adrPath);
  if (!adrReference) errors.push(`${prefix.slice(0, -1)} is not referenced by traceability`);
  if (!existsSync(fullPath)) errors.push(`${prefix.slice(0, -1)} file is missing`);
  else {
    const contents = readFileSync(fullPath, 'utf8');
    for (const section of ['**Status**:', '## Context', '## Decision', '## Rationale', '## Consequences', '## Alternatives Considered', '## Traceability']) {
      if (!contents.includes(section)) errors.push(`${adrPath} is missing ${section}`);
    }
    if (!/\*\*Status\*\*: (?:Proposed|Accepted for generic product implementation)/.test(contents)) {
      errors.push(`${adrPath} has an unsupported status`);
    }
  }
}

for (const [file, contents] of [[requirementsPath, requirements], [tracePath, trace]]) {
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#', 1)[0];
    if (!target || target.startsWith('http')) continue;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) {
      errors.push(`${file}: broken local link ${match[1]}`);
    }
  }
}

if (p0Ids.size !== 23) errors.push(`Expected 23 P0 backlog items, found ${p0Ids.size}`);
if (knownRequirementIds.size !== 76) errors.push(`Expected 76 P0 requirements, found ${knownRequirementIds.size}`);

if (errors.length > 0) {
  console.error(`P0 requirement checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`P0 requirement checks passed: ${p0Ids.size} backlog items, ${knownRequirementIds.size} requirements, 7 ADRs.`);
}
