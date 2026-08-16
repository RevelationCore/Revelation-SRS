import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [suite, evidenceClass, outcome = 'not-run', duration = '0'] = process.argv.slice(2);
if (!suite || !evidenceClass) {
  console.error('Usage: node scripts/write-evidence-manifest.mjs <suite> <evidence-class> <success|failure|cancelled|skipped> [duration-ms]');
  process.exit(2);
}
const result = outcome === 'success' ? 'passed' : outcome === 'failure' ? 'failed' : 'not-run';

function journeyMetadataFor(forEvidenceClass) {
  const path = 'e2e/journey-metadata.json';
  if (!existsSync(path)) return {};
  const { journeys } = JSON.parse(readFileSync(path, 'utf8'));
  const matches = journeys.filter((journey) => journey.evidenceClass === forEvidenceClass);
  if (matches.length === 0) return {};
  const union = (key) => [...new Set(matches.flatMap((journey) => journey[key]))];
  return { journeyIds: matches.map((journey) => journey.id), capabilities: union('capabilities'), personas: union('personas'), requirements: union('requirements') };
}

const manifest = {
  schemaVersion: 1,
  suite,
  commit: process.env.GITHUB_SHA ?? 'local',
  environment: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
  startedAt: new Date().toISOString(),
  durationMs: Number(duration) || 0,
  evidenceClass,
  result,
  metadata: journeyMetadataFor(evidenceClass),
  artifacts: [],
  limitations: evidenceClass === 'mocked-ui' ? ['Authentication and domain API responses are controlled; this is not full-stack evidence.'] : [],
};
mkdirSync('test-results/evidence', { recursive: true });
writeFileSync(`test-results/evidence/${suite}.json`, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${suite} evidence manifest (${result}).`);
