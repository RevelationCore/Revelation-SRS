import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let adminJwt: string;
let approverJwt: string;
let academicPeriodId: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  approverJwt = await ctx.makeJwt({ roles: ['programme-approver'] });

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2026-27',
      periodCode: 'MSP-SEM1',
      periodTypeCode: 'semester',
      startDate: '2026-09-21',
      endDate: '2027-01-15',
    },
  });
  academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('Module selection proposals', () => {
  it('auto-confirms a fully valid proposal and creates module registrations', async () => {
    const programmeId = await createProgramme('MSP-P1');
    const ruleSetId = await createRuleSet(programmeId, 'default');
    const moduleId = await createModule('MSP101', 'Confirmable Module', 20);
    const offeringId = await createOffering(moduleId, 20);
    const personId = await createStudent('Ada', 'Proposer');
    const enrolmentId = await createEnrolment(personId, programmeId);

    const proposalId = await createProposal(enrolmentId, 4);
    await addItem(proposalId, moduleId, offeringId);

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/submission`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json<{ statusCode: string }>().statusCode).toBe('confirmed');

    const registrations = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations?enrolmentId=${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(registrations.json<Array<{ moduleId: string; statusCode: string }>>())
      .toContainEqual(expect.objectContaining({ moduleId, statusCode: 'registered' }));

    void ruleSetId;
  });

  it('returns a proposal that violates a compulsory diet group', async () => {
    const programmeId = await createProgramme('MSP-P2');
    const ruleSetId = await createRuleSet(programmeId, 'default');
    const compulsoryModuleId = await createModule('MSP201', 'Compulsory Module', 20);
    await createOffering(compulsoryModuleId, 20);
    const optionalModuleId = await createModule('MSP202', 'Optional Module', 20);
    const optionalOfferingId = await createOffering(optionalModuleId, 20);

    const groupId = await createModuleGroup(ruleSetId, {
      groupCode: 'CORE', title: 'Core modules', groupTypeCode: 'compulsory', minModules: 1,
    });
    await addGroupMember(groupId, compulsoryModuleId, true);

    const personId = await createStudent('Ben', 'Compulsory');
    const enrolmentId = await createEnrolment(personId, programmeId);

    const proposalId = await createProposal(enrolmentId, 4);
    // Remove the auto-populated compulsory item to force a violation, and pick only the optional module.
    const proposal = await getProposal(proposalId);
    for (const item of proposal.items) {
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/module-selection-proposals/${proposalId}/items/${item.proposalItemId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
    }
    await addItem(proposalId, optionalModuleId, optionalOfferingId);

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/submission`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(submit.statusCode).toBe(200);
    const result = submit.json<{ statusCode: string; decisionReason: string | null }>();
    expect(result.statusCode).toBe('returned');
    expect(result.decisionReason).toContain('Core modules');
  });

  it('enforces a configured credit-load-requirement', async () => {
    const programmeId = await createProgramme('MSP-P3');
    await createRuleSet(programmeId, 'default');
    const moduleId = await createModuleWithCredits('MSP301', 'Overload Module', 80);
    const offeringId = await createOffering(moduleId, 20);
    const personId = await createStudent('Cara', 'Overload');
    const enrolmentId = await createEnrolment(personId, programmeId);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        ruleTypeCode: 'credit-load-requirement',
        ruleKey: 'full-time',
        ruleValue: { minCredits: null, maxCredits: 60 },
        description: 'Full-time maximum load',
      },
    });

    const proposalId = await createProposal(enrolmentId, 4);
    await addItem(proposalId, moduleId, offeringId);

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/submission`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(submit.statusCode).toBe(200);
    const result = submit.json<{ statusCode: string; decisionReason: string | null }>();
    expect(result.statusCode).toBe('returned');
    expect(result.decisionReason).toContain('exceed the maximum');
  });

  it('waitlists a capacity-constrained proposal and confirms it once an approver approves', async () => {
    const programmeId = await createProgramme('MSP-P4');
    await createRuleSet(programmeId, 'default');
    const moduleId = await createModule('MSP401', 'Oversubscribed Module', 20);
    const offeringId = await createOffering(moduleId, 1);

    // Fill capacity with a direct registration first.
    const fillerPersonId = await createStudent('Filler', 'Student');
    const fillerEnrolmentId = await createEnrolment(fillerPersonId, programmeId);
    const fillerReg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: fillerEnrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' },
    });
    expect(fillerReg.statusCode).toBe(201);

    const personId = await createStudent('Dan', 'Waitlisted');
    const enrolmentId = await createEnrolment(personId, programmeId);
    const proposalId = await createProposal(enrolmentId, 4);
    await addItem(proposalId, moduleId, offeringId);

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/submission`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json<{ statusCode: string }>().statusCode).toBe('waitlisted');

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/decision`,
      headers: { authorization: `Bearer ${approverJwt}` },
      payload: { decisionCode: 'approved', reason: 'Additional capacity authorised' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('rejects a waitlisted proposal when an approver declines it', async () => {
    const programmeId = await createProgramme('MSP-P5');
    await createRuleSet(programmeId, 'default');
    const moduleId = await createModule('MSP501', 'Declined Module', 20);
    const offeringId = await createOffering(moduleId, 1);

    const fillerPersonId = await createStudent('Filler2', 'Student');
    const fillerEnrolmentId = await createEnrolment(fillerPersonId, programmeId);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: fillerEnrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' },
    });

    const personId = await createStudent('Eve', 'Declined');
    const enrolmentId = await createEnrolment(personId, programmeId);
    const proposalId = await createProposal(enrolmentId, 4);
    await addItem(proposalId, moduleId, offeringId);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/submission`,
      headers: { authorization: `Bearer ${jwt}` },
    });

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/decision`,
      headers: { authorization: `Bearer ${approverJwt}` },
      payload: { decisionCode: 'rejected', reason: 'No additional capacity available' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ statusCode: string }>().statusCode).toBe('rejected');

    const registrations = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations?enrolmentId=${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(registrations.json<Array<unknown>>()).toHaveLength(0);
  });

  it('rejects a student decision attempt with 403', async () => {
    const programmeId = await createProgramme('MSP-P6');
    await createRuleSet(programmeId, 'default');
    const moduleId = await createModule('MSP601', 'Any Module', 20);
    const offeringId = await createOffering(moduleId, 20);
    const personId = await createStudent('Fay', 'NoAuthority');
    const enrolmentId = await createEnrolment(personId, programmeId);
    const proposalId = await createProposal(enrolmentId, 4);
    await addItem(proposalId, moduleId, offeringId);

    const studentJwt = await ctx.makeJwt({ roles: ['student'], sub: 'student-msp-1' });
    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-selection-proposals/${proposalId}/decision`,
      headers: { authorization: `Bearer ${studentJwt}` },
      payload: { decisionCode: 'approved', reason: 'attempt' },
    });
    expect(decide.statusCode).toBe(403);
  });
});

