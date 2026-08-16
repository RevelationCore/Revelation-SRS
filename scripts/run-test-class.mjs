import { spawnSync } from 'node:child_process';

const kind = process.argv[2];
const commands = {
  unit: [['pnpm', ['-r', 'test']], ['pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.e2e-helpers.config.ts']]],
  component: [['pnpm', ['-r', '--if-present', 'test:component']]],
  quick: [
    ['pnpm', ['typecheck']],
    ['pnpm', ['lint']],
    ['pnpm', ['test:unit']],
    ['pnpm', ['test:component']],
  ],
  service: [['pnpm', ['-r', 'test:int']]],
  all: [
    ['pnpm', ['test:quick']],
    ['pnpm', ['test:service']],
    ['pnpm', ['test:ui:mocked']],
    ['pnpm', ['test:journey']],
  ],
};

if (!Object.hasOwn(commands, kind)) {
  console.error(`Unknown test class "${kind ?? ''}". Expected: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

const descriptions = {
  unit: 'Unit evidence (Node only; excludes *.int.test.*)',
  component: 'React component evidence (controlled HTTP boundaries; no Docker)',
  quick: 'Fast contributor evidence: typecheck, lint, unit and component tests',
  service: 'Service integration evidence (Docker/Testcontainers required)',
  all: 'Release evidence: quick, service, mocked UI and real full-stack journey',
};
console.log(`\nEvidence class: ${descriptions[kind]}\n`);

const started = Date.now();
for (const [command, args] of commands[kind]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\n${kind} evidence completed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
