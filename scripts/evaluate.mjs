import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENDPOINTS, endpointHealth, preflight, printChecks, waitForServices } from './environment.mjs';

const stateDir = resolve('.revelation-evaluate');
const statePath = resolve(stateDir, 'state.json');
const logPath = resolve(stateDir, 'applications.log');
const composeFile = 'infra/compose/docker-compose.yml';
const essentialContainers = ['srs-postgres', 'srs-nats', 'srs-temporal', 'srs-keycloak'];

function command(name, args, options = {}) {
  return execFileSync(name, args, { stdio: 'inherit', env: process.env, ...options });
}

function containerRunning(name) {
  try {
    return execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch { return false; }
}

function readState() {
  if (!existsSync(statePath)) return null;
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return null; }
}

async function start(scenario) {
  if (readState()) throw new Error('An evaluator session is already recorded. Run `pnpm evaluate:status` or `pnpm evaluate:stop`.');
  const checks = await preflight({ requireFreeAppPorts: true });
  printChecks(checks);
  if (checks.some((check) => !check.ok)) throw new Error('Evaluator preflight failed. Resolve the FAIL items and retry.');

  mkdirSync(stateDir, { recursive: true });
  const previouslyRunning = essentialContainers.filter(containerRunning);
  const started = Date.now();
  command('docker', ['compose', '-f', composeFile, 'up', '-d', 'postgres', 'nats', 'temporal', 'keycloak']);
  await waitForServices(['keycloak'], 180_000);
  command('pnpm', ['migrate']);
  command('pnpm', ['demo:reset', scenario]);
  command('pnpm', ['demo:validate', scenario]);
  command('pnpm', ['setup:keycloak']);

  const log = await import('node:fs').then(({ openSync }) => openSync(logPath, 'a'));
  const child = spawn('pnpm', ['--parallel', '--filter', '@revelation-srs/api', '--filter', '@revelation-srs/admin', '--filter', '@revelation-srs/portal', 'dev'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, DEMO_DATA_ENABLED: 'true', VITE_DEMO_MODE: 'true' },
  });
  child.unref();
  writeFileSync(statePath, JSON.stringify({ pid: child.pid, previouslyRunning, startedAt: new Date().toISOString(), scenario }, null, 2));

  try {
    await waitForServices(['api', 'admin', 'portal'], 120_000);
  } catch (error) {
    console.error(`Application startup failed. Diagnostic log: ${logPath}`);
    throw error;
  }
  console.log(`\nEvaluation environment ready in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  printLaunchSummary(scenario);
}

async function status() {
  const state = readState();
  const results = await Promise.all(Object.entries(ENDPOINTS).map(([name, url]) => endpointHealth(name, url)));
  printChecks(results);
  console.log(state ? `Session: ${state.scenario}, started ${state.startedAt}` : 'Session: not managed by `pnpm evaluate`');
  try { command('pnpm', ['demo:status']); } catch { /* health output already explains degradation */ }
}

function reset() {
  const state = readState();
  if (!state) throw new Error('Refusing reset: no managed evaluator session is recorded. Run `pnpm evaluate` first.');
  if (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_ENVIRONMENT === 'production') throw new Error('Refusing reset in a production environment.');
  command('pnpm', ['demo:reset', state.scenario]);
  command('pnpm', ['demo:validate', state.scenario]);
  console.log(`Reset complete: ${state.scenario}`);
}

function stop() {
  const state = readState();
  if (!state) { console.log('No managed evaluator session is recorded.'); return; }
  if (state.pid) {
    try { process.kill(-state.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
  const owned = essentialContainers.filter((name) => !state.previouslyRunning.includes(name));
  for (const container of owned) {
    try { execFileSync('docker', ['stop', container], { stdio: 'ignore' }); } catch { /* already stopped */ }
  }
  rmSync(statePath, { force: true });
  console.log(`Stopped the evaluator applications and ${owned.length} container(s) started by this session. Data volumes were preserved.`);
}

function printLaunchSummary(scenario) {
  console.log(`
Admin:   http://localhost:5173  (registry / Demo-2026!)
Portal:  http://localhost:5174  (alice.demo / Demo-2026!)
API:     http://localhost:3000/documentation
Scenario: ${scenario} (fictional demo data; Alpha product)

Start with TRY.md and docs/appraisal/README.md.
Status: pnpm evaluate:status   Reset: pnpm evaluate:reset   Stop: pnpm evaluate:stop
Change scenario: pnpm evaluate --scenario <slug> (after pnpm evaluate:stop) — see pnpm demo:list
Known limitations: docs/product/current-capabilities.md`);
}

function scenarioArg() {
  const index = process.argv.indexOf('--scenario');
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : 'module-selection';
}

const action = process.argv[2]?.startsWith('--') ? 'start' : (process.argv[2] ?? 'start');
try {
  if (action === 'start') await start(scenarioArg());
  else if (action === 'status') await status();
  else if (action === 'reset') reset();
  else if (action === 'stop') stop();
  else throw new Error('Usage: node scripts/evaluate.mjs start [--scenario <slug>] | status | reset | stop');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