async function createProgramme(code: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/programmes',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `Programme ${code}`, fheqLevel: 4, creditTotal: 120 },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ programmeId: string }>().programmeId;
}

async function createRuleSet(programmeId: string, ruleSetCode: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/programme-rule-sets',
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { programmeId, ruleSetCode },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ programmeRuleSetId: string }>().programmeRuleSetId;
}

async function createModuleGroup(
  programmeRuleSetId: string,
  input: { groupCode: string; title: string; groupTypeCode: string; minModules?: number; maxModules?: number },
): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-groups',
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { programmeRuleSetId, ...input },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleGroupId: string }>().moduleGroupId;
}

async function addGroupMember(moduleGroupId: string, moduleId: string, isDefault: boolean): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-groups/${moduleGroupId}/members`,
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: { moduleId, isDefault },
  });
  expect(res.statusCode).toBe(201);
}

async function createStudent(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createEnrolment(personId: string, programmeId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      programmeId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2026-27',
      startDate: '2026-09-21',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function createModule(code: string, title: string, creditValue: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title, creditValue, fheqLevel: 4 },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleId: string }>().moduleId;
}

async function createModuleWithCredits(code: string, title: string, creditValue: number): Promise<string> {
  return createModule(code, title, creditValue);
}

async function createOffering(moduleId: string, capacity: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleOfferingId: string }>().moduleOfferingId;
}

async function createProposal(enrolmentId: string, fheqLevel: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-selection-proposals',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, academicPeriodId, fheqLevel },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleSelectionProposalId: string }>().moduleSelectionProposalId;
}

async function addItem(proposalId: string, moduleId: string, moduleOfferingId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-selection-proposals/${proposalId}/items`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, moduleOfferingId },
  });
  expect(res.statusCode).toBe(201);
}

async function getProposal(proposalId: string): Promise<{ items: Array<{ proposalItemId: string }> }> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/module-selection-proposals/${proposalId}`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}
