/**
 * Phase 5 Domain Event Consumer Tests
 *
 * Verifies that every Phase 5 domain event is published to the event bus with
 * the correct subject, data classification, and payload shape.
 *
 * Uses a spy event bus — no live NATS required.
 * Each describe block is self-contained with its own beforeAll fixture so
 * blocks are independent and order-safe.
 */

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
    publish: (
      type: string,
      version: string,
      tenantId: string,
      correlationId: string,
      classification: string,
      payload: unknown,
    ): Promise<void> => {
      capture.push({ type, version, tenantId, correlationId, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close:   () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);

// ─── Shared context ───────────────────────────────────────────────────────────

let ctx: TestApp;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
}, 120_000);

beforeEach(() => { capturedEvents.length = 0; });

afterAll(async () => { await ctx?.teardown(); });

function findEvent(type: string): CapturedEvent | undefined {
  return capturedEvents.find((e) => e.type === type);
}

// ─── Assessment events ────────────────────────────────────────────────────────

describe('Assessment events', () => {
  let jwt: string;
  let moduleRegistrationId: string;
  let markId: string;
  let moduleResultId: string;
  let assessmentComponentId: string;

  beforeAll(async () => {
    jwt = await ctx.makeJwt();
    const fixture = await buildMarkFixture('EVT5-ASS');
    moduleRegistrationId = fixture.moduleRegistrationId;
    assessmentComponentId = fixture.assessmentComponentId;
  });

  it('mark ingestion publishes mark-received and triggers module-result-calculated (personal)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId, rawMark: 72 },
    });
    expect(res.statusCode).toBe(201);
    markId = res.json<{ markId: string }>().markId;

    const recv = findEvent('srs.assessment.mark-received');
    expect(recv).toBeDefined();
    expect(recv!.classification).toBe('personal');
    const rp = recv!.payload as Record<string, unknown>;
    expect(isUuid(rp['markId'])).toBe(true);
    expect(isUuid(rp['moduleRegistrationId'])).toBe(true);
    expect(isUuid(rp['assessmentComponentId'])).toBe(true);
    expect(typeof rp['rawMark']).toBe('number');
    expect(typeof rp['adjustedMark']).toBe('number');
    expect(typeof rp['attemptNumber']).toBe('number');

    const calc = findEvent('srs.assessment.module-result-calculated');
    expect(calc).toBeDefined();
    expect(calc!.classification).toBe('personal');
    const cp = calc!.payload as Record<string, unknown>;
    expect(isUuid(cp['moduleResultId'])).toBe(true);
    expect(isUuid(cp['moduleRegistrationId'])).toBe(true);
    expect(typeof cp['aggregateMark']).toBe('number');
    expect(typeof cp['resultCode']).toBe('string');
    moduleResultId = cp['moduleResultId'] as string;
  });

  it('mark correction publishes mark-updated and retriggers module-result-calculated (personal)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url:    `/api/v1/marks/${markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 68, reason: 'Marking error corrected' },
    });
    expect(res.statusCode).toBe(204);

    const upd = findEvent('srs.assessment.mark-updated');
    expect(upd).toBeDefined();
    expect(upd!.classification).toBe('personal');
    const up = upd!.payload as Record<string, unknown>;
    expect(isUuid(up['markId'])).toBe(true);
    expect(typeof up['previousMark']).toBe('number');
    expect(typeof up['newMark']).toBe('number');
    expect(up['actorId']).toBeTruthy();

    const calc = findEvent('srs.assessment.module-result-calculated');
    expect(calc).toBeDefined();
    expect(calc!.classification).toBe('personal');
    expect(isUuid((calc!.payload as Record<string, unknown>)['moduleResultId'])).toBe(true);
  });

  it('board ratification publishes srs.assessment.module-result-ratified per result (personal)', async () => {
    const chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
    const examBoardId = await createExamBoard('EVT5-ASS-BOARD');
    await signAndRatify(examBoardId, chairJwt);

    const evt = findEvent('srs.assessment.module-result-ratified');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['moduleResultId'])).toBe(true);
    expect(isUuid(p['examBoardId'])).toBe(true);
    expect(typeof p['ratifiedAt']).toBe('string');
    void moduleResultId; // used implicitly through shared fixture
  });
});

// ─── Adjustment events ────────────────────────────────────────────────────────

