import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
console.log('Evidence class: mocked UI (Vite frontends, injected authentication and controlled API responses).');
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...args], { stdio: 'inherit', env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
