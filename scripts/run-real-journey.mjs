import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { endpointHealth, printChecks } from './environment.mjs';

const required = [
  ['api', `${(process.env.DEMO_GOLDEN_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/health`],
  ['admin', process.env.DEMO_GOLDEN_ADMIN_URL ?? 'http://localhost:5173'],
];
const checks = await Promise.all(required.map(([name, url]) => endpointHealth(name, url)));
printChecks(checks);
if (checks.some((check) => !check.ok)) {
  mkdirSync('test-results/real-journey', { recursive: true });
  writeFileSync('test-results/real-journey/readiness.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
  console.error('Real-journey prerequisites are unavailable. This is a failure, not a skipped test. Start with `pnpm evaluate` or the CI journey setup.');
  process.exit(1);
}
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.golden.config.ts', ...args], { stdio: 'inherit', env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
