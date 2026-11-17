/**
 * Curriculum publications beyond programmes and modules (Phase 3 D-22; BP-03-001):
 * routes, rule sets with their groups and members, learning outcomes and offerings,
 * in one atomic unit, with protection for what students are bound to.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let connectorJwt: string;
let registryJwt: string;
let bindingApproverJwt: string;
let adminJwt: string;

interface Publication {
  publicationId: string; statusCode: string; affectsStudents: number;
  counts: { added: number; changed: number; closed: number; unchanged: number; rejected: number };
  items: Array<{ objectTypeCode: string; objectCode: string; changeTypeCode: string; issue: string | null; affectsStudents: number }>;
}

beforeAll(async () => {
  ctx = await startTestApp();
  connectorJwt = await ctx.makeJwt({ sub: 'cm-connector', roles: ['integration-service'] });
  registryJwt = await ctx.makeJwt({ sub: 'cps-registry', roles: ['registry-administrator'] });
  bindingApproverJwt = await ctx.makeJwt({ sub: 'cps-approver', roles: ['registry-administrator', 'programme-approver'] });
  adminJwt = await ctx.makeJwt({ sub: 'cps-admin', roles: ['tenant-administrator'] });
  await ctx.db.execute(sql`INSERT INTO academic_period (tenant_id, academic_year, period_code, period_type_code, start_date, end_date)
    VALUES (${ctx.tenantId}, '2032-33', 'SEM1', 'semester', '2032-09-20', '2033-01-20')`);
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });
const publish = (ref: string, body: Record<string, unknown>, effectiveFrom = '2032-08-01') =>
  call('POST', '/curriculum-publications', connectorJwt, { sourceSystemCode: 'cm', publicationVersion: '1', effectiveFrom, sourcePublicationRef: ref, ...body });
const apply = (id: string, jwt = registryJwt) => call('POST', `/curriculum-publications/${id}/application`, jwt);
const count = async (q: ReturnType<typeof sql>) => ((await ctx.db.execute(q)) as unknown as Array<{ n: number }>)[0]!.n;

describe('curriculum structure in publications (D-22)', () => {
  it('publishes a programme with its route, rule set, groups, members, outcomes and an offering, applied in dependency order', async () => {
    const received = await publish('STRUCT-1', {
      programmes: [{ code: 'ST-BSC', title: 'BSc Structure', fheqLevel: 6, creditTotal: 360 }],
      modules: [{ code: 'ST101', title: 'Core', creditValue: 20, fheqLevel: 4 }, { code: 'ST102', title: 'Option', creditValue: 20, fheqLevel: 4 }],
      routes: [{ programmeCode: 'ST-BSC', routeCode: 'SANDWICH', title: 'With placement year' }],
      ruleSets: [{
        programmeCode: 'ST-BSC', ruleSetCode: 'ST-2032', routeCode: 'SANDWICH', entryAcademicYear: '2032-33', description: '2032 entry',
        groups: [
          { groupCode: 'CORE', title: 'Core', groupTypeCode: 'compulsory', fheqLevel: 4, members: [{ moduleCode: 'ST101', isNonCondonable: true }] },
          { groupCode: 'OPT', title: 'Options', groupTypeCode: 'optional-pool', minModules: 1, members: [{ moduleCode: 'ST102' }] },
        ],
      }],
      learningOutcomes: [{ ownerType: 'module', ownerCode: 'ST101', outcomeCode: 'LO1', description: 'Explain structure' }],
      offerings: [{ moduleCode: 'ST101', academicYear: '2032-33', periodCode: 'SEM1', capacity: 120 }],
    });
    expect(received.statusCode, received.body).toBe(201);
    const pub = received.json<Publication>();
    expect(pub).toMatchObject({ statusCode: 'validated', counts: { added: 11, rejected: 0 }, affectsStudents: 0 });
    expect(pub.items.map((i) => i.objectTypeCode)).toEqual(expect.arrayContaining(['route', 'rule-set', 'module-group', 'module-group-member', 'learning-outcome', 'module-offering']));

    expect((await apply(pub.publicationId)).json<Publication>().statusCode).toBe('applied');
    expect(await count(sql`SELECT count(*)::int AS n FROM programme_rule_set rs JOIN programme_route r ON r.id = rs.programme_route_id
      WHERE rs.rule_set_code = 'ST-2032' AND r.route_code = 'SANDWICH' AND rs.entry_academic_year = '2032-33' AND rs.recorded_until IS NULL`)).toBe(1);
    expect(await count(sql`SELECT count(*)::int AS n FROM module_group_member gm JOIN module_group g ON g.id = gm.module_group_id
      WHERE g.group_code = 'CORE' AND gm.is_non_condonable AND gm.recorded_until IS NULL`)).toBe(1);
    expect(await count(sql`SELECT count(*)::int AS n FROM learning_outcome WHERE outcome_code = 'LO1' AND recorded_until IS NULL`)).toBe(1);
    expect(await count(sql`SELECT count(*)::int AS n FROM module_offering o JOIN module m ON m.id = o.module_id AND m.recorded_until IS NULL WHERE m.code = 'ST101' AND o.capacity = 120`)).toBe(1);
  });

  it('refuses references that resolve neither to the publication nor the catalogue, and references to what it closes', async () => {
    const pub = (await publish('STRUCT-2', {
      routes: [{ programmeCode: 'NOPE', routeCode: 'X', title: 'Orphan' }],
      ruleSets: [{ programmeCode: 'ST-BSC', ruleSetCode: 'ST-BAD', groups: [{ groupCode: 'G', title: 'G', groupTypeCode: 'compulsory', members: [{ moduleCode: 'NOPE101' }] }] }],
      offerings: [{ moduleCode: 'ST102', academicYear: '2099-00', periodCode: 'SEM9' }],
    })).json<Publication>();
    expect(pub.statusCode).toBe('rejected');
    const issues = Object.fromEntries(pub.items.map((i) => [i.objectCode, i.issue]));
    expect(issues['NOPE/X']).toMatch(/programme NOPE/);
    expect(issues['ST-BSC/ST-BAD/G/NOPE101']).toMatch(/module NOPE101/);
    expect(issues['ST102@2099-00/SEM9']).toMatch(/not in the calendar/);

    const closing = (await publish('STRUCT-3', {
      modules: [{ code: 'ST102', closed: true }],
      learningOutcomes: [{ ownerType: 'module', ownerCode: 'ST102', outcomeCode: 'LO9', description: 'x' }],
    }, '2032-09-01')).json<Publication>();
    expect(closing.items.find((i) => i.objectTypeCode === 'learning-outcome')?.issue).toMatch(/which this publication closes/);
  });

  it('protects what students are bound to: no closing, and a change needs a rationale and a binding approver', async () => {
    const [ruleSet] = (await ctx.db.execute(sql`SELECT id FROM programme_rule_set WHERE rule_set_code = 'ST-2032' AND recorded_until IS NULL`)) as unknown as Array<{ id: string }>;
    const personId = (await call('POST', '/students', registryJwt, { legalFirstName: 'Bound', legalFamilyName: 'Student' })).json<{ personId: string }>().personId;
    const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2032-33', startDate: '2032-09-20' })).json<{ enrolmentId: string }>().enrolmentId;
    await ctx.db.execute(sql`INSERT INTO enrolment_curriculum_binding (version_id, id, tenant_id, enrolment_id, programme_rule_set_id, decision_authority_code, valid_from)
      VALUES (${randomUUID()}, ${randomUUID()}, ${ctx.tenantId}, ${enrolmentId}, ${ruleSet!.id}, 'automatic', now())`);

    const close = (await publish('STRUCT-4', { ruleSets: [{ programmeCode: 'ST-BSC', ruleSetCode: 'ST-2032', closed: true }] }, '2032-09-01')).json<Publication>();
    expect(close.items[0]!.issue).toMatch(/1 student\(s\) are bound .* cannot be closed/);

    const addOption = { ruleSets: [{ programmeCode: 'ST-BSC', ruleSetCode: 'ST-2032', groups: [{ groupCode: 'OPT', members: [{ moduleCode: 'ST101' }] }] }] };
    const noRationale = (await publish('STRUCT-5', addOption, '2032-09-01')).json<Publication>();
    expect(noRationale.statusCode).toBe('rejected');
    expect(noRationale.items.find((i) => i.objectTypeCode === 'module-group-member')?.issue).toMatch(/needs a correction rationale/);

    const withRationale = (await publish('STRUCT-6', { ...addOption, correctionRationale: 'Option omitted from the approved 2032 diet' }, '2032-09-01')).json<Publication>();
    expect(withRationale).toMatchObject({ statusCode: 'validated', affectsStudents: 1 });
    expect((await apply(withRationale.publicationId, registryJwt)).statusCode).toBe(403);
    expect((await apply(withRationale.publicationId, bindingApproverJwt)).json<Publication>().statusCode).toBe('applied');
  });

  it('a type mastered by the curriculum system cannot be written directly in the SRS', async () => {
    expect((await call('POST', '/programmes', registryJwt, { code: 'DIRECT-1', title: 'Direct', fheqLevel: 6, creditTotal: 360 })).statusCode).toBe(201);
    await call('PATCH', '/tenant/configuration', adminJwt, { curriculum: { masteredBy: { programme: 'curriculum-system' } } });
    const refused = await call('POST', '/programmes', registryJwt, { code: 'DIRECT-2', title: 'Direct', fheqLevel: 6, creditTotal: 360 });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/mastered by the curriculum system/);
    expect((await call('POST', '/modules', registryJwt, { code: 'DIRECT101', title: 'Still SRS', creditValue: 20, fheqLevel: 4 })).statusCode).toBe(201);
    await call('PATCH', '/tenant/configuration', adminJwt, { curriculum: { masteredBy: {} } });
  });
});
