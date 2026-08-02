#!/usr/bin/env node
// Backing script for `pnpm tutorial:all`: prepares tutorial data, starts
// the app if needed, records the demo, generates narration/captions,
// builds the final video, and runs the Phase 9 quality checks — then
// stops only the app processes it started itself, so no background
// process is left running once the command finishes.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, ensureStarted, stopStarted } from '../setup/app-lifecycle.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${command} ${args.join(' ')} ===`);
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`"${command} ${args.join(' ')}" exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  await run('node', ['tutorials/setup/prepare-tutorial-data.mjs']);

  const handles = {};
  for (const app of Object.values(APPS)) {
    handles[app.name] = await ensureStarted(app);
  }

  try {
    await run('npx', ['playwright', 'test', '--config=tutorials/playwright.config.ts']);
    await run('node', ['tutorials/scripts/generate-narration.mjs']);
    await run('node', ['tutorials/scripts/build-overview-video.mjs']);
    await run('node', ['tutorials/scripts/quality-check.mjs']);
  } finally {
    console.log('\nStopping any application processes started by this run...');
    for (const app of Object.values(APPS)) {
      stopStarted(handles[app.name], app);
    }
  }

  console.log('\ntutorial:all complete. See tutorials/output/ for the final video.');
}

main().catch((error) => {
  console.error('\ntutorial:all failed:', error.message);
  process.exitCode = 1;
});
