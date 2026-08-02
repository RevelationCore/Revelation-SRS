#!/usr/bin/env node
// Phase 4: puts the application into a known, deterministic, fictional
// starting state for the tutorial recording. This is a thin wrapper around
// the project's own existing demo-data mechanism (packages/demo-data) —
// per the task's working principle, no separate fixture system was built
// where one already exists.
//
// This script performs no production behaviour changes: it only calls the
// same `demo:reset` / `setup:keycloak` commands a developer would run by
// hand, in the right order, with clear logging.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENARIO = process.env['TUTORIAL_DEMO_SCENARIO'] ?? 'module-selection';

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args.join(' ')}" exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  console.log(`Preparing tutorial demo data (scenario: ${SCENARIO})`);

  await run('pnpm', ['demo:reset', SCENARIO]);

  // The demo-data reset step provisions Keycloak personas only when
  // KEYCLOAK_ADMIN_URL is set in its own environment; setup:keycloak sets
  // it explicitly and re-provisions every persona (including alice.demo,
  // used throughout the tutorial). Confirmed necessary by direct testing —
  // omitting this step leaves the reset scenario's Keycloak-side user
  // unpatched, and the tutorial's real OIDC login would fail or show stale
  // credentials.
  await run('pnpm', ['setup:keycloak']);

  console.log('\nTutorial demo data ready.');
  console.log(`  Scenario: ${SCENARIO}`);
  console.log('  Persona:  alice.demo');
}

main().catch((error) => {
  console.error('\nFailed to prepare tutorial demo data:', error.message);
  process.exitCode = 1;
});
