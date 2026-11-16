/**
 * Changing one student's curriculum binding (BP-03-002; D-11).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let approverJwt: string;
let programmeId: string;
let defaultRuleSetId: string;
let pathwayRuleSetId: string;

const call = (method: 'GET' | 'POST', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

interface Change { curriculumBindingChangeId: string; statusCode: string }

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'binding-registry', roles: ['registry-administrator'] });
  approverJwt = await ctx.makeJwt({ sub: 'binding-approver', roles: ['programme-approver'] });
  programmeId = (await call('POST', '/programmes', registryJwt, { code: 'BIND-BSC', title: 'BSc Binding', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
  defaultRuleSetId = (await call('POST', '/programme-rule-sets', registryJwt, { programmeId, ruleSetCode: 'DEFAULT' })).json<{ programmeRuleSetId: string }>().programmeRuleSetId;
  pathwayRuleSetId = (await call('POST', '/programme-rule-sets', registryJwt, { programmeId, ruleSetCode: 'DATA-PATHWAY' })).json<{ programmeRuleSetId: string }>().programmeRuleSetId;
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function student(name: string): Promise<string> {
  const personId = (await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Binding' })).json<{ personId: string }>().personId;
  return (await call('POST', '/enrolments', registryJwt, { personId, programmeId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2030-31', startDate: '2030-09-23' }))
    .json<{ enrolmentId: string }>().enrolmentId;
}

const binding = async (enrolmentId: string) => (await call('GET', `/enrolment-curriculum-bindings/${enrolmentId}`, registryJwt)).json<{ programmeRuleSetId: string; changeReasonCode?: string }>();
const propose = (enrolmentId: string, body: Record<string, unknown> = {}) => call('POST', `/enrolment-curriculum-bindings/${enrolmentId}`, registryJwt, {
  programmeRuleSetId: pathwayRuleSetId, changeReasonCode: 'pathway-change', reason: 'Moved to the data pathway', effectiveDate: '2030-10-01', ...body,
});

describe('changing one student\'s curriculum binding', () => {
  it('is applied at once by the registry when nothing depends on it yet', async () => {
    const enrolmentId = await student('Free');
    const res = await propose(enrolmentId);
    expect(res.statusCode).toBe(201);
    expect(res.json<{ applied: boolean; change: Change }>()).toMatchObject({ applied: true, change: { statusCode: 'applied-directly' } });
    expect((await binding(enrolmentId)).programmeRuleSetId).toBe(pathwayRuleSetId);
  });

  it('needs a programme approver once a module registration depends on it', async () => {
    const enrolmentId = await student('Held');
    // Bind to the default rule set first, then register on a module running past the effective date.
    expect((await propose(enrolmentId, { programmeRuleSetId: defaultRuleSetId, changeReasonCode: 'rule-set-correction' })).json<{ applied: boolean }>().applied).toBe(true);
    const moduleId = (await call('POST', '/modules', registryJwt, { code: 'BIND101', title: 'Binding Module', creditValue: 20 })).json<{ moduleId: string }>().moduleId;
    const academicPeriodId = (await call('POST', '/academic-periods', registryJwt, {
      academicYear: '2030-31', periodCode: 'BIND-SEM1', periodTypeCode: 'semester', startDate: '2030-09-23', endDate: '2031-01-17',
    })).json<{ academicPeriodId: string }>().academicPeriodId;
    const moduleOfferingId = (await call('POST', '/module-offerings', registryJwt, { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 50 })).json<{ moduleOfferingId: string }>().moduleOfferingId;
    expect((await call('POST', '/module-registrations', registryJwt, { enrolmentId, moduleOfferingId, registrationDate: '2030-09-25' })).statusCode).toBe(201);

    const proposed = await propose(enrolmentId);
    const { applied, change } = proposed.json<{ applied: boolean; change: Change }>();
    expect(applied).toBe(false);
    expect(change.statusCode).toBe('proposed');
    expect((await binding(enrolmentId)).programmeRuleSetId).toBe(defaultRuleSetId);
    expect((await propose(enrolmentId)).statusCode).toBe(409);

    const pending = (await call('GET', '/curriculum-binding-changes?pending=true', approverJwt)).json<Change[]>();
    expect(pending.map((c) => c.curriculumBindingChangeId)).toContain(change.curriculumBindingChangeId);
    // The registry cannot decide it; a programme approver does.
    expect((await call('POST', `/curriculum-binding-changes/${change.curriculumBindingChangeId}/decision`, registryJwt, { decisionCode: 'approved', reason: 'x' })).statusCode).toBe(403);
    const decided = await call('POST', `/curriculum-binding-changes/${change.curriculumBindingChangeId}/decision`, approverJwt, { decisionCode: 'approved', reason: 'Pathway confirmed by programme lead' });
    expect(decided.json<Change>().statusCode).toBe('approved');
    expect(await binding(enrolmentId)).toMatchObject({ programmeRuleSetId: pathwayRuleSetId, changeReasonCode: 'pathway-change' });
  });

  it('a rule set from another programme needs a transfer, and the reason must be a known code', async () => {
    const enrolmentId = await student('Other');
    const otherProgramme = (await call('POST', '/programmes', registryJwt, { code: 'BIND-OTHER', title: 'Other', fheqLevel: 6, creditTotal: 360 })).json<{ programmeId: string }>().programmeId;
    const otherRuleSet = (await call('POST', '/programme-rule-sets', registryJwt, { programmeId: otherProgramme, ruleSetCode: 'DEFAULT' })).json<{ programmeRuleSetId: string }>().programmeRuleSetId;
    const foreign = await propose(enrolmentId, { programmeRuleSetId: otherRuleSet });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json<{ detail: string }>().detail).toMatch(/transfer status case/);
    expect((await propose(enrolmentId, { changeReasonCode: 'because' })).statusCode).toBe(422);
  });
});
