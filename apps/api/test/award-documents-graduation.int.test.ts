/**
 * Award documents and graduation (BPR-D15; BP-06-004, BP-06-005).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let verifierJwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'registry-docs-1', roles: ['registry-administrator'] });
  verifierJwt = await ctx.makeJwt({ sub: 'verification-service', roles: ['integration-service'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const call = (method: 'GET' | 'POST', url: string, as: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, ...(payload ? { payload } : {}) });

/** A graduate: person, enrolment and a conferred award on the given date. */
async function graduate(name: string, awardDate: string): Promise<{ personId: string; awardId: string; jwt: string }> {
  const person = await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Graduand' });
  const personId = person.json<{ personId: string }>().personId;
  const enrolment = await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2023-24', startDate: '2023-09-25' });
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;
  const awardId = randomUUID();
  await ctx.db.execute(sql`
    INSERT INTO award (version_id, id, tenant_id, enrolment_id, person_id, source_case_id, qualification_code, classification_code, award_date, actor_id, valid_from)
    VALUES (${randomUUID()}, ${awardId}, ${ctx.tenantId}, ${enrolmentId}, ${personId}, ${randomUUID()}, 'BSc', 'upper-second', ${awardDate}, 'test', now())`);
  return { personId, awardId, jwt: await ctx.makeJwt({ sub: `student-${name}`, roles: ['student'], srsPersonId: personId }) };
}

interface Issue { documentIssueId: string; issueNumber: number; statusCode: string; verificationCode: string; contentHash: string; contentSnapshot: Record<string, string> }

