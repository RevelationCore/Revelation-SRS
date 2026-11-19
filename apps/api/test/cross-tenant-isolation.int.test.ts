import { sql } from 'drizzle-orm';
import { ROLES } from '@revelation-srs/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetScenario } from '../../../packages/demo-data/src/reset.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Cross-tenant isolation (enterprise readiness plan, item 1.4).
 *
 * The "A" tenants hold realistic data: one demo scenario each, so between
 * them much of the schema has rows. Tenant B, holding every role (and even
 * claiming one of A's people as its own), calls every GET route in the
 * OpenAPI document with A's ids in the path. No response to B may contain
 * the id of any row an A tenant owns, other than an id B itself put in the
 * URL (a 404 may echo that).
 *
 * Path parameters are filled from the table the parameter names (personId
 * from person, caseId from the *_case tables under that path segment, and so
 * on), then from every A table. As a control, the owning A tenant makes the
 * same calls first: B is tried on the URLs where A really got its own rows
 * back, and the test asserts that enough routes did, so a leak would have
 * had something to leak.
 */

const SCENARIOS = [
  'ci-golden', 'curriculum-baseline', 'applicant-pipeline', 'enrolment-induction',
  'module-selection', 'exam-board', 'pgr-lifecycle',
] as const;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** URLs tried per route while looking for ones A is served data on. */
const SEARCH_PER_ROUTE = 25;
/** URLs per route that B tries: those A was served data on, else the first guesses. */
const B_URLS_PER_ROUTE = 4;

let ctx: TestApp;
let tokenB: string;
const tenantsA: string[] = [];
const tokenFor = new Map<string, string>();
/** Owning A tenant of every id of every row the A tenants own. */
const ownerOf = new Map<string, string>();
/** Up to three ids per table (any A tenant). */
const idsByTable = new Map<string, string[]>();

const snake = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const singular = (s: string): string => s.replace(/ies$/, 'y').replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');

/**
 * Candidate ids for one path parameter, best guesses first: the table the
 * parameter names, then tables under that path segment, then tables ending
 * in the name, then one id from every A table.
 */
function candidates(param: string, previousSegment: string | undefined): string[] {
  if (param === 'tenantId') return [tenantsA[0]!];
  if (!/Id$/.test(param)) return ['A-CODE'];
  const base = snake(param.replace(/Id$/, ''));
  const segment = previousSegment ? singular(snake(previousSegment).replace(/-/g, '_')) : '';
  const tables = [...idsByTable.keys()];
  const tiers = [
    tables.filter((t) => t === base),
    tables.filter((t) => segment !== '' && (t === segment || t.endsWith(`_${segment}`))),
    tables.filter((t) => t.endsWith(`_${base}`) || t.startsWith(`${base}_`)),
  ];
  const ordered = tiers.flatMap((tier) => tier.flatMap((t) => idsByTable.get(t) ?? []));
  const everyTable = tables.map((t) => idsByTable.get(t)![0]!);
  return [...new Set([...ordered, ...everyTable])];
}

/** Concrete URLs for one route path, best guesses first. */
function urlsFor(path: string): string[] {
  const parts = path.split('/');
  let urls = [''];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const param = /^\{(\w+)\}$/.exec(part)?.[1];
    const values = param ? candidates(param, parts[i - 1]) : [part];
    // Breadth for the last parameter, a few guesses for earlier ones.
    urls = urls.flatMap((u, n) => (n < 3 ? values : values.slice(0, 1)).map((v) => `${u}/${v}`)).slice(0, SEARCH_PER_ROUTE);
  }
  return urls;
}

/** A's ids in a response, other than ones the caller put in the URL. */
function idsOfA(body: string, url: string): string[] {
  return [...new Set(body.match(UUID) ?? [])].filter((id) => ownerOf.has(id) && !url.includes(id));
}

/** The A tenants that should be asked: the owner of the first A id in the URL, else all. */
function askersFor(url: string): string[] {
  const owner = (url.match(UUID) ?? []).map((id) => ownerOf.get(id)).find(Boolean);
  return owner ? [owner] : tenantsA;
}

