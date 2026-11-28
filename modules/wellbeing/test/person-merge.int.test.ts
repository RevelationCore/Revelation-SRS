/**
 * ADR-031 item 7 (BL-358): the wellbeing module applies srs.person.merged to
 * its own schema, once per merge, and records it in its audit log.
 */
import { randomUUID } from 'node:crypto';

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import { EVENT_TYPES } from '@revelation-srs/domain';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WellbeingEventConsumer } from '../src/consumers/consumer.js';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

let ctx: TestWellbeingApp;
let consumer: WellbeingEventConsumer;

beforeAll(async () => {
  ctx = await startTestApp();
  consumer = new WellbeingEventConsumer('nats://unused', ctx.db, pino({ level: 'silent' }));
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

const envelope = <T>(type: string, payload: T): DomainEventEnvelope<T> => ({
  id: randomUUID(), type, version: '1.0.0', schemaRef: `https://schemas.srs.ac.uk/events/${type}/v1.0.0`, tenantId: ctx.tenantId,
  occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(), validAt: new Date().toISOString(),
  correlationId: randomUUID(), causationId: randomUUID(), source: 'srs-core', dataClassification: 'personal', payload,
});
const rows = async <T>(q: ReturnType<typeof sql>) => (await ctx.db.execute(q)) as unknown as T[];

describe('srs.person.merged in the wellbeing module', () => {
  it('moves the merged person\'s cases to the survivor, keeps a projection the survivor already has, and applies once', async () => {
    const merged = randomUUID(); const survivor = randomUUID();
    const dc = await ctx.app.inject({
      method: 'POST', url: '/api/v1/disability-cases', headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: merged, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-MERGE' },
    });
    expect(dc.statusCode, dc.body).toBe(201);
    const { id: caseId, wellbeingCaseId } = dc.json<{ id: string; wellbeingCaseId: string }>();
    // Both people have a context projection (one per person).
    for (const personId of [merged, survivor]) {
      await consumer.dispatch(envelope(EVENT_TYPES.STUDENT_ENROLLED, { personId, enrolmentId: randomUUID(), academicYear: '2027/28', modeOfStudy: 'full-time' }));
    }

    const mergeId = randomUUID();
    const merge = () => envelope(EVENT_TYPES.PERSON_MERGED, { mergeId, survivorPersonId: survivor, mergedPersonId: merged, effectiveAt: new Date().toISOString() });
    await consumer.dispatch(merge());

    const versions = await rows<{ person_id: string; recorded_until: Date | null }>(sql`SELECT person_id::text, recorded_until FROM wellbeing.disability_support_case WHERE id = ${caseId}::uuid`);
    expect(versions.filter((v) => v.recorded_until === null).map((v) => v.person_id)).toEqual([survivor]);
    expect(versions.some((v) => v.person_id === merged && v.recorded_until !== null)).toBe(true);
    expect((await rows<{ person_id: string }>(sql`SELECT person_id::text FROM wellbeing.wellbeing_case WHERE id = ${wellbeingCaseId}::uuid`)).map((r) => r.person_id)).toEqual([survivor]);
    // The survivor already had a projection, so the merged person's stays where it is.
    expect((await rows(sql`SELECT 1 FROM wellbeing.srs_context_projection WHERE person_id = ${merged}::uuid`))).toHaveLength(1);

    const audit = await rows<{ actor_id: string; context: { kept: string[] } }>(sql`SELECT actor_id, context FROM wellbeing.audit_log WHERE resource_type = 'identity-merge' AND resource_id = ${mergeId}::uuid`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe('system:person-merge');
    expect(audit[0]!.context.kept).toEqual(['srs_context_projection.person_id']);

    const moves = (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM wellbeing.person_merge_move WHERE merge_id = ${mergeId}::uuid`))[0]!.n;
    expect(moves).toBeGreaterThan(1);
    await consumer.dispatch(merge());
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM wellbeing.person_merge_move WHERE merge_id = ${mergeId}::uuid`))[0]!.n).toBe(moves);
    expect(await rows(sql`SELECT 1 FROM wellbeing.audit_log WHERE resource_type = 'identity-merge' AND resource_id = ${mergeId}::uuid`)).toHaveLength(1);
  });

  it('srs.person.unmerged moves the cases back, audits it, and applies once (BL-359)', async () => {
    const merged = randomUUID(); const survivor = randomUUID();
    const dc = await ctx.app.inject({
      method: 'POST', url: '/api/v1/disability-cases', headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: merged, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-UNMERGE' },
    });
    const { id: caseId } = dc.json<{ id: string }>();
    const mergeId = randomUUID();
    await consumer.dispatch(envelope(EVENT_TYPES.PERSON_MERGED, { mergeId, survivorPersonId: survivor, mergedPersonId: merged, effectiveAt: new Date().toISOString() }));
    const unmerge = () => envelope(EVENT_TYPES.PERSON_UNMERGED, { mergeId, survivorPersonId: survivor, restoredPersonId: merged, effectiveAt: new Date().toISOString(), reallocatedToRestored: {} });
    await consumer.dispatch(unmerge());
    await consumer.dispatch(unmerge());

    const current = await rows<{ person_id: string }>(sql`SELECT person_id::text FROM wellbeing.disability_support_case WHERE id = ${caseId}::uuid AND recorded_until IS NULL`);
    expect(current.map((c) => c.person_id)).toEqual([merged]);
    const audit = await rows<{ context: { unmerged?: boolean } }>(sql`SELECT context FROM wellbeing.audit_log WHERE resource_type = 'identity-merge' AND resource_id = ${mergeId}::uuid ORDER BY recorded_at`);
    expect(audit.map((a) => Boolean(a.context.unmerged))).toEqual([false, true]);
  });
});

