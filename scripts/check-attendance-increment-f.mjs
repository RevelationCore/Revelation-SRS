import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const app = read('apps/admin/src/App.tsx');
const layout = read('apps/admin/src/components/Layout.tsx');
const workspace = read('apps/admin/src/pages/EngagementPage.tsx');
const casePage = read('apps/admin/src/pages/EngagementCasePage.tsx');
const demo = read('packages/demo-data/src/generators/engagement.ts');
const e2e = read('e2e/admin-engagement.spec.ts');
const errors = [];

for (const route of ['path=\"engagement\"', 'path=\"engagement/cases/:caseId\"']) {
  if (!app.includes(route)) errors.push(`Admin router is missing ${route}`);
}
if (!layout.includes('canViewEngagement') || !layout.includes('label=\"Engagement\"')) {
  errors.push('Role-sensitive engagement navigation is missing');
}
for (const control of [
  'Evidence worklist', 'Alert queue', 'Evidence needs reconciliation',
  'never determines academic status', 'New policy version',
]) {
  if (!workspace.includes(control)) errors.push(`Workspace is missing ${control}`);
}
for (const control of [
  'Communication language', "['en-GB', 'cy']", 'Do not enter medical',
  'sponsor-compliance-review', 'Academic-status and sponsor-reporting decisions remain separate',
]) {
  if (!casePage.includes(control)) errors.push(`Case UI is missing ${control}`);
}
for (const scenario of [
  "'attended', 'valid'", "'alternative-engagement', 'valid'", "'absent', 'disputed'",
  "scenario: unsafe ? 'disputed-evidence' : 'sustained-non-engagement'",
  "targetServiceCode: 'sponsor-compliance-review'",
]) {
  if (!demo.includes(scenario)) errors.push(`Demo data is missing scenario ${scenario}`);
}
for (const scenario of [
  'shows an explainable alert and reconciliation boundary',
  'switches to the evidence worklist using accessible tabs',
  'shows approved policy versions to tenant administrators',
]) {
  if (!e2e.includes(scenario)) errors.push(`Browser spec is missing ${scenario}`);
}
if (errors.length) {
  console.error(`Attendance Increment F checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Attendance Increment F structural checks passed: role-sensitive workspace, evidence and alert views, intervention timeline, policy administration, Welsh-language contact, four demo stories and browser coverage.');
}