describe('Adjustment events', () => {
  let jwt: string;
  let enrolmentId: string;
  let personId: string;
  let adjustmentId: string;

  beforeAll(async () => {
    jwt = await ctx.makeJwt();
    const f = await buildStudentEnrolment('EVT5-ADJ');
    personId = f.personId;
    enrolmentId = f.enrolmentId;
  });

  it('recording an adjustment publishes srs.adjustment.approved (sensitive)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/students/${personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId,
        adjustmentTypeCode: 'extra-time',
        scopeCode: 'exam',
        validFrom: '2025-09-22T00:00:00.000Z',
        validTo:   '2026-07-31T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    adjustmentId = res.json<{ adjustmentId: string }>().adjustmentId;

    const evt = findEvent('srs.adjustment.approved');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['adjustmentId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(p['adjustmentTypeCode']).toBe('extra-time');
    expect(p['scopeCode']).toBe('exam');
  });

  it('acknowledging a distribution publishes srs.adjustment.distributed (sensitive)', async () => {
    // Fetch distribution rows to get a distributionId
    const distList = await ctx.app.inject({
      method: 'GET',
      url:    `/api/v1/adjustments/${adjustmentId}/distributions`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(distList.statusCode).toBe(200);
    const [dist] = distList.json<Array<{ distributionId: string; targetSystem: string }>>();
    expect(dist).toBeDefined();

    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/adjustments/${adjustmentId}/distributions/${dist!.distributionId}/acknowledge`,
      headers: { authorization: `Bearer ${await ctx.makeJwt({ roles: ['tenant-administrator'] })}` },
      payload: { targetSystem: dist!.targetSystem },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.adjustment.distributed');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['adjustmentId'])).toBe(true);
    expect(isUuid(p['distributionId'])).toBe(true);
    expect(typeof p['targetSystem']).toBe('string');
    expect(typeof p['distributedAt']).toBe('string');
    // Enriched fields — connectors must not need a REST round-trip to apply
    expect(isUuid(p['personId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(typeof p['adjustmentTypeCode']).toBe('string');
    expect(typeof p['scopeCode']).toBe('string');
    expect(typeof p['validFrom']).toBe('string');
  });

  it('expiring an adjustment publishes srs.adjustment.expired (sensitive)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/adjustments/${adjustmentId}/expire`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.adjustment.expired');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['adjustmentId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(typeof p['expiredAt']).toBe('string');
  });
});

// ─── Exceptional circumstances and misconduct events ─────────────────────────

describe('EC and misconduct events', () => {
  let jwt: string;
  let personId: string;
  let enrolmentId: string;
  let ecId: string;

  beforeAll(async () => {
    jwt = await ctx.makeJwt();
    const f = await buildStudentEnrolment('EVT5-EC');
    personId = f.personId;
    enrolmentId = f.enrolmentId;
  });

  it('recording EC publishes srs.circumstances.exceptional-circumstances-flagged (sensitive)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/students/${personId}/exceptional-circumstances`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId,
        outcomeCode: 'defer',
        determinationDate: '2026-01-10',
      },
    });
    expect(res.statusCode).toBe(201);
    ecId = res.json<{ exceptionalCircumstancesId: string }>().exceptionalCircumstancesId;

    const evt = findEvent('srs.circumstances.exceptional-circumstances-flagged');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['exceptionalCircumstancesId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(p['outcomeCode']).toBe('defer');
    expect(typeof p['determinationDate']).toBe('string');
  });

  it('updating EC publishes srs.circumstances.exceptional-circumstances-updated (sensitive)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url:    `/api/v1/exceptional-circumstances/${ecId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { outcomeCode: 'condone', determinationDate: '2026-01-15' },
    });
    expect(res.statusCode).toBe(204);

    const evt = findEvent('srs.circumstances.exceptional-circumstances-updated');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['exceptionalCircumstancesId'])).toBe(true);
    expect(p['previousOutcomeCode']).toBe('defer');
    expect(p['newOutcomeCode']).toBe('condone');
  });

  it('recording misconduct publishes srs.circumstances.misconduct-outcome-recorded (sensitive)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/students/${personId}/misconduct-outcomes`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId,
        caseReference: 'AI-EVT-001',
        penaltyCode: 'mark-cap',
        effectiveDate: '2026-01-20',
      },
    });
    expect(res.statusCode).toBe(201);

    const evt = findEvent('srs.circumstances.misconduct-outcome-recorded');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('sensitive');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['misconductCaseId'])).toBe(true);
    expect(isUuid(p['misconductOutcomeId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(p['penaltyCode']).toBe('mark-cap');
  });
});

// ─── Exam board governance events ─────────────────────────────────────────────

