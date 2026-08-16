import { spawnSync } from 'node:child_process';

console.warn('DEPRECATED: `pnpm test:e2e` is mocked UI evidence. Use `pnpm test:ui:mocked`.');
const result = spawnSync('pnpm', ['test:ui:mocked', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
