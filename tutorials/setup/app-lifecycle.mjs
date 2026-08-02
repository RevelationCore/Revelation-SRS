// Shared helpers for starting/checking/stopping the API + portal dev
// servers needed to record the tutorial. Used both by the standalone
// `tutorial:record`-style CLI entry point (ensure-app-running.mjs) and by
// the `tutorial:all` orchestrator (../scripts/run-all.mjs), which needs to
// track exactly which processes *it* started so it can clean up only
// those, and not kill a dev server the developer was already running.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const APPS = {
  api: { name: 'api', filter: '@revelation-srs/api', url: 'http://localhost:3000/health' },
  portal: { name: 'portal', filter: '@revelation-srs/portal', url: 'http://localhost:5174/login' },
};

export async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function waitForReachable(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Starts a dev server as a detached background process if it isn't already
 * reachable. Returns { alreadyRunning, child } — `child` is null when the
 * server was already up, so callers know not to stop it later.
 */
export async function ensureStarted(app) {
  if (await isReachable(app.url)) {
    console.log(`[${app.name}] already running (${app.url})`);
    return { alreadyRunning: true, child: null };
  }

  console.log(`[${app.name}] starting (pnpm --filter ${app.filter} dev)...`);
  const child = spawn('pnpm', ['--filter', app.filter, 'dev'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  const ready = await waitForReachable(app.url, 90_000);
  if (!ready) {
    throw new Error(`[${app.name}] did not become reachable at ${app.url} within 90s`);
  }
  console.log(`[${app.name}] ready (${app.url})`);
  return { alreadyRunning: false, child };
}

export function stopStarted(handle, app) {
  if (!handle.child) return;
  console.log(`[${app.name}] stopping (pid ${handle.child.pid})`);
  try {
    process.kill(-handle.child.pid, 'SIGTERM');
  } catch {
    try {
      handle.child.kill('SIGTERM');
    } catch {
      // process already gone
    }
  }
}