describe('Exam board governance events', () => {
  let jwt: string;
  let chairJwt: string;
  let examBoardId: string;

  beforeAll(async () => {
    jwt      = await ctx.makeJwt();
    chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
    await buildMarkFixture('EVT5-GOV');
    examBoardId = await createExamBoard('EVT5-GOV-BOARD');
  });

  it('generating a data pack publishes srs.governance.exam-board-data-pack-ready (standard)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/exam-boards/${examBoardId}/data-pack`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(201);

    const evt = findEvent('srs.governance.exam-board-data-pack-ready');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('standard');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['examBoardId'])).toBe(true);
    expect(isUuid(p['dataPackId'])).toBe(true);
    expect(typeof p['boardTypeCode']).toBe('string');
    expect(typeof p['academicYear']).toBe('string');
    expect(typeof p['candidateCount']).toBe('number');
    expect(typeof p['packVersion']).toBe('number');
  });

  it('ratifying the board publishes srs.governance.exam-board-ratified and srs.governance.record-locked (standard)', async () => {
    await signAndRatify(examBoardId, chairJwt);

    const ratified = findEvent('srs.governance.exam-board-ratified');
    expect(ratified).toBeDefined();
    expect(ratified!.classification).toBe('standard');
    const rp = ratified!.payload as Record<string, unknown>;
    expect(isUuid(rp['examBoardId'])).toBe(true);
    expect(typeof rp['boardTypeCode']).toBe('string');
    expect(typeof rp['ratifiedAt']).toBe('string');
    expect(typeof rp['externalExaminerConfirmedAt']).toBe('string');

    const locked = findEvent('srs.governance.record-locked');
    expect(locked).toBeDefined();
    expect(locked!.classification).toBe('standard');
    const lp = locked!.payload as Record<string, unknown>;
    expect(isUuid(lp['examBoardId'])).toBe(true);
    expect(Array.isArray(lp['lockedEntityTypes'])).toBe(true);
    expect(typeof lp['lockedCount']).toBe('number');
  });
});

// ─── Progression and award events ─────────────────────────────────────────────

describe('Progression and award events', () => {
  let jwt: string;
  let chairJwt: string;
  let enrolmentId: string;
  let examBoardId: string;

  beforeAll(async () => {
    jwt      = await ctx.makeJwt();
    chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });

    const fixture = await buildMarkFixture('EVT5-PRG');
    enrolmentId = fixture.enrolmentId;
    examBoardId = await createExamBoard('EVT5-PRG-BOARD');
    const mark = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId: fixture.assessmentComponentId, rawMark: 65 },
    });
    expect(mark.statusCode).toBe(201);
    await signAndRatify(examBoardId, chairJwt);

    // Seed progression rule so the engine can run
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    await ctx.app.inject({
      method: 'POST', url: '/api/v1/academic-rules', headers: { authorization: `Bearer ${adminJwt}` },
      payload: { ruleTypeCode: 'progression-credit-requirement', ruleKey: 'default', ruleValue: { requiredCredits: 20 } },
    });
  });

  it('evaluating progression publishes srs.progression.decided (personal)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/enrolments/${enrolmentId}/progression`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2025-26' },
    });
    expect(res.statusCode).toBe(201);

    const evt = findEvent('srs.progression.decided');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['progressionDecisionId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(typeof p['academicYear']).toBe('string');
    expect(typeof p['yearOfStudy']).toBe('string');
    expect(typeof p['decisionCode']).toBe('string');
  });

  it('conferring an award publishes srs.award.conferred (personal)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/enrolments/${enrolmentId}/award`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        examBoardId,
        qualificationCode:  'BSc',
        classificationCode: 'upper-second',
        awardDate:          '2026-07-15',
      },
    });
    expect(res.statusCode).toBe(201);

    const evt = findEvent('srs.award.conferred');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['awardId'])).toBe(true);
    expect(isUuid(p['enrolmentId'])).toBe(true);
    expect(isUuid(p['personId'])).toBe(true);
    expect(isUuid(p['examBoardId'])).toBe(true);
    expect(p['qualificationCode']).toBe('BSc');
    expect(p['classificationCode']).toBe('upper-second');
    expect(typeof p['awardDate']).toBe('string');
  });
});

// ─── Post-ratification events ─────────────────────────────────────────────────

