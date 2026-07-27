import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  specification: 'docs/product/attendance-engagement-vertical-slice.md',
  approvalPack: 'docs/product/attendance-engagement-increment-a-approval-pack.md',
  adrReview: 'docs/decisions/attendance-vertical-slice-adr-review.md',
  vocabulary: 'docs/architecture/attendance-engagement-contract-vocabulary.md',
  assessment: 'docs/architecture/attendance-engagement-privacy-threat-assessment.md',
  dataRegister: 'docs/requirements/data-subject-register.md',
};
const documents = {};
const errors = [];

for (const [name, projectPath] of Object.entries(paths)) {
  const path = resolve(root, projectPath);
  if (!existsSync(path)) {
    errors.push(`Missing ${name}: ${projectPath}`);
  } else {
    documents[name] = readFileSync(path, 'utf8');
  }
}

if (errors.length === 0) {
  for (const id of ['ATT-A01', 'ATT-A02', 'ATT-A03', 'ATT-A04', 'ATT-A05', 'ATT-A06', 'ATT-A07', 'ATT-A08', 'ATT-A09', 'ATT-A10']) {
    if (!documents.approvalPack.includes(`| ${id} |`)) errors.push(`Approval pack is missing ${id}`);
  }

  for (const review of ['A-ARCH', 'A-PROC', 'A-UK', 'A-PRIV', 'A-SEC', 'A-SPON', 'A-INT']) {
    if (!documents.approvalPack.includes(`| ${review} |`)) errors.push(`Approval pack is missing ${review}`);
  }

  for (const setCode of [
    'engagement-activity-type-code',
    'engagement-event-mode-code',
    'engagement-observation-outcome-code',
    'engagement-capture-method-code',
    'engagement-data-quality-code',
    'engagement-alert-status-code',
    'engagement-case-status-code',
    'engagement-case-outcome-code',
    'engagement-referral-status-code',
  ]) {
    if (!documents.vocabulary.includes(`\`${setCode}\``)) errors.push(`Vocabulary is missing ${setCode}`);
  }

  const threats = [...documents.assessment.matchAll(/^\| ATT-T\d{2} \|/gm)];
  if (threats.length < 18) errors.push(`Expected at least 18 assessed threats, found ${threats.length}`);

  for (const adr of ['ADR-016', 'ADR-019', 'ADR-022']) {
    if (!documents.adrReview.includes(adr)) errors.push(`ADR review is missing ${adr}`);
  }

  if (!documents.assessment.includes('controller DPIA is required')) {
    errors.push('Privacy assessment does not record the DPIA requirement');
  }
  if (!documents.dataRegister.includes('Sponsor-compliance referral')) {
    errors.push('Data-subject register does not contain the sponsor-compliance boundary');
  }
  if (!documents.specification.includes('named approvals pending')) {
    errors.push('Vertical-slice plan does not report the Increment A approval gate');
  }
}

if (errors.length > 0) {
  console.error(`Attendance Increment A checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const pending = [...documents.approvalPack.matchAll(/\| Pending \|/g)].length;
  console.log(`Attendance Increment A is structurally ready: 7 review roles, 10 decisions, 9 value sets and 18 threats; ${pending} approval entries remain pending.`);
}
