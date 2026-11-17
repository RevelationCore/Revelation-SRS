import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Reduced-intensity study (Phase 4 D-31) and transfer credit mapping (D-32). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let proposer: string;
let decider: string;

beforeAll(async () => {
  ctx = await startTestApp();
  proposer = await ctx.makeJwt({ sub: 'sc-proposer', roles: ['registry-administrator'] });
  decider = await ctx.makeJwt({ sub: 'sc-decider', roles: ['programme-approver', 'registry-administrator'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

interface Case { statusCaseId: string; transferKinds: string[]; warnings: string[]; creditMappings: Array<{ statusCode: string }> }

const openTransfer = async (enrolmentId: string, body: Record<string, unknown>) => {
  const res = await f.inject('POST', `/api/v1/enrolments/${enrolmentId}/status-cases`, {
    caseTypeCode: 'transfer', initiatedByCode: 'student', requestedEffectiveDate: '2026-12-01', ...body,
  }, proposer);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Case>();
};
const decide = (id: string) => f.inject('POST', `/api/v1/status-cases/${id}/decision`, { decisionCode: 'approved', reason: 'Agreed', effectiveDate: '2026-12-01' }, decider);

describe('Reduced-intensity study as a transfer', () => {
  it('refuses while later registrations exceed the pro-rated maximum, then applies mode and intensity', async () => {
    const programmeId = await f.programme();
    await f.rule(programmeId, 'credit-load-requirement', 'part-time', { minCredits: null, maxCredits: 120, scaleByIntensity: true });
    const spring = await f.period({ startDate: '2027-01-25', endDate: '2027-05-28' });
    const { enrolmentId } = await f.student(programmeId);
    const regs: string[] = [];
    for (let n = 0; n < 4; n += 1) {
      const m = await f.module(20);
      const res = await f.inject('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId: await f.offering(m.moduleId, spring), registrationDate: '2026-10-01' });
      regs.push(res.json<{ moduleRegistrationId: string }>().moduleRegistrationId);
    }

    const c = await openTransfer(enrolmentId, { destinationModeOfStudyCode: 'part-time', destinationStudyIntensityPercent: 50 });
    expect(c.transferKinds).toEqual(['mode', 'intensity']);
    const refused = await decide(c.statusCaseId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/most this student may take in 2026-27 is 60 credits, but 80 are registered/);

    expect((await f.inject('POST', `/api/v1/module-registrations/${regs[0]}/withdrawal`, {})).statusCode).toBeLessThan(300);
    expect((await decide(c.statusCaseId)).statusCode).toBe(200);
    const e = (await f.inject('GET', `/api/v1/enrolments/${enrolmentId}`)).json<{ modeOfStudyCode: string; studyIntensityPercent: number }>();
    expect(e).toMatchObject({ modeOfStudyCode: 'part-time', studyIntensityPercent: 50 });
  });

  it('warns below the SLC 25% floor and tells the SLC of the change', async () => {
    const programmeId = await f.programme();
    const personId = (await f.inject('POST', '/api/v1/students', { legalFirstName: 'Sal', legalFamilyName: 'Loan' })).json<{ personId: string }>().personId;
    const enrolmentId = (await f.inject('POST', '/api/v1/enrolments', {
      personId, programmeId, modeOfStudyCode: 'part-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21', slcReference: 'SLC1234567',
    })).json<{ enrolmentId: string }>().enrolmentId;
    const c = await openTransfer(enrolmentId, { destinationStudyIntensityPercent: 20 });
    expect(c.warnings.join(' ')).toMatch(/25% minimum/);
    expect((await decide(c.statusCaseId)).statusCode).toBe(200);
    const triggers = (await f.inject('GET', `/api/v1/enrolments/${enrolmentId}/downstream-triggers`)).json<Array<{ triggerTypeCode: string; payloadSummary: Record<string, unknown> }>>();
    expect(triggers).toContainEqual(expect.objectContaining({
      triggerTypeCode: 'slc-confirmation', payloadSummary: expect.objectContaining({ notificationType: 'change-of-mode-or-intensity', toStudyIntensityPercent: 20 }),
    }));
  });
});

describe('Transfer credit mapping', () => {
  it('a transfer is decided only once its credit mappings are, and mapped credit satisfies the destination diet', async () => {
    const programmeId = await f.programme();
    const destination = await f.programme();
    const destRuleSet = await f.ruleSet(destination);
    const core = await f.module(20);
    const group = await f.group(destRuleSet, { groupTypeCode: 'compulsory', minModules: 1, title: 'Destination core' });
    await f.member(group, core.moduleId, { isDefault: true });
    const { enrolmentId } = await f.student(programmeId);

    const c = await openTransfer(enrolmentId, { destinationProgrammeId: destination });
    await f.inject('POST', `/api/v1/status-cases/${c.statusCaseId}/assessments`, { assessorRoleCode: 'destination-academic', outcomeCode: 'supports' }, decider);
    const credit = await f.inject('POST', `/api/v1/enrolments/${enrolmentId}/recognised-credits`, {
      recognitionTypeCode: 'internal-transfer', moduleId: core.moduleId, statusCaseId: c.statusCaseId, sourceDescription: 'Passed equivalent core module', creditValue: 20, academicYear: '2026-27',
    }, proposer);
    expect(credit.statusCode, credit.body).toBe(201);
    expect((await decide(c.statusCaseId)).statusCode).toBe(409);
    const creditId = credit.json<{ recognisedCreditId: string }>().recognisedCreditId;
    expect((await f.inject('POST', `/api/v1/recognised-credits/${creditId}/decision`, { decisionCode: 'approved', reason: 'Equivalent' }, decider)).statusCode).toBe(200);
    const caseNow = (await f.inject('GET', `/api/v1/status-cases/${c.statusCaseId}`, undefined, decider)).json<Case>();
    expect(caseNow.creditMappings).toEqual([expect.objectContaining({ statusCode: 'approved' })]);
    expect((await decide(c.statusCaseId)).statusCode).toBe(200);

    // The mapped core module is taken: a proposal on the destination programme is not given it.
    const periodId = await f.period();
    await f.offering(core.moduleId, periodId);
    const proposalId = await f.proposal(enrolmentId, periodId);
    expect((await f.getProposal(proposalId)).items).toHaveLength(0);
  });

  it('prior or external learning needs evidence; internal-transfer credit needs an open transfer', async () => {
    const programmeId = await f.programme();
    const { enrolmentId } = await f.student(programmeId);
    const propose = (body: Record<string, unknown>) => f.inject('POST', `/api/v1/enrolments/${enrolmentId}/recognised-credits`, { sourceDescription: 'Prior study', creditValue: 20, ...body }, proposer);
    expect((await propose({ recognitionTypeCode: 'rpcl' })).statusCode).toBe(422);
    expect((await propose({ recognitionTypeCode: 'rpcl', evidenceRef: 'document:abc' })).statusCode).toBe(201);
    expect((await propose({ recognitionTypeCode: 'internal-transfer' })).statusCode).toBe(422);
  });
});