describe('Post-ratification events', () => {
  let jwt: string;
  let chairJwt: string;
  let markId: string;
  let enrolmentId: string;
  let caseId: string;

  beforeAll(async () => {
    jwt      = await ctx.makeJwt();
    chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });

    const fixture = await buildMarkFixture('EVT5-PRC');
    enrolmentId = fixture.enrolmentId;

    // Ingest mark so we have something to amend
    const markRes = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { assessmentComponentId: fixture.assessmentComponentId, rawMark: 55 },
    });
    markId = markRes.json<{ markId: string }>().markId;

    // Ratify to lock it
    const boardId = await createExamBoard('EVT5-PRC-BOARD');
    await signAndRatify(boardId, chairJwt);

    // Open and uphold a case
    const openRes = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/enrolments/${enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { caseTypeCode: 'administrative-correction', reference: 'REF-EVT5' },
    });
    caseId = openRes.json<{ caseId: string }>().caseId;

    await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` }, payload: { statusCode: 'under-review' },
    });
    await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` }, payload: { statusCode: 'upheld' },
    });
  });

  it('applying an amendment publishes srs.governance.record-amended-post-ratification (personal)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url:    `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        entityType: 'mark',
        entityId:   markId,
        afterValue: { rawMark: 60, adjustedMark: 60 },
      },
    });
    expect(res.statusCode).toBe(201);

    const evt = findEvent('srs.governance.record-amended-post-ratification');
    expect(evt).toBeDefined();
    expect(evt!.classification).toBe('personal');
    const p = evt!.payload as Record<string, unknown>;
    expect(isUuid(p['amendmentId'])).toBe(true);
    expect(isUuid(p['caseId'])).toBe(true);
    expect(p['entityType']).toBe('mark');
    expect(isUuid(p['entityId'])).toBe(true);
    expect(p['appealReference']).toBe('REF-EVT5');
    expect(typeof p['amendedBy']).toBe('string');
    expect(typeof p['amendedAt']).toBe('string');
  });
});

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

describe('OpenAPI spec', () => {
  it('GET /api/v1/openapi.json returns a valid spec with all Phase 5 tags', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url:    '/api/v1/openapi.json',
    });
    expect(res.statusCode).toBe(200);

    const spec = res.json<{
      openapi: string;
      tags: Array<{ name: string }>;
      paths: Record<string, unknown>;
    }>();

    expect(spec.openapi).toMatch(/^3\./);

    const tagNames = spec.tags.map((t) => t.name);
    for (const tag of ['assessment', 'adjustments', 'circumstances', 'governance', 'progression']) {
      expect(tagNames).toContain(tag);
    }

    // Phase 5 endpoint paths present
    const paths = Object.keys(spec.paths);
    expect(paths.some((p) => p.includes('/marks'))).toBe(true);
    expect(paths.some((p) => p.includes('/result'))).toBe(true);
    expect(paths.some((p) => p.includes('/adjustments'))).toBe(true);
    expect(paths.some((p) => p.includes('/exceptional-circumstances'))).toBe(true);
    expect(paths.some((p) => p.includes('/exam-boards'))).toBe(true);
    expect(paths.some((p) => p.includes('/correction-cases'))).toBe(true);
    expect(paths.some((p) => p.includes('/hear'))).toBe(true);
    expect(paths.some((p) => p.includes('/award'))).toBe(true);
    expect(paths.some((p) => p.includes('/classification'))).toBe(true);
  });
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

interface MarkFixture {
  personId:             string;
  enrolmentId:          string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

async function buildStudentEnrolment(code: string): Promise<{ personId: string; enrolmentId: string }> {
  const jwt = await ctx.makeJwt();
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'EventTest' },
  });
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-22' },
  });
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

async function buildMarkFixture(code: string): Promise<MarkFixture> {
  const jwt = await ctx.makeJwt();
  const { personId, enrolmentId } = await buildStudentEnrolment(code);

  const module = await ctx.app.inject({
    method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${jwt}` },
    payload: { code: `${code}MOD`, title: `${code} Module`, creditValue: 20 },
  });
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST', url: '/api/v1/academic-periods', headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear: '2025-26', periodCode: `${code}SEM1`, periodTypeCode: 'semester', startDate: '2025-09-22', endDate: '2026-01-16' },
  });
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2025-10-01' },
  });
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST', url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'exam', title: 'Exam', weighting: 100 },
  });
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  return { personId, enrolmentId, moduleRegistrationId, assessmentComponentId };
}

async function createExamBoard(code: string): Promise<string> {
  const jwt = await ctx.makeJwt();
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/v1/exam-boards', headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'module', academicYear: '2025-26' },
  });
  void code;
  return res.json<{ examBoardId: string }>().examBoardId;
}

async function signAndRatify(examBoardId: string, chairJwt: string): Promise<void> {
  await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` }, payload: { commentary: 'Approved' },
  });
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
  expect(res.statusCode).toBe(204);
}
