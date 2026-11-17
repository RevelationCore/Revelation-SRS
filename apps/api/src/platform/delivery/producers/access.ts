import { and, eq, isNull, sql } from 'drizzle-orm';
import { enrolments, persons, tenants, type Db, withTenantContext } from '@revelation-srs/db';

import { canonicalHash } from '../../canonical-hash.js';
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

/** Which kind of institutional account a person needs (F-SIS-IAM-01 contract v2, D-38). */
export type AccountKind = 'student' | 'applicant' | 'external';

export interface AccountState {
  accountKind: AccountKind | null;
  /** Portal roles the person's records entitle them to (student, applicant, research-supervisor, pgr-examiner). */
  roles: string[];
  accessLevel: AccountAccess;
  enrolmentStatuses: string[];
  studentNumber: string | null;
}

const TERMINAL_APPLICATION = ['rejected', 'withdrawn'];

/**
 * Works out a person's account from everything that entitles them to one
 * (D-38): enrolments (the D-19 matrix), applications bound to them with a
 * certain identity match, current supervision assignments, and examiner
 * appointments. An applicant keeps access for access.applicantAccountEndDays
 * after their last application ends; an examiner for pgr.examinerAccess.graceDays
 * after their examination closes.
 */
export async function computeAccountState(db: Db, tenantId: string, personId: string): Promise<AccountState> {
  const { studentNumber, statuses } = await personEnrolments(db, tenantId, personId);
  const config = await accessConfig(db, tenantId);
  const now = clockNow();
  const rows = await withTenantContext(db, tenantId, async (tx) => ({
    applications: await tx.execute(sql`
      SELECT status_code, updated_at FROM student_application
      WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid AND identity_match_code IN ('matched', 'created')`) as unknown as Array<{ status_code: string; updated_at: Date }>,
    supervision: await tx.execute(sql`
      SELECT 1 FROM staff_assignment
      WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid AND assignment_type_code = 'supervisor'
        AND recorded_until IS NULL AND valid_from <= ${now.toISOString()}::timestamptz AND (valid_to IS NULL OR valid_to > ${now.toISOString()}::timestamptz)
      LIMIT 1`) as unknown as unknown[],
    examining: await tx.execute(sql`
      SELECT bc.status_code, bc.recorded_at AS updated_at FROM examiner_appointment ea
      JOIN pgr_examination_case ec ON ec.id = ea.examination_case_id
      LEFT JOIN business_case bc ON bc.id = ec.business_case_id AND bc.recorded_until IS NULL
      WHERE ea.tenant_id = ${tenantId}::uuid AND ea.person_id = ${personId}::uuid AND ea.recused_at IS NULL`) as unknown as Array<{ status_code: string | null; updated_at: Date | null }>,
  }));
  const within = (at: Date | null, days: number) => at !== null && new Date(at).getTime() + days * 86_400_000 > now.getTime();
  const roles = new Set<string>();
  const studying = statuses.some((s) => (ACCESS_MATRIX[s]?.account ?? 'limited') !== 'ended');
  if (statuses.length > 0) roles.add('student');
  if (statuses.length === 0 && rows.applications.some((a) => !TERMINAL_APPLICATION.includes(a.status_code) || within(a.updated_at, config.applicantAccountEndDays))) roles.add('applicant');
  if (rows.supervision.length > 0) roles.add('research-supervisor');
  const examinationOpen = (code: string | null) => code !== 'closed' && code !== 'withdrawn';
  if (rows.examining.some((e) => examinationOpen(e.status_code) || within(e.updated_at, config.examinerGraceDays))) roles.add('pgr-examiner');

  const studentLevel = statuses.map((s) => ACCESS_MATRIX[s]?.account ?? 'limited').reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ended' as AccountAccess);
  const accessLevel: AccountAccess = statuses.length > 0
    ? (roles.size > 1 && RANK[studentLevel] < RANK.full ? 'full' : studentLevel)
    : roles.size > 0 ? 'full' : 'ended';
  const accountKind: AccountKind | null = statuses.length > 0 && studying ? 'student' : roles.has('applicant') ? 'applicant' : roles.size > 0 ? 'external' : null;
  return { accountKind, roles: [...roles].sort(), accessLevel, enrolmentStatuses: statuses, studentNumber };
}

/**
 * Sends the person's account to IAM (F-SIS-IAM-01 contract v2): its kind,
 * portal roles and access level. State sync: a later item supersedes an
 * undelivered one, so IAM always receives the whole picture. The payload
 * carries a hash of the state, so IAM can tell a repeat from a change.
 */
export async function requestAccountAccess(delivery: DeliveryService, db: Db, tenantId: string, input: { personId: string; changeKey: string; effectiveFrom?: Date }): Promise<void> {
  const state = await computeAccountState(db, tenantId, input.personId);
  if (state.accountKind === null && state.enrolmentStatuses.length === 0) return;
  const effectiveFrom = (input.effectiveFrom ?? clockNow()).toISOString();
  const stateHash = canonicalHash({ accountKind: state.accountKind, roles: state.roles, accessLevel: state.accessLevel, enrolmentStatuses: state.enrolmentStatuses });
  await delivery.request(tenantId, {
    flowCode: IAM_FLOW, subjectType: 'person', subjectId: input.personId, personId: input.personId, idempotencyKey: input.changeKey,
    payload: {
      contractVersion: 2, personId: input.personId, studentNumber: state.studentNumber, accountKind: state.accountKind, roles: state.roles,
      accessLevel: state.accessLevel, effectiveFrom, enrolmentStatuses: state.enrolmentStatuses, stateHash,
    },
    summary: `Set the institutional account to ${state.accessLevel}${state.roles.length > 0 ? ` (${state.roles.join(', ')})` : ''} from ${effectiveFrom.slice(0, 10)}`,
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
    payload: {
      contractVersion: 2, personId: input.personId, studentNumber, accountKind: 'student', roles: [], accessLevel: 'ended',
      effectiveFrom: `${endsOn}T00:00:00.000Z`, enrolmentStatuses: statuses, leaverClosureEnrolmentId: input.enrolmentId,
    },
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

async function accessConfig(db: Db, tenantId: string): Promise<{ applicantAccountEndDays: number; examinerGraceDays: number }> {
  const [row] = await db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
  const cfg = row?.configuration ?? {};
  const access = (cfg['access'] ?? {}) as Record<string, unknown>;
  const examiner = (((cfg['pgr'] ?? {}) as Record<string, unknown>)['examinerAccess'] ?? {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 ? v : d);
  return { applicantAccountEndDays: n(access['applicantAccountEndDays'], 90), examinerGraceDays: n(examiner['graceDays'], 30) };
}
