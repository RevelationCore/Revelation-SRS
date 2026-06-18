/**
 * Phase 4 Domain Event Consumer Tests
 *
 * Verifies that every Phase 4 domain event is published to the event bus with
 * the correct subject, data classification, and payload shape.
 *
 * Uses a spy event bus injected via buildApp overrides — no live NATS required.
 * The spy bus reports isConnected()=true so all conditional publish blocks fire.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../../src/platform/integration-bus/publisher.js';
import { startTestApp, type TestApp } from '../helpers/test-app.js';

// ─── Spy bus ─────────────────────────────────────────────────────────────────

interface CapturedEvent {
  type:           string;
  version:        string;
  tenantId:       string;
  correlationId:  string;
  classification: string;
  payload:        unknown;
}

function createSpyBus(capture: CapturedEvent[]): IntegrationBusPublisher {
  return {
    isConnected: () => true,
    // eslint-disable-next-line @typescript-eslint/require-await
    publish: async (type, version, tenantId, correlationId, classification, payload) => {
      capture.push({ type, version, tenantId, correlationId, classification, payload });
    },
    connect: async () => {},
    close:   async () => {},
  } as unknown as IntegrationBusPublisher;
}

// ─── Shared test context ──────────────────────────────────────────────────────

let ctx: TestApp;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

// Helper: find the first captured event matching the given type
function findEvent(type: string): CapturedEvent | undefined {
  return capturedEvents.find((e) => e.type === type);
}

// ─── Student identity events ─────────────────────────────────────────────────

describe('Student identity events', () => {
  let personId: string;
  let verificationCheckId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Event', legalFamilyName: 'Consumer' },
    });
    personId = res.json<{ personId: string }>().personId;
  });

  it('POST /students publishes srs.student.created', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Eve', legalFamilyName: 'Created' },
    });
    expect(res.statusCode).toBe(201);
    const { personId: newId, studentNumber } = res.json<{ personId: string; studentNumber: string }>();

    const evt = findEvent('srs.student.created');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({ personId: newId, studentNumber, tenantId: ctx.tenantId });
  });

  it('PATCH /students/:id/identity publishes srs.student.identity-updated', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${personId}/identity`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { preferredName: 'Evie' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.student.identity-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      personId,
      changedFields: expect.arrayContaining(['preferredName']),
    });
    expect(typeof (evt!.payload as Record<string, unknown>)['effectiveDate']).toBe('string');
  });

  it('PATCH /students/:id/hesa-id publishes srs.student.identity-updated with changedFields=[hesaId]', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/students/${personId}/hesa-id`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { hesaId: 'HESA-EVT-001' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.student.identity-updated');
    expect(evt).toBeDefined();
    expect(evt!.payload).toMatchObject({ personId, changedFields: ['hesaId'] });
  });

  it('POST /students/:id/disability-declarations publishes srs.student.disability-declaration-updated', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/disability-declarations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { disabilityCategoryCode: '05' },
    });
    expect(res.statusCode).toBe(201);
    const { declarationId } = res.json<{ declarationId: string }>();

    const evt = findEvent('srs.student.disability-declaration-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('special-category');
    expect(evt!.payload).toMatchObject({
      personId,
      declarationId,
      disabilityCategoryCode: '05',
    });
  });

  it('POST /students/:id/identity-verifications publishes srs.identity.verification-requested', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/identity-verifications`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { providerReference: 'OIV-EVT-001' },
    });
    expect(res.statusCode).toBe(201);
    verificationCheckId = res.json<{ verificationCheckId: string }>().verificationCheckId;

    const evt = findEvent('srs.identity.verification-requested');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({ personId, verificationCheckId });
  });

  it('POST /students/:id/identity-verifications/:id/completion publishes srs.identity.verification-completed', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/students/${personId}/identity-verifications/${verificationCheckId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'verified', confidenceScore: 95 },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.identity.verification-completed');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      personId,
      verificationCheckId,
      statusCode: 'verified',
      fraudFlag:  false,
    });
  });
});

// ─── Enrolment lifecycle events ───────────────────────────────────────────────

describe('Enrolment lifecycle events', () => {
  let enrolPersonId: string;
  let enrolmentId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const pRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Enrol', legalFamilyName: 'EventPerson' },
    });
    enrolPersonId = pRes.json<{ personId: string }>().personId;
  });

  it('POST /enrolments publishes srs.student.enrolled + srs.enrolment.fee-liability-generated', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            enrolPersonId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
        feeBandCode:         'home-undergraduate',
        fundingSourceCode:   'slc',
      },
    });
    expect(res.statusCode).toBe(201);
    enrolmentId = res.json<{ enrolmentId: string }>().enrolmentId;

    const enrolled = findEvent('srs.student.enrolled');
    expect(enrolled).toBeDefined();
    expect(enrolled!.classification).toBe('personal');
    expect(enrolled!.payload).toMatchObject({
      personId:    enrolPersonId,
      enrolmentId,
      academicYear: '2025-26',
      modeOfStudy: 'full-time',
    });

    const feeLiability = findEvent('srs.enrolment.fee-liability-generated');
    expect(feeLiability).toBeDefined();
    expect(feeLiability!.classification).toBe('personal');
    expect(feeLiability!.payload).toMatchObject({ personId: enrolPersonId, enrolmentId });
    expect(typeof (feeLiability!.payload as Record<string, unknown>)['feeLiabilityId']).toBe('string');
  });

  it('POST /enrolments with ucasPersonalId publishes srs.enrolment.downstream-trigger-created', async () => {
    const jwt = await ctx.makeJwt();
    const pRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Downstream', legalFamilyName: 'Trigger' },
    });
    const pid = pRes.json<{ personId: string }>().personId;

    await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            pid,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2025-26',
        startDate:           '2025-09-22',
        ucasPersonalId:      '9876543210',
      },
    });

    const trigger = findEvent('srs.enrolment.downstream-trigger-created');
    expect(trigger).toBeDefined();
    expect(trigger!.classification).toBe('personal');
    expect(trigger!.payload).toMatchObject({
      personId:        pid,
      triggerTypeCode: 'ucas-confirmation',
    });
    expect(typeof (trigger!.payload as Record<string, unknown>)['triggerId']).toBe('string');
  });

  it('POST /enrolments/:id/graduate publishes srs.student.status-changed', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/graduate`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reasonCode: 'completed' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.student.status-changed');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      personId:       enrolPersonId,
      enrolmentId,
      previousStatus: 'enrolled',
      newStatus:      'graduated',
    });
  });
});

// ─── Module registration events ───────────────────────────────────────────────

describe('Module registration events', () => {
  let regPersonId: string;
  let regEnrolmentId: string;
  let moduleOfferingId: string;
  let moduleRegistrationId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();

    const pRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Reg', legalFamilyName: 'EventPerson' },
    });
    regPersonId = pRes.json<{ personId: string }>().personId;

    const eRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId:            regPersonId,
        modeOfStudyCode:     'full-time',
        academicYearOfEntry: '2026-27',
        startDate:           '2026-09-21',
      },
    });
    regEnrolmentId = eRes.json<{ enrolmentId: string }>().enrolmentId;

    const periodRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/academic-periods',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        academicYear:  '2026-27',
        periodCode:    'EVT-SEM1',
        periodTypeCode: 'semester',
        startDate:     '2026-09-21',
        endDate:       '2027-01-15',
      },
    });
    const academicPeriodId = periodRes.json<{ academicPeriodId: string }>().academicPeriodId;

    const modRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT101', title: 'Event Module', creditValue: 20 },
    });
    const moduleId = modRes.json<{ moduleId: string }>().moduleId;

    const offRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-offerings',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 50 },
    });
    moduleOfferingId = offRes.json<{ moduleOfferingId: string }>().moduleOfferingId;
  });

  it('POST /module-registrations publishes srs.enrolment.module-registered', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId:      regEnrolmentId,
        moduleOfferingId,
        registrationDate: '2026-10-01',
      },
    });
    expect(res.statusCode).toBe(201);
    moduleRegistrationId = res.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

    const evt = findEvent('srs.enrolment.module-registered');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      enrolmentId:         regEnrolmentId,
      moduleRegistrationId,
      moduleOfferingId,
      registrationDate:    '2026-10-01',
    });
    expect(typeof (evt!.payload as Record<string, unknown>)['moduleId']).toBe('string');
    expect(typeof (evt!.payload as Record<string, unknown>)['academicPeriodId']).toBe('string');
  });

  it('POST /module-registrations/:id/withdrawal publishes srs.enrolment.module-registration-withdrawn', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${moduleRegistrationId}/withdrawal`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-11-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.enrolment.module-registration-withdrawn');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      enrolmentId:         regEnrolmentId,
      moduleRegistrationId,
      moduleOfferingId,
      withdrawnAt:         '2026-11-01T00:00:00.000Z',
    });
  });

  it('POST /module-registrations/:id/completion publishes srs.enrolment.module-registration-completed', async () => {
    // Register a second time (first was withdrawn) to complete
    const jwt = await ctx.makeJwt();
    const regRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId:      regEnrolmentId,
        moduleOfferingId,
        registrationDate: '2026-10-01',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const newRegId = regRes.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/module-registrations/${newRegId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-12-15T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.enrolment.module-registration-completed');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    expect(evt!.payload).toMatchObject({
      enrolmentId:         regEnrolmentId,
      moduleRegistrationId: newRegId,
      moduleOfferingId,
      completedAt:         '2026-12-15T00:00:00.000Z',
    });
  });
});

// ─── Catalogue events ─────────────────────────────────────────────────────────

describe('Catalogue events', () => {
  it('POST /programmes publishes srs.catalogue.programme-updated', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/programmes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT-PROG-01', title: 'Event Programme' },
    });
    expect(res.statusCode).toBe(201);
    const { programmeId } = res.json<{ programmeId: string }>();

    const evt = findEvent('srs.catalogue.programme-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('standard');
    expect(evt!.payload).toMatchObject({
      programmeId,
      code:  'EVT-PROG-01',
      title: 'Event Programme',
    });
    expect(typeof (evt!.payload as Record<string, unknown>)['effectiveDate']).toBe('string');
  });

  it('PATCH /programmes/:id publishes srs.catalogue.programme-updated', async () => {
    const jwt = await ctx.makeJwt();
    const createRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/programmes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT-PROG-02', title: 'Programme To Update' },
    });
    const { programmeId } = createRes.json<{ programmeId: string }>();
    capturedEvents.length = 0;

    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/programmes/${programmeId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { title: 'Updated Programme Title' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.catalogue.programme-updated');
    expect(evt).toBeDefined();
    expect(evt!.payload).toMatchObject({ programmeId, title: 'Updated Programme Title' });
  });

  it('POST /modules publishes srs.catalogue.module-updated', async () => {
    const jwt = await ctx.makeJwt();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT201', title: 'Event Module 201', creditValue: 15 },
    });
    expect(res.statusCode).toBe(201);
    const { moduleId } = res.json<{ moduleId: string }>();

    const evt = findEvent('srs.catalogue.module-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('standard');
    expect(evt!.payload).toMatchObject({
      moduleId,
      code:        'EVT201',
      title:       'Event Module 201',
      creditValue: 15,
    });
  });

  it('POST /module-relationships publishes srs.catalogue.module-relationship-updated', async () => {
    const jwt = await ctx.makeJwt();

    const mod1 = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT-PRE', title: 'Prerequisite Module' },
    });
    const mod2 = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT-ADV', title: 'Advanced Module' },
    });
    const moduleId        = mod2.json<{ moduleId: string }>().moduleId;
    const relatedModuleId = mod1.json<{ moduleId: string }>().moduleId;
    capturedEvents.length = 0;

    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-relationships',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { moduleId, relatedModuleId, relationshipTypeCode: 'prerequisite' },
    });
    expect(res.statusCode).toBe(201);
    const { relationshipId } = res.json<{ relationshipId: string }>();

    const evt = findEvent('srs.catalogue.module-relationship-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('standard');
    expect(evt!.payload).toMatchObject({
      relationshipId,
      moduleId,
      relatedModuleId,
      relationshipTypeCode: 'prerequisite',
    });
  });

  it('POST /learning-outcomes publishes srs.catalogue.learning-outcome-updated', async () => {
    const jwt = await ctx.makeJwt();

    const modRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'EVT-LO', title: 'Learning Outcome Module' },
    });
    const moduleId = modRes.json<{ moduleId: string }>().moduleId;
    capturedEvents.length = 0;

    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/learning-outcomes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { moduleId, outcomeCode: 'LO-EVT-01', description: 'Understand event-driven systems' },
    });
    expect(res.statusCode).toBe(201);
    const { learningOutcomeId } = res.json<{ learningOutcomeId: string }>();

    const evt = findEvent('srs.catalogue.learning-outcome-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('standard');
    expect(evt!.payload).toMatchObject({
      learningOutcomeId,
      moduleId,
      programmeId: null,
      outcomeCode: 'LO-EVT-01',
    });
    expect(typeof (evt!.payload as Record<string, unknown>)['effectiveDate']).toBe('string');
  });
});
