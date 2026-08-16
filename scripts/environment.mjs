import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

// PostgreSQL, NATS and Temporal are deliberately not checked individually
// here: /ready (unlike /health, which is a bare liveness probe that returns
// 200 as soon as the process starts, regardless of its dependencies) checks
// the database, NATS, Temporal and the Keycloak JWKS endpoint itself and
// only returns 200 once all of them do, so a failure in any of them
// correctly fails this readiness check instead of going unnoticed.
export const ENDPOINTS = {
  api: 'http://localhost:3000/ready',
  admin: 'http://localhost:5173',
  portal: 'http://localhost:5174',
  keycloak: 'http://localhost:8081/realms/srs',
};

function major(version) {
  return Number(version.replace(/^v/, '').split('.')[0]);
}

function run(command, args) {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return { ok: false, output: error.stderr?.toString().trim() || error.message };
  }
}

export async function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function endpointHealth(name, url, timeoutMs = 2_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { name, url, ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { name, url, ok: false, detail: error.cause?.code ?? error.message };
  }
}

export async function waitForServices(names, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let results = [];
  while (Date.now() < deadline) {
    results = await Promise.all(names.map((name) => endpointHealth(name, ENDPOINTS[name])));
    if (results.every((result) => result.ok)) return results;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const detail = results.map((result) => `${result.name}: ${result.detail}`).join(', ');
  throw new Error(`Services did not become ready within ${timeoutMs / 1000}s (${detail})`);
}

export async function preflight({ requireFreeAppPorts = false } = {}) {
  const checks = [];
  checks.push({ name: 'Node.js 22+', ok: major(process.version) >= 22, detail: process.version });
  const pnpm = run('pnpm', ['--version']);
  checks.push({ name: 'pnpm 9+', ok: pnpm.ok && major(pnpm.output) >= 9, detail: pnpm.output });
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  checks.push({ name: 'Docker daemon', ok: docker.ok, detail: docker.ok ? docker.output : 'not available; start Docker/OrbStack' });
  checks.push({ name: '.env', ok: existsSync('.env'), detail: existsSync('.env') ? 'present' : 'missing; copy .env.example to .env' });

  if (requireFreeAppPorts) {
    for (const port of [3000, 5173, 5174]) {
      const open = await portOpen(port);
      checks.push({ name: `Port ${port}`, ok: !open, detail: open ? 'already in use; stop the conflicting application' : 'available' });
    }
  }
  return checks;
}

export function printChecks(checks) {
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
}

if (process.argv[1]?.endsWith('environment.mjs')) {
  const action = process.argv[2] ?? 'preflight';
  if (action === 'preflight') {
    const checks = await preflight({ requireFreeAppPorts: process.argv.includes('--require-free-app-ports') });
    printChecks(checks);
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  } else if (action === 'ready') {
    const names = process.argv.slice(3);
    const selected = names.length > 0 ? names : Object.keys(ENDPOINTS);
    try {
      printChecks(await waitForServices(selected));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    console.error('Usage: node scripts/environment.mjs preflight [--require-free-app-ports] | ready [api admin portal keycloak]');
    process.exitCode = 2;
  }
}