beforeAll(async () => {
  ctx = await startTestApp();

  await ctx.db.execute(sql`UPDATE deployment_environment SET active = false WHERE production_like = true`);
  process.env['DEMO_DATA_ENABLED']  = 'true';
  process.env['DEMO_RESET_ALLOWED'] = 'true';
  for (const [i, slug] of SCENARIOS.entries()) {
    const tenantId = `dd000000-0000-4000-8000-0000000000a${i}`;
    await ctx.db.execute(sql`
      INSERT INTO tenant (id, code, name, active, demo_mode)
      VALUES (${tenantId}, ${`ISO-${i}`}, ${`Isolation ${slug}`}, true, true)
    `);
    await resetScenario({ databaseUrl: ctx.container.getConnectionUri(), tenantId, scenarioSlug: slug });
    tenantsA.push(tenantId);
  }

  // Every id the A tenants own, from every table with a tenant_id and a uuid id.
  const tables = await ctx.db.execute<{ schema: string; table: string }>(sql`
    SELECT c.table_schema AS schema, c.table_name AS table
    FROM information_schema.columns c
    JOIN information_schema.columns t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.column_name = 'tenant_id'
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.column_name = 'id' AND c.data_type = 'uuid' AND c.table_schema IN ('public', 'documents')
  `);
  const inA = tenantsA.map((t) => `'${t}'`).join(', ');
  for (const { schema, table } of tables) {
    const rows = await ctx.db.execute<{ id: string; tenant_id: string }>(sql.raw(
      `SELECT id::text, tenant_id::text FROM "${schema}"."${table}" WHERE tenant_id IN (${inA}) ORDER BY id`,
    ));
    if (!rows.length) continue;
    for (const r of rows) ownerOf.set(r.id, r.tenant_id);
    idsByTable.set(table, rows.slice(0, 3).map((r) => r.id));
  }

  const allRoles = [...ROLES];
  for (const t of tenantsA) tokenFor.set(t, await ctx.makeJwt({ tenantId: t, roles: allRoles }));
  // B holds every role and even claims one of A's people: still nothing of A's.
  const personOfA = idsByTable.get('person')![0]!;
  tokenB = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: allRoles, srsPersonId: personOfA });
}, 300_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('cross-tenant isolation', () => {
  it('the A tenants hold a realistic data set to leak', () => {
    expect(idsByTable.size).toBeGreaterThan(40);
    expect(ownerOf.size).toBeGreaterThan(1000);
  });

  it('no GET route returns any of the A tenants\' rows to tenant B', async () => {
    const spec = ctx.app.swagger() as { paths: Record<string, { get?: unknown }> };
    // Server-sent event streams never end; they push only to the connection's
    // own tenant and person (NotificationService.pushToConnections).
    const paths = Object.entries(spec.paths).filter(([p, ops]) => ops.get && !p.endsWith('/stream')).map(([p]) => p);
    expect(paths.length).toBeGreaterThan(200);

    const leaks: string[] = [];
    const servedToA = new Set<string>();
    let calls = 0;
    // The rate limiter keys on the client address here; spread the calls.
    const get = async (url: string, token: string) => {
      calls++;
      return ctx.app.inject({
        method: 'GET', url, headers: { authorization: `Bearer ${token}` },
        remoteAddress: `10.${Math.floor(calls / 62_500) % 250}.${Math.floor(calls / 250) % 250}.${calls % 250}`,
      });
    };

    for (const path of paths) {
      const started = Date.now();
      const callsBefore = calls;
      const urls = urlsFor(path);
      // Find URLs on which an A tenant really gets its own rows back.
      const served: string[] = [];
      for (const url of urls) {
        for (const tenant of askersFor(url)) {
          const asA = await get(url, tokenFor.get(tenant)!);
          if (asA.statusCode === 200 && idsOfA(asA.body, url).length) { served.push(url); break; }
        }
        if (served.length >= B_URLS_PER_ROUTE) break;
      }
      if (served.length) servedToA.add(path);

      for (const url of [...new Set([...served, ...urls.slice(0, B_URLS_PER_ROUTE)])]) {
        const asB = await get(url, tokenB);
        expect(asB.statusCode, `${url} was rate-limited`).not.toBe(429);
        const leaked = idsOfA(asB.body, url);
        if (leaked.length) leaks.push(`${path} → ${url} (${asB.statusCode}): ${leaked.slice(0, 3).join(', ')}`);
      }
      if (process.env['ISO_DEBUG']) console.warn(`ISO ${Date.now() - started}ms ${calls - callsBefore} calls ${served.length} served ${path}`);
    }

    console.warn(`cross-tenant isolation: ${idsByTable.size} A tables with rows, ${ownerOf.size} A ids; ${paths.length} GET routes, ${calls} calls, ${servedToA.size} routes served A's rows to A`);
    expect(leaks).toEqual([]);
    // The control: enough routes serve A's rows to A that B's calls tested something.
    // 60 of 239 routes did on 2026-11-19; the floor sits just under that, so it only ratchets up.
    expect(servedToA.size).toBeGreaterThanOrEqual(55);
  }, 900_000);
});
