import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { fetchWithTimeout } from '@revelation-srs/auth';
import { createDb } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-011 (readiness 2.3, P-09): every outbound call and every request-serving
 * database pool is time-bounded.
 */

let ctx: TestApp;
let slow: Server;
let slowUrl: string;

beforeAll(async () => {
  ctx = await startTestApp();
  slow = createServer((_req, res) => { setTimeout(() => res.end('late'), 2_000); });
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
  slowUrl = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/`;
}, 120_000);

afterAll(async () => {
  slow?.closeAllConnections();
  slow?.close();
  await ctx?.teardown();
});

describe('fetchWithTimeout', () => {
  it('gives up on a slow dependency with a TimeoutError', async () => {
    const started = Date.now();
    await expect(fetchWithTimeout(slowUrl, {}, 200)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('still honours a signal the caller passes', async () => {
    const caller = new AbortController();
    const call = fetchWithTimeout(slowUrl, { signal: caller.signal }, 5_000);
    caller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('API database pool', () => {
  it('sets statement and idle-in-transaction timeouts on its connections', async () => {
    const [row] = await ctx.app.db.execute(sql`
      SELECT current_setting('statement_timeout') AS statement,
             current_setting('idle_in_transaction_session_timeout') AS idle`) as unknown as Array<{ statement: string; idle: string }>;
    expect(row).toEqual({ statement: '30s', idle: '1min' });
  });

  it('cancels a statement that runs past the limit', async () => {
    const db = createDb(ctx.container.getConnectionUri(), { statementTimeoutMs: 200 });
    await expect(db.execute(sql`SELECT pg_sleep(2)`)).rejects.toMatchObject({ cause: { code: '57014' } });
  });
});
