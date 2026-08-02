import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let dpoJwt: string;

beforeAll(async () => {
  ctx    = await startTestApp();
  jwt    = await ctx.makeJwt();
  dpoJwt = await ctx.makeJwt({ roles: ['dpo'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function createPerson(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

describe('Identity resolution & correction case (BPR-D17)', () => {
  it('opens a case, adds a candidate, and requires an explicit decision to merge', async () => {
    const survivorId = await createPerson('Jordan', 'Smith');
    const duplicateId = await createPerson('Jordan', 'Smyth');

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/identity-resolution/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { subjectPersonId: duplicateId, ownerId: 'dpo-01' },
    });
    expect(openCase.statusCode).toBe(201);
    const { identityResolutionCaseId } = openCase.json<{ identityResolutionCaseId: string }>();

    const candidate = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/identity-resolution/cases/${identityResolutionCaseId}/candidates`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { candidatePersonId: survivorId, matchScore: 0.92, matchReasonCode: 'name-dob' },
    });
    expect(candidate.statusCode).toBe(201);

    // A merge decision without a survivor is rejected — the candidate score alone never decides.
    const badDecision = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/identity-resolution/cases/${identityResolutionCaseId}/decision`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { decisionTypeCode: 'merge' },
    });
    expect(badDecision.statusCode).toBe(422);

    const decision = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/identity-resolution/cases/${identityResolutionCaseId}/decision`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { decisionTypeCode: 'merge', survivorPersonId: survivorId },
    });
    expect(decision.statusCode).toBe(201);

    const link = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/identity-resolution/links',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { sourcePersonId: duplicateId, targetPersonId: survivorId, linkTypeCode: 'merged-into' },
    });
    expect(link.statusCode).toBe(201);
  });

  it('opens a data correction case for a person', async () => {
    const personId = await createPerson('Alex', 'Rivera');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/identity-resolution/correction-cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { personId, correctedEntityType: 'person_identity', correctedFieldName: 'dateOfBirth', ownerId: 'dpo-01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('lists identity-resolution and correction cases so staff can browse rather than only create', async () => {
    const subjectId = await createPerson('Morgan', 'Lee');

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/identity-resolution/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { subjectPersonId: subjectId, ownerId: 'dpo-02' },
    });
    expect(openCase.statusCode).toBe(201);
    const { identityResolutionCaseId } = openCase.json<{ identityResolutionCaseId: string }>();

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/identity-resolution/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ identityResolutionCaseId: string; subjectPersonId: string; statusCode: string; ownerId: string }>>())
      .toContainEqual(expect.objectContaining({
        identityResolutionCaseId,
        subjectPersonId: subjectId,
        statusCode: 'open',
        ownerId: 'dpo-02',
      }));

    const correctionPersonId = await createPerson('Casey', 'Nguyen');
    const openCorrection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/identity-resolution/correction-cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { personId: correctionPersonId, correctedEntityType: 'person_identity', correctedFieldName: 'legalFirstName', ownerId: 'dpo-02' },
    });
    expect(openCorrection.statusCode).toBe(201);
    const { dataCorrectionCaseId } = openCorrection.json<{ dataCorrectionCaseId: string }>();

    const correctionList = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/identity-resolution/correction-cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(correctionList.statusCode).toBe(200);
    expect(correctionList.json<Array<{ dataCorrectionCaseId: string; personId: string }>>())
      .toContainEqual(expect.objectContaining({ dataCorrectionCaseId, personId: correctionPersonId }));
  });
});
