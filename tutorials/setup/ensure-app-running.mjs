#!/usr/bin/env node
// Standalone CLI: checks the API + portal dev servers and starts any that
// aren't already up. Leaves them running afterwards — this is meant for a
// developer iterating on the tutorial (e.g. `tutorial:test`, `tutorial:record`
// run repeatedly). The `tutorial:all` orchestrator uses app-lifecycle.mjs
// directly instead, so it can stop only the processes it started itself.

import { APPS, ensureStarted } from './app-lifecycle.mjs';

async function main() {
  for (const app of Object.values(APPS)) {
    await ensureStarted(app);
  }
  console.log('\nBoth the API and the portal are reachable.');
}

main().catch((error) => {
  console.error('\nFailed to start the application:', error.message);
  process.exitCode = 1;
});