describe('award documents', () => {
  it('issues, replaces, verifies and revokes, keeping every issue', async () => {
    const g = await graduate('Docu', '2026-07-15');
    const first = await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'certificate', channelCode: 'digital' });
    expect(first.statusCode).toBe(201);
    const original = first.json<Issue>();
    expect(original).toMatchObject({ issueNumber: 1, statusCode: 'issued' });
    expect(original.contentSnapshot).toMatchObject({ holderName: 'Docu Graduand', qualificationCode: 'BSc', classificationCode: 'upper-second' });
    expect(original.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // A second original is refused; a replacement supersedes the first.
    expect((await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'certificate', channelCode: 'post' })).statusCode).toBe(409);
    const replacement = (await call('POST', `/awards/${g.awardId}/documents`, registryJwt, {
      documentTypeCode: 'certificate', channelCode: 'post', issueTypeCode: 'replacement',
    })).json<Issue>();
    expect(replacement.issueNumber).toBe(2);

    const verify = async (code: string) => (await call('POST', '/document-verifications', verifierJwt, { verificationCode: code, requesterNote: 'Employer check' }))
      .json<{ outcomeCode: string; document: { holderName: string } | null }>();
    expect(await verify(original.verificationCode)).toMatchObject({ outcomeCode: 'superseded' });
    expect(await verify(replacement.verificationCode.toLowerCase())).toMatchObject({ outcomeCode: 'valid', document: { holderName: 'Docu Graduand' } });
    expect(await verify('NOPE-NOPE-NOPE')).toEqual({ outcomeCode: 'not-found', document: null });

    const revoked = (await call('POST', `/document-issues/${replacement.documentIssueId}/revocation`, registryJwt, {
      reasonCode: 'compromised', reasonText: 'Reported lost and misused',
    })).json<Issue>();
    expect(revoked.statusCode).toBe('revoked');
    expect(await verify(replacement.verificationCode)).toEqual({ outcomeCode: 'revoked', document: null });
    expect((await call('POST', `/document-issues/${replacement.documentIssueId}/revocation`, registryJwt, { reasonCode: 'error', reasonText: 'again' })).statusCode).toBe(409);

    await expect(ctx.db.execute(sql`DELETE FROM document_revocation WHERE document_issue_id = ${replacement.documentIssueId}`))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) as unknown } });
    const checks = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM document_verification WHERE tenant_id = ${ctx.tenantId}`)) as unknown as Array<{ n: number }>;
    expect(checks[0]!.n).toBeGreaterThanOrEqual(4);

    expect((await call('GET', `/awards/${g.awardId}/documents`, registryJwt)).json<Issue[]>().map((i) => i.issueNumber).sort()).toEqual([1, 2]);
  });

  it('a student sees only their own documents', async () => {
    const a = await graduate('Own', '2026-07-15');
    const b = await graduate('Other', '2026-07-15');
    await call('POST', `/awards/${a.awardId}/documents`, registryJwt, { documentTypeCode: 'transcript', channelCode: 'digital' });
    expect((await call('GET', `/students/${a.personId}/documents`, a.jwt)).json<Issue[]>()).toHaveLength(1);
    expect((await call('GET', `/students/${b.personId}/documents`, a.jwt)).statusCode).toBe(403);
  });

  it('a replacement needs an original first', async () => {
    const g = await graduate('Rep', '2026-07-15');
    expect((await call('POST', `/awards/${g.awardId}/documents`, registryJwt, { documentTypeCode: 'hear', channelCode: 'digital', issueTypeCode: 'replacement' })).statusCode).toBe(409);
  });
});

describe('graduation', () => {
  it('invites from conferred awards, allocates within capacity, freezes, and records attendance without touching the award', async () => {
    const attending = await graduate('Att', '2030-07-01');
    const second = await graduate('Sec', '2030-07-02');
    const absentia = await graduate('Abs', '2030-07-03');
    await graduate('Late', '2031-01-10'); // outside the window

    const cycle = (await call('POST', '/graduation-cycles', registryJwt, {
      cycleCode: 'SUMMER-2030', title: 'Summer graduation 2030', awardsFrom: '2030-06-01', awardsTo: '2030-08-31',
      ceremonies: [
        { ceremonyCode: 'AM', startsAt: '2030-09-10T10:00:00Z', venue: 'Great Hall', capacity: 1, guestLimit: 2 },
        { ceremonyCode: 'PM', startsAt: '2030-09-10T15:00:00Z', venue: 'Great Hall', capacity: 50, guestLimit: 2 },
      ],
    })).json<{ cycleId: string; ceremonies: Array<{ ceremonyId: string; ceremonyCode: string }> }>();
    const am = cycle.ceremonies.find((c) => c.ceremonyCode === 'AM')!.ceremonyId;
    const pm = cycle.ceremonies.find((c) => c.ceremonyCode === 'PM')!.ceremonyId;

    expect((await call('POST', `/graduation-cycles/${cycle.cycleId}/invitations`, registryJwt)).json()).toEqual({ invited: 3, alreadyInvited: 0, previouslyPresented: 0 });
    expect((await call('POST', `/graduation-cycles/${cycle.cycleId}/invitations`, registryJwt)).json()).toEqual({ invited: 0, alreadyInvited: 3, previouslyPresented: 0 });

    const invitationFor = async (g: { personId: string; jwt: string }) =>
      (await call('GET', `/students/${g.personId}/graduation-invitations`, g.jwt)).json<Array<{ invitationId: string }>>()[0]!.invitationId;
    const attInv = await invitationFor(attending);
    const secInv = await invitationFor(second);
    const absInv = await invitationFor(absentia);

    // A student answers only their own invitation.
    expect((await call('POST', `/graduation-invitations/${secInv}/response`, attending.jwt, { responseCode: 'declined' })).statusCode).toBe(403);
    await call('POST', `/graduation-invitations/${attInv}/response`, attending.jwt, { responseCode: 'attending', guestCount: 2, accessibilityRequired: true });
    await call('POST', `/graduation-invitations/${secInv}/response`, second.jwt, { responseCode: 'attending', guestCount: 3 });
    await call('POST', `/graduation-invitations/${absInv}/response`, absentia.jwt, { responseCode: 'in-absentia' });

    const allocated = await call('POST', `/graduation-invitations/${attInv}/allocation`, registryJwt, { ceremonyId: am });
    expect(allocated.statusCode).toBe(200);
    // Second graduand: guest limit, then capacity, each refused without affecting the award.
    expect((await call('POST', `/graduation-invitations/${secInv}/allocation`, registryJwt, { ceremonyId: pm })).statusCode).toBe(409);
    await call('POST', `/graduation-invitations/${secInv}/response`, second.jwt, { responseCode: 'attending', guestCount: 1 });
    expect((await call('POST', `/graduation-invitations/${secInv}/allocation`, registryJwt, { ceremonyId: am })).statusCode).toBe(409);
    expect((await call('POST', `/graduation-invitations/${secInv}/allocation`, registryJwt, { ceremonyId: pm })).statusCode).toBe(200);
    expect((await call('POST', `/graduation-invitations/${absInv}/allocation`, registryJwt, { ceremonyId: pm })).statusCode).toBe(409);

    const list = (await call('POST', `/graduation-cycles/${cycle.cycleId}/freeze`, registryJwt)).json<Array<{ ceremonyCode: string; invitationId: string; accessibilityRequired: boolean }>>();
    expect(list.map((e) => [e.ceremonyCode, e.invitationId])).toEqual([['AM', attInv], ['PM', secInv]]);
    expect(list[0]!.accessibilityRequired).toBe(true);
    expect((await call('POST', `/graduation-invitations/${absInv}/response`, absentia.jwt, { responseCode: 'attending' })).statusCode).toBe(409);

    const allocationId = allocated.json<{ allocationId: string }>().allocationId;
    expect((await call('POST', `/ceremony-allocations/${allocationId}/attendance`, registryJwt, { attendanceCode: 'absent' })).json<{ attendanceCode: string }>().attendanceCode).toBe('absent');
    const award = (await ctx.db.execute(sql`SELECT classification_code, recorded_until FROM award WHERE id = ${attending.awardId}`)) as unknown as Array<{ classification_code: string; recorded_until: Date | null }>;
    expect(award).toEqual([{ classification_code: 'upper-second', recorded_until: null }]);
  });

  it('a later cycle re-invites deferrals and skips those already presented', async () => {
    const deferred = await graduate('Def', '2032-07-01');
    const presented = await graduate('Pre', '2032-07-02');
    const first = (await call('POST', '/graduation-cycles', registryJwt, {
      cycleCode: 'SUMMER-2032', title: 'Summer 2032', awardsFrom: '2032-06-01', awardsTo: '2032-08-31',
      ceremonies: [{ ceremonyCode: 'MAIN', startsAt: '2032-09-10T10:00:00Z', venue: 'Hall', capacity: 10 }],
    })).json<{ cycleId: string }>();
    await call('POST', `/graduation-cycles/${first.cycleId}/invitations`, registryJwt);
    const inv = async (g: { personId: string; jwt: string }) =>
      (await call('GET', `/students/${g.personId}/graduation-invitations`, g.jwt)).json<Array<{ invitationId: string }>>()[0]!.invitationId;
    await call('POST', `/graduation-invitations/${await inv(deferred)}/response`, deferred.jwt, { responseCode: 'deferred' });
    await call('POST', `/graduation-invitations/${await inv(presented)}/response`, presented.jwt, { responseCode: 'in-absentia' });

    const later = (await call('POST', '/graduation-cycles', registryJwt, {
      cycleCode: 'WINTER-2032', title: 'Winter 2032', awardsFrom: '2032-06-01', awardsTo: '2032-12-31',
      ceremonies: [{ ceremonyCode: 'MAIN', startsAt: '2033-01-20T10:00:00Z', venue: 'Hall', capacity: 10 }],
    })).json<{ cycleId: string }>();
    expect((await call('POST', `/graduation-cycles/${later.cycleId}/invitations`, registryJwt)).json()).toEqual({ invited: 1, alreadyInvited: 0, previouslyPresented: 1 });
  });
});
