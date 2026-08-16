import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCapabilities } from './lib/authoritative-ids.mjs';

const inputDir = process.argv[2] ?? 'test-results/evidence';
const outputDir = process.argv[3] ?? 'test-results/evidence-report';
mkdirSync(outputDir, { recursive: true });
const manifests = existsSync(inputDir)
  ? readdirSync(inputDir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(inputDir, name), 'utf8')))
  : [];

function summarise(items) {
  return items.length === 0 ? 'not-run' : items.some((item) => item.result === 'failed') ? 'failed' : items.some((item) => item.result === 'invalid-environment') ? 'invalid-environment' : 'passed';
}

const classes = ['unit', 'component', 'mocked-ui', 'service-integration', 'real-journey', 'uat'];
const rows = classes.map((evidenceClass) => {
  const items = manifests.filter((item) => item.evidenceClass === evidenceClass);
  return { evidenceClass, result: summarise(items), suites: items.map((item) => item.suite), durationMs: items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) };
});

const capabilityRows = getCapabilities().map((capability) => {
  const items = manifests.filter((item) => item.metadata?.capabilities?.includes(capability.id));
  return { ...capability, result: summarise(items), suites: items.map((item) => item.suite) };
});

const generatedAt = new Date().toISOString();
const markdown = [
  '# Test Evidence Summary', '', `> Generated: ${generatedAt}`, '',
  'This report distinguishes evidence classes. A passing mocked UI suite is not full-stack evidence.', '',
  '## By evidence class', '',
  '| Evidence class | Result | Suites | Duration |', '|---|---|---|---:|',
  ...rows.map((row) => `| ${row.evidenceClass} | ${row.result} | ${row.suites.join(', ') || '—'} | ${(row.durationMs / 1000).toFixed(1)}s |`), '',
  '## By capability', '',
  'Capabilities with no principal journey tagged against them show `not-run`; consult the current capability matrix for their implementation status rather than reading absence of test evidence as absence of capability.', '',
  '| Capability | Matrix status | Test evidence | Suites |', '|---|---|---|---|',
  ...capabilityRows.map((row) => `| ${row.name} | ${row.status} | ${row.result} | ${row.suites.join(', ') || '—'} |`), '',
  '## Limitations', '',
  '- `not-run` is reported explicitly and never converted to a pass.',
  '- UAT environment invalidation is not counted as a product failure or pass.',
  '- Only capabilities tagged on a principal journey (`e2e/journey-metadata.json`) have evidence-class data here; most capabilities are exercised by suites that do not yet carry that metadata.',
  '',
].join('\n');
writeFileSync(join(outputDir, 'summary.md'), markdown);
writeFileSync(join(outputDir, 'summary.json'), JSON.stringify({ schemaVersion: 1, generatedAt, rows, capabilityRows, manifests }, null, 2));
console.log(`Evidence report generated from ${manifests.length} manifest(s): ${outputDir}`);
