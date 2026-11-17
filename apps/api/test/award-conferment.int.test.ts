/**
 * Award recommendation and conferment, and reassessment plans (BPR-D14; BP-06-002, BP-06-003).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let chairJwt: string;
let conferrerJwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt({ sub: 'registry-admin-1' });
  chairJwt = await ctx.makeJwt({ sub: 'board-chair-1', roles: ['exam-board-chair'] });
  conferrerJwt = await ctx.makeJwt({ sub: 'senate-delegate-1', roles: ['registry-administrator'] });
  await seedClassificationRules();
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

interface Recommendation { recommendationId: string; statusCode: string; calculatedClassificationCode: string | null; conferment: { awardId: string } | null }

describe('award recommendation and conferment', () => {
  it('the board recommends, a different delegated authority confers, and the conferment is immutable', async () => {
    const f = await createAwardFixture('CON1');
    await seedRatifiedResult(f, 'CON1A', 65, 20);
    const examBoardId = await createExamBoard();

    // A recommendation that differs from the calculation needs a discretion reason.
    expect((await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'standard', qualificationCode: 'BSc', classificationCode: 'first', examBoardId,
    })).statusCode).toBe(422);

    const rec = await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'standard', qualificationCode: 'BSc', classificationCode: 'upper-second', examBoardId,
    });
    expect(rec.statusCode).toBe(201);
    const recommendation = rec.json<Recommendation>();
    expect(recommendation).toMatchObject({ statusCode: 'recommended', calculatedClassificationCode: 'upper-second' });

    // No award until conferment, and only one open recommendation.
    expect((await call('GET', `/enrolments/${f.enrolmentId}/award`, chairJwt)).statusCode).toBe(404);
    expect((await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'standard', qualificationCode: 'BSc', classificationCode: 'upper-second', examBoardId,
    })).statusCode).toBe(409);

    // The recommender cannot confer.
    const chairAsConferrer = await ctx.makeJwt({ sub: 'board-chair-1', roles: ['registry-administrator'] });
    expect((await call('POST', `/award-recommendations/${recommendation.recommendationId}/conferment`, chairAsConferrer, {
      confermentDate: '2026-07-15', authorityRef: 'Senate 2026/07',
    })).statusCode).toBe(409);

    const conferred = await call('POST', `/award-recommendations/${recommendation.recommendationId}/conferment`, conferrerJwt, {
      confermentDate: '2026-07-15', authorityRef: 'Senate 2026/07',
    });
    expect(conferred.statusCode).toBe(201);
    const body = conferred.json<Recommendation>();
    expect(body.statusCode).toBe('conferred');
    const award = (await call('GET', `/enrolments/${f.enrolmentId}/award`, chairJwt)).json<{ awardId: string; classificationCode: string }>();
    expect(award).toMatchObject({ awardId: body.conferment!.awardId, classificationCode: 'upper-second' });
    expect((await call('GET', `/enrolments/${f.enrolmentId}`, jwt)).json<{ statusCode: string }>().statusCode).toBe('graduated');

    // Conferring again is refused, and the conferment row cannot be changed.
    expect((await call('POST', `/award-recommendations/${recommendation.recommendationId}/conferment`, conferrerJwt, {
      confermentDate: '2026-07-16', authorityRef: 'Senate 2026/07',
    })).statusCode).toBe(409);
    await expect(ctx.db.execute(sql`UPDATE award_conferment SET authority_ref = 'tampered' WHERE recommendation_id = ${recommendation.recommendationId}`))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) as unknown } });
  });

  it('records discretion when the board departs from the calculation', async () => {
    const f = await createAwardFixture('CON2');
    await seedRatifiedResult(f, 'CON2A', 59, 20);
    const examBoardId = await createExamBoard();
    const rec = (await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'standard', qualificationCode: 'BSc', classificationCode: 'upper-second', examBoardId,
      discretionReason: 'Borderline; profile and mitigation considered under regulation 12.4',
    })).json<Recommendation & { discretionReason: string }>();
    expect(rec).toMatchObject({ calculatedClassificationCode: 'lower-second', discretionReason: expect.stringContaining('regulation 12.4') as unknown });
  });

  it('records the calculation with the recommendation, and refuses conferment once the rules behind it change (D-35)', async () => {
    const f = await createAwardFixture('CON4');
    await seedRatifiedResult(f, 'CON4A', 66, 20);
    const examBoardId = await createExamBoard();
    const rec = (await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'standard', qualificationCode: 'BSc', classificationCode: 'upper-second', examBoardId,
    })).json<Recommendation>();

    const evidence = await call('GET', `/award-recommendations/${rec.recommendationId}/evidence`, chairJwt);
    expect(evidence.statusCode).toBe(200);
    const body = evidence.json<{ awardId: string | null; outcomeCount: number; totalCreditValue: number; ruleVersions: Array<{ ruleTypeCode: string; source: string; versionId: string | null }> }>();
    expect(body).toMatchObject({ awardId: null, outcomeCount: 1, totalCreditValue: 20 });
    expect(body.ruleVersions.find((v) => v.ruleTypeCode === 'classification-boundary')).toMatchObject({ source: 'tenant-default', versionId: expect.any(String) as string });
    expect(body.ruleVersions.find((v) => v.ruleTypeCode === 'classification-algorithm')).toMatchObject({ source: 'built-in-default', versionId: null });

    // The algorithm is now configured: the classification is the same, but not the rules it rests on.
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    expect((await call('POST', '/academic-rules', adminJwt, {
      ruleTypeCode: 'classification-algorithm', ruleKey: 'undergraduate', ruleValue: { algorithm: 'weighted-average' }, description: 'Configured explicitly',
    })).statusCode).toBe(201);
    const refused = await call('POST', `/award-recommendations/${rec.recommendationId}/conferment`, conferrerJwt, { confermentDate: '2026-07-15', authorityRef: 'Senate 2026/07' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/recommend again/);
  });

  it('an aegrotat award must cite its policy authority', async () => {
    // Aegrotat: the student has some ratified results but could not complete.
    const f = await createAwardFixture('CON3');
    await seedRatifiedResult(f, 'CON3A', 55, 20);
    const examBoardId = await createExamBoard();
    expect((await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'aegrotat', qualificationCode: 'BSc', classificationCode: 'aegrotat', examBoardId,
    })).statusCode).toBe(422);
    const rec = await call('POST', `/enrolments/${f.enrolmentId}/award-recommendations`, chairJwt, {
      awardTypeCode: 'aegrotat', qualificationCode: 'BSc', classificationCode: 'aegrotat', examBoardId, authorityRef: 'Regulation 15 (aegrotat awards)',
    });
    expect(rec.statusCode).toBe(201);
    const conferred = await call('POST', `/award-recommendations/${rec.json<Recommendation>().recommendationId}/conferment`, conferrerJwt, {
      confermentDate: '2026-07-15', authorityRef: 'Senate 2026/07',
    });
    expect(conferred.statusCode).toBe(201);
  });
});

describe('reassessment plans', () => {
  async function decision(enrolmentId: string, decisionCode: string, locked: boolean, academicYear = '2025-26'): Promise<string> {
    const id = randomUUID();
    await ctx.db.execute(sql`
      INSERT INTO progression_decision (version_id, id, tenant_id, enrolment_id, academic_year, year_of_study, decision_code, locked, actor_id, valid_from)
      VALUES (${randomUUID()}, ${id}, ${ctx.tenantId}, ${enrolmentId}, ${academicYear}, '1', ${decisionCode}, ${locked}, 'board', now())`);
    return id;
  }

  it('follows only a ratified decision, numbers attempts, and keeps deferral as first-attempt treatment', async () => {
    const f = await createAwardFixture('REA1');
    const moduleRegistrationId = randomUUID();
    const unratified = await decision(f.enrolmentId, 'resit', false);
    expect((await call('POST', `/progression-decisions/${unratified}/reassessment-plans`, jwt, { planTypeCode: 'referral', moduleRegistrationId })).statusCode).toBe(409);

    const resit = await decision(f.enrolmentId, 'resit', true, '2026-27');
    expect((await call('POST', `/progression-decisions/${resit}/reassessment-plans`, jwt, { planTypeCode: 'repeat-stage' })).statusCode).toBe(422);
    expect((await call('POST', `/progression-decisions/${resit}/reassessment-plans`, jwt, { planTypeCode: 'referral' })).statusCode).toBe(422);

    const deferral = (await call('POST', `/progression-decisions/${resit}/reassessment-plans`, jwt, { planTypeCode: 'deferral', moduleRegistrationId, markCap: 40 })).json<{ attemptNumber: number; markCap: number | null }>();
    expect(deferral).toMatchObject({ attemptNumber: 2, markCap: null });
    const first = (await call('POST', `/progression-decisions/${resit}/reassessment-plans`, jwt, { planTypeCode: 'referral', moduleRegistrationId, markCap: 40, dueDate: '2026-08-15' })).json<{ reassessmentPlanId: string; attemptNumber: number; markCap: number }>();
    expect(first).toMatchObject({ attemptNumber: 2, markCap: 40 });
    const second = (await call('POST', `/progression-decisions/${resit}/reassessment-plans`, jwt, { planTypeCode: 'additional-attempt', moduleRegistrationId })).json<{ attemptNumber: number }>();
    expect(second.attemptNumber).toBe(3);

    expect((await call('POST', `/reassessment-plans/${first.reassessmentPlanId}/closure`, jwt, { statusCode: 'completed', note: 'Passed at 45, capped 40' })).json<{ statusCode: string }>().statusCode).toBe('completed');
    expect((await call('POST', `/reassessment-plans/${first.reassessmentPlanId}/closure`, jwt, { statusCode: 'expired' })).statusCode).toBe(409);
    expect((await call('GET', `/enrolments/${f.enrolmentId}/reassessment-plans`, jwt)).json<unknown[]>()).toHaveLength(3);
  });

  it('ratifying a board creates the plans its resit decisions call for (D-12)', async () => {
    const f = await createAwardFixture('REA3');
    const moduleId = (await call('POST', '/modules', jwt, { code: 'REA3F', title: 'Failed Module', creditValue: 20 })).json<{ moduleId: string }>().moduleId;
    const academicPeriodId = (await call('POST', '/academic-periods', jwt, {
      academicYear: '2025-26', periodCode: 'REA3-SEM1', periodTypeCode: 'semester', startDate: '2025-09-22', endDate: '2026-01-16',
    })).json<{ academicPeriodId: string }>().academicPeriodId;
    const reassessment = await call('POST', '/academic-periods', jwt, {
      academicYear: '2025-26', periodCode: 'REA3-RESIT', periodTypeCode: 'reassessment', startDate: '2026-07-20', endDate: '2026-08-21',
    });
    expect(reassessment.statusCode).toBe(201);
    const moduleOfferingId = (await call('POST', '/module-offerings', jwt, { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 })).json<{ moduleOfferingId: string }>().moduleOfferingId;
    const moduleRegistrationId = (await call('POST', '/module-registrations', jwt, { enrolmentId: f.enrolmentId, moduleOfferingId, registrationDate: '2025-10-01' })).json<{ moduleRegistrationId: string }>().moduleRegistrationId;
    const componentId = (await call('POST', `/module-offerings/${moduleOfferingId}/components`, jwt, { componentTypeCode: 'coursework', title: 'Coursework', weighting: 100 })).json<{ assessmentComponentId: string }>().assessmentComponentId;
    expect((await call('POST', `/module-registrations/${moduleRegistrationId}/marks`, jwt, { assessmentComponentId: componentId, rawMark: 22 })).statusCode).toBe(201);
    const resit = await decision(f.enrolmentId, 'resit', false);

    const boardId = (await call('POST', '/exam-boards', jwt, { boardTypeCode: 'award', academicYear: '2025-26', academicPeriodId })).json<{ examBoardId: string }>().examBoardId;
    await signoffBoard(boardId);
    await ratifyBoard(boardId);

    const plans = (await call('GET', `/enrolments/${f.enrolmentId}/reassessment-plans`, jwt)).json<Array<{ progressionDecisionId: string; planTypeCode: string; moduleRegistrationId: string; attemptNumber: number; markCap: number | null; dueDate: string | null }>>();
    expect(plans).toEqual([expect.objectContaining({
      progressionDecisionId: resit, planTypeCode: 'referral', moduleRegistrationId, attemptNumber: 2, markCap: 40, dueDate: '2026-08-21',
    })]);
  });

  it('a repeat-year decision leads to a repeat stage', async () => {
    const f = await createAwardFixture('REA2');
    const repeat = await decision(f.enrolmentId, 'repeat-year', true);
    const plan = await call('POST', `/progression-decisions/${repeat}/reassessment-plans`, jwt, { planTypeCode: 'repeat-stage' });
    expect(plan.statusCode).toBe(201);
    expect(plan.json<{ attemptNumber: number }>().attemptNumber).toBe(2);
  });
});

// ── fixtures (as in awards.int.test.ts) ────────────────────────────────────

interface AwardFixture { personId: string; enrolmentId: string }

async function createAwardFixture(code: string): Promise<AwardFixture> {
  const student = await call('POST', '/students', jwt, { legalFirstName: code, legalFamilyName: 'Graduate' });
  const personId = student.json<{ personId: string }>().personId;
  const enrolment = await call('POST', '/enrolments', jwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-22' });
  expect(enrolment.statusCode).toBe(201);
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

async function seedRatifiedResult(fixture: AwardFixture, moduleCode: string, mark: number, creditValue: number): Promise<void> {
  const moduleId = (await call('POST', '/modules', jwt, { code: moduleCode, title: `${moduleCode} Module`, creditValue })).json<{ moduleId: string }>().moduleId;
  const academicPeriodId = (await call('POST', '/academic-periods', jwt, {
    academicYear: '2025-26', periodCode: `${moduleCode}-SEM1`, periodTypeCode: 'semester', startDate: '2025-09-22', endDate: '2026-01-16',
  })).json<{ academicPeriodId: string }>().academicPeriodId;
  const moduleOfferingId = (await call('POST', '/module-offerings', jwt, { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 }))
    .json<{ moduleOfferingId: string }>().moduleOfferingId;
  const moduleRegistrationId = (await call('POST', '/module-registrations', jwt, { enrolmentId: fixture.enrolmentId, moduleOfferingId, registrationDate: '2025-10-01' }))
    .json<{ moduleRegistrationId: string }>().moduleRegistrationId;
  const assessmentComponentId = (await call('POST', `/module-offerings/${moduleOfferingId}/components`, jwt, { componentTypeCode: 'coursework', title: 'Coursework', weighting: 100 }))
    .json<{ assessmentComponentId: string }>().assessmentComponentId;
  expect((await call('POST', `/module-registrations/${moduleRegistrationId}/marks`, jwt, { assessmentComponentId, rawMark: mark })).statusCode).toBe(201);
  const boardId = await createExamBoard(academicPeriodId);
  await signoffBoard(boardId);
  await ratifyBoard(boardId);
}

async function createExamBoard(academicPeriodId?: string): Promise<string> {
  const res = await call('POST', '/exam-boards', jwt, { boardTypeCode: 'award', academicYear: '2025-26', ...(academicPeriodId ? { academicPeriodId } : {}) });
  expect(res.statusCode).toBe(201);
  const examBoardId = res.json<{ examBoardId: string }>().examBoardId;
  if (!academicPeriodId) { await signoffBoard(examBoardId); await ratifyBoard(examBoardId); }
  return examBoardId;
}

async function signoffBoard(examBoardId: string): Promise<void> {
  expect((await call('POST', `/exam-boards/${examBoardId}/external-examiner-signoff`, chairJwt, { commentary: 'Ready' })).statusCode).toBe(201);
}

async function ratifyBoard(examBoardId: string): Promise<void> {
  expect((await call('POST', `/exam-boards/${examBoardId}/ratification`, chairJwt)).statusCode).toBe(204);
}

async function seedClassificationRules(): Promise<void> {
  const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  await call('POST', '/academic-rules', adminJwt, {
    ruleTypeCode: 'classification-boundary', ruleKey: 'undergraduate',
    ruleValue: { boundaries: [{ code: 'first', minimumMark: 70 }, { code: 'upper-second', minimumMark: 60 }, { code: 'lower-second', minimumMark: 50 }, { code: 'third', minimumMark: 40 }] },
    description: 'Standard UK HE classification boundaries',
  });
}
