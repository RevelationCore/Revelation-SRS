import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

interface CapturedEvent {
  type: string;
  classification: string;
  payload: unknown;
}

function createSpyBus(capture: CapturedEvent[]): IntegrationBusPublisher {
  return {
    isConnected: () => true,
    publish: (
      type: string,
      _version: string,
      _tenantId: string,
      _correlationId: string,
      classification: string,
      payload: unknown,
    ): Promise<void> => {
      capture.push({ type, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  jwt = await ctx.makeJwt();
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Exceptional circumstances and misconduct', () => {
  it('records, lists, and updates exceptional circumstances with sensitive events', async () => {
    const fixture = await createCircumstancesFixture('EC101');

    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        moduleOfferingId: fixture.moduleOfferingId,
        outcomeCode: 'defer',
        determinationDate: '2027-11-10',
        notes: 'Accepted evidence',
      },
    });
    expect(create.statusCode).toBe(201);
    const { exceptionalCircumstancesId: ecId, determinationId } = create.json<{ exceptionalCircumstancesId: string; determinationId: string }>();
    expect(determinationId).toBeTruthy();

    // D-41: the claim is recorded pending; the outcome given with it is only a proposal.
    const outcomeOf = async () => (await ctx.app.inject({
      method: 'GET', url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`, headers: { authorization: `Bearer ${jwt}` },
    })).json<Array<{ exceptionalCircumstancesId: string; moduleOfferingId: string; outcomeCode: string }>>().find((e) => e.exceptionalCircumstancesId === ecId);
    expect(await outcomeOf()).toMatchObject({ moduleOfferingId: fixture.moduleOfferingId, outcomeCode: 'pending' });

    const flagged = capturedEvents.find((event) => event.type === 'srs.circumstances.exceptional-circumstances-flagged');
    expect(flagged).toBeDefined();
    expect(flagged?.classification).toBe('sensitive');
    expect(flagged?.payload).toMatchObject({
      exceptionalCircumstancesId: ecId,
      enrolmentId: fixture.enrolmentId,
      personId: fixture.personId,
      moduleOfferingId: fixture.moduleOfferingId,
      outcomeCode: 'pending',
    });

    // The person who recorded and proposed it cannot decide it; someone else can.
    const decide = (as: string, decisionCode: string, id = determinationId) => ctx.app.inject({
      method: 'POST', url: `/api/v1/ec-determinations/${id}/decision`, headers: { authorization: `Bearer ${as}` }, payload: { decisionCode },
    });
    expect((await decide(jwt, 'upheld')).statusCode).toBe(403);
    // ADR-028: only ec-decision-maker decides; a board chair or registry administrator no longer can.
    for (const roles of [['exam-board-chair'], ['registry-administrator']]) {
      expect((await decide(await ctx.makeJwt({ sub: 'not-a-decider', roles }), 'upheld')).statusCode).toBe(403);
    }
    const decider = await ctx.makeJwt({ sub: 'ec-panel-chair', roles: ['ec-decision-maker'] });
    const upheld = await decide(decider, 'upheld');
    expect(upheld.statusCode, upheld.body).toBe(200);
    expect(upheld.json<{ statusCode: string; decidedBy: string }>()).toMatchObject({ statusCode: 'upheld', decidedBy: 'ec-panel-chair' });
    expect((await outcomeOf())?.outcomeCode).toBe('defer');

    const updated = capturedEvents.find((event) => event.type === 'srs.circumstances.exceptional-circumstances-updated');
    expect(updated).toBeDefined();
    expect(updated?.classification).toBe('sensitive');
    expect(updated?.payload).toMatchObject({ exceptionalCircumstancesId: ecId, previousOutcomeCode: 'pending', newOutcomeCode: 'defer' });

    // The outcome cannot be edited directly; other fields can.
    const patch = (payload: Record<string, unknown>) => ctx.app.inject({ method: 'PATCH', url: `/api/v1/exceptional-circumstances/${ecId}`, headers: { authorization: `Bearer ${jwt}` }, payload });
    expect((await patch({ outcomeCode: 'condone' })).statusCode).toBe(422);
    expect((await patch({ notes: 'Board discretion requested' })).statusCode).toBe(204);

    // A further proposal leaves the outcome unchanged until decided, and a rejection leaves it as it was.
    const proposer = await ctx.makeJwt({ sub: 'ec-officer-1', roles: ['registry-administrator'] });
    const second = await ctx.app.inject({
      method: 'POST', url: `/api/v1/exceptional-circumstances/${ecId}/determination-proposals`, headers: { authorization: `Bearer ${proposer}` },
      payload: { outcomeCode: 'condone', reason: 'Board discretion' },
    });
    expect(second.statusCode, second.body).toBe(201);
    const secondId = second.json<{ id: string }>().id;
    expect((await outcomeOf())?.outcomeCode).toBe('defer');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/ec-determinations?statusCode=proposed', headers: { authorization: `Bearer ${decider}` } }))
      .json<Array<{ id: string }>>().map((d) => d.id)).toContain(secondId);
    // Neither the proposer nor the original recorder may decide it.
    expect((await decide(proposer, 'not-upheld', secondId)).statusCode).toBe(403);
    expect((await decide(jwt, 'not-upheld', secondId)).statusCode).toBe(403);
    expect((await decide(decider, 'not-upheld', secondId)).json<{ statusCode: string }>().statusCode).toBe('not-upheld');
    expect((await outcomeOf())?.outcomeCode).toBe('defer');
  });

  it('keeps exceptional circumstances permission separate from adjustments', async () => {
    const fixture = await createCircumstancesFixture('EC102');
    const wellbeingJwt = await ctx.makeJwt({ roles: ['wellbeing-advisor'] });

    const ec = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`,
      headers: { authorization: `Bearer ${wellbeingJwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        outcomeCode: 'defer',
        determinationDate: '2027-11-10',
      },
    });
    expect(ec.statusCode).toBe(403);

    const adjustment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${wellbeingJwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        adjustmentTypeCode: 'extra-time',
        scopeCode: 'exam',
        validFrom: '2027-09-01T00:00:00.000Z',
      },
    });
    expect(adjustment.statusCode).toBe(201);
  });

  it('records misconduct outcome and penalty effects', async () => {
    const fixture = await createCircumstancesFixture('MC101');
    const markId = await ingestMark(fixture);

    const misconduct = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        caseReference: 'AI-CASE-001',
        caseStatusCode: 'closed',
        penaltyCode: 'mark-cap',
        effectiveDate: '2027-11-20',
        penaltyEffects: [
          { targetEntityType: 'mark', targetEntityId: markId, penaltyDetail: 'Cap mark at 40' },
          { targetEntityType: 'module_registration', targetEntityId: fixture.moduleRegistrationId, penaltyDetail: 'Flag for board' },
        ],
      },
    });
    expect(misconduct.statusCode).toBe(201);
    const misconductOutcomeId = misconduct.json<{ misconductOutcomeId: string }>().misconductOutcomeId;

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ misconductOutcomeId: string; penaltyCode: string; penaltyEffects: Array<{ targetEntityId: string }> }>>())
      .toContainEqual(expect.objectContaining({
        misconductOutcomeId,
        penaltyCode: 'mark-cap',
        penaltyEffects: expect.arrayContaining([
          expect.objectContaining({ targetEntityId: markId }),
          expect.objectContaining({ targetEntityId: fixture.moduleRegistrationId }),
        ]) as Array<{ targetEntityId: string }>,
      }));

    // Misconduct outcomes are for those who act on them (D-5): not module tutors or external examiners.
    for (const role of ['module-tutor', 'external-examiner']) {
      const other = await ctx.makeJwt({ sub: `mc-${role}`, roles: [role] });
      const read = await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`, headers: { authorization: `Bearer ${other}` } });
      expect({ role, status: read.statusCode }).toEqual({ role, status: 403 });
    }
    const tutor = await ctx.makeJwt({ sub: 'mc-tutor', roles: ['module-tutor'] });
    const tutorRecord = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`, headers: { authorization: `Bearer ${tutor}` },
      payload: { enrolmentId: fixture.enrolmentId, caseReference: 'AI-CASE-002', caseStatusCode: 'closed', penaltyCode: 'mark-cap', effectiveDate: '2027-11-20', penaltyEffects: [] },
    });
    expect(tutorRecord.statusCode).toBe(403);
    const integrity = await ctx.makeJwt({ sub: 'mc-integrity', roles: ['integrity-officer'] });
    const chair = await ctx.makeJwt({ sub: 'mc-chair', roles: ['exam-board-chair'] });
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`, headers: { authorization: `Bearer ${integrity}` } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`, headers: { authorization: `Bearer ${chair}` } })).statusCode).toBe(200);
  });

  it('does not expose circumstances records through another tenant', async () => {
    const fixture = await createCircumstancesFixture('EC103');
    const create = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        outcomeCode: 'defer',
        determinationDate: '2027-11-10',
      },
    });
    expect(create.statusCode).toBe(201);
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(404);
  });
});

interface CircumstancesFixture {
  personId: string;
  enrolmentId: string;
  moduleOfferingId: string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

async function createCircumstancesFixture(code: string): Promise<CircumstancesFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Circumstances' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
    },
  });
  expect(enrolment.statusCode).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `${code} Module`, creditValue: 20 },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode: `${code}-SEM1`,
      periodTypeCode: 'semester',
      startDate: '2027-09-20',
      endDate: '2028-01-14',
    },
  });
  expect(period.statusCode).toBe(201);
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  expect(offering.statusCode).toBe(201);
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'coursework', title: 'Coursework', weighting: 100 },
  });
  expect(component.statusCode).toBe(201);
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  return { personId, enrolmentId, moduleOfferingId, moduleRegistrationId, assessmentComponentId };
}

async function ingestMark(fixture: CircumstancesFixture): Promise<string> {
  const mark = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId: fixture.assessmentComponentId, rawMark: 65 },
  });
  expect(mark.statusCode).toBe(201);
  return mark.json<{ markId: string }>().markId;
}
