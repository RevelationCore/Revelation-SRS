import { and, eq, isNull } from 'drizzle-orm';
import { enrolments, persons, tenants, type Db, withTenantContext } from '@revelation-srs/db';

import { clockNow } from '../../clock.js';
import type { DeliveryService } from '../delivery-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const IAM_FLOW = 'F-SIS-IAM-01';

/** The institutional account (IAM, email, portal login): identity-level entitlements (D-19). */
export type AccountAccess = 'limited' | 'full' | 'suspended' | 'ended';
/** Study entitlements (VLE modules, library, accommodation, CMS cohorts), which follow status directly. */
export type StudyAccess = 'none' | 'full' | 'suspended' | 'revoked';

/**
 * The default entitlement matrix (Phase 3 D-19). Study access follows the
 * enrolment status from its effective date; the account outlives a withdrawal
 * or graduation until the leaver closure (plus a grace period), so the
 * student can still see results and appeal.
 */
export const ACCESS_MATRIX: Record<string, { study: StudyAccess; account: AccountAccess }> = {
  'pre-registration': { study: 'none',      account: 'limited' },
  enrolled:           { study: 'full',      account: 'full' },
  intermitting:       { study: 'suspended', account: 'full' },
  suspended:          { study: 'suspended', account: 'limited' },
  withdrawn:          { study: 'revoked',   account: 'limited' },
  graduated:          { study: 'revoked',   account: 'limited' },
};

const RANK: Record<AccountAccess, number> = { ended: 0, suspended: 1, limited: 2, full: 3 };
export const DEFAULT_GRACE_DAYS: Record<'withdrawn' | 'graduated', number> = { withdrawn: 30, graduated: 90 };

/**
 * Sends the person's account access to IAM: the most generous level across
 * their current enrolments. State sync: a later item supersedes an
 * undelivered one, so IAM always receives the whole picture.
 */
export async function requestAccountAccess(delivery: DeliveryService, db: Db, tenantId: string, input: { personId: string; changeKey: string; effectiveFrom?: Date }): Promise<void> {
  const { studentNumber, statuses } = await personEnrolments(db, tenantId, input.personId);
  if (statuses.length === 0) return;
  const level = statuses.map((s) => ACCESS_MATRIX[s]?.account ?? 'limited').reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ended' as AccountAccess);
  const effectiveFrom = (input.effectiveFrom ?? clockNow()).toISOString();
  await delivery.request(tenantId, {
    flowCode: IAM_FLOW, subjectType: 'person', subjectId: input.personId, personId: input.personId, idempotencyKey: input.changeKey,
    payload: { personId: input.personId, studentNumber, accessLevel: level, effectiveFrom, enrolmentStatuses: statuses },
    summary: `Set the institutional account to ${level} from ${effectiveFrom.slice(0, 10)}`,
  });
}

/**
 * An approved leaver closure ends the account after the grace period for the
 * end state, unless the person still has an enrolment in progress.
 */
export async function requestAccountClosure(delivery: DeliveryService, db: Db, tenantId: string, input: { personId: string; enrolmentId: string; endStatus: string; decidedAt: Date; changeKey: string }): Promise<{ endsOn: string } | null> {
  const { studentNumber, statuses } = await personEnrolments(db, tenantId, input.personId);
  if (statuses.some((s) => !['withdrawn', 'graduated'].includes(s))) return null;
  const graceDays = (await graceFor(db, tenantId))[input.endStatus === 'graduated' ? 'graduated' : 'withdrawn'];
  const endsOn = new Date(input.decidedAt.getTime() + graceDays * 86_400_000).toISOString().slice(0, 10);
  await delivery.request(tenantId, {
    flowCode: IAM_FLOW, subjectType: 'person', subjectId: input.personId, personId: input.personId, idempotencyKey: input.changeKey,
    payload: { personId: input.personId, studentNumber, accessLevel: 'ended', effectiveFrom: `${endsOn}T00:00:00.000Z`, enrolmentStatuses: statuses, leaverClosureEnrolmentId: input.enrolmentId },
    summary: `End the institutional account on ${endsOn} (leaver closure plus ${graceDays} days)`,
  });
  return { endsOn };
}

async function personEnrolments(db: Db, tenantId: string, personId: string): Promise<{ studentNumber: string | null; statuses: string[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx.select({ statusCode: enrolments.statusCode }).from(enrolments)
      .where(and(eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.personId, personId as Uuid), isNull(enrolments.recordedUntil)));
    const [person] = await tx.select({ studentNumber: persons.studentNumber }).from(persons).where(eq(persons.id, personId as Uuid)).limit(1);
    return { studentNumber: person?.studentNumber ?? null, statuses: rows.map((r) => r.statusCode) };
  });
}

async function graceFor(db: Db, tenantId: string): Promise<Record<'withdrawn' | 'graduated', number>> {
  const [row] = await db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
  const g = ((row?.configuration?.['access'] ?? {}) as Record<string, unknown>)['graceDays'] as Record<string, unknown> | undefined;
  const pick = (k: 'withdrawn' | 'graduated') => (typeof g?.[k] === 'number' && (g[k]) >= 0 ? g[k] : DEFAULT_GRACE_DAYS[k]);
  return { withdrawn: pick('withdrawn'), graduated: pick('graduated') };
}
