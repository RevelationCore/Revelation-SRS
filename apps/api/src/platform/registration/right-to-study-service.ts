import { randomUUID } from 'node:crypto';

import {
  casCases,
  enrolments,
  rightToStudyChecks,
  tenants,
  ukviComplianceAlerts,
  type Db,
  type RightToStudyCheck,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { NotificationService } from '../notifications/notification-service.js';
import type { RegistrationBlocker, RegistrationBlockerProvider } from '../registration-periods/service.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export type RightToStudyOutcome = 'pending' | 'eligible' | 'not-eligible' | 'referred' | 'recheck-required';
export type RightToStudyScope = 'all' | 'sponsored' | 'none';

export interface RightToStudyDto {
  checkId: string;
  personId: string;
  enrolmentId: string | null;
  casCaseId: string | null;
  basisCode: string | null;
  methodCode: string | null;
  outcomeCode: RightToStudyOutcome;
  checkedBy: string;
  checkedAt: Date;
  permissionExpiresOn: string | null;
  ukEntryDate: string | null;
  restrictionCode: string | null;
  evidenceRef: string | null;
  identityVerificationCheckId: string | null;
  recheckDueOn: string | null;
  shareCodeSubmitted: boolean;
  note: string | null;
}

export interface RecordRightToStudyInput {
  basisCode: string;
  methodCode: string;
  outcomeCode: 'eligible' | 'not-eligible';
  enrolmentId?: string;
  casCaseId?: string;
  permissionExpiresOn?: string;
  ukEntryDate?: string;
  restrictionCode?: string;
  evidenceRef?: string;
  identityVerificationCheckId?: string;
  recheckDueOn?: string;
  note?: string;
}

export interface RightToStudyWorkItem { reason: 'share-code-submitted' | 'referred' | 'recheck-required' | 'expiring' | 'expired'; check: RightToStudyDto }

const today = () => clockNow().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Right to study (Phase 3 D-17; BP-02-002). Recorded separately from identity
 * verification: who checked, on what basis, by which method, and when the
 * permission expires. A not-eligible finding is referred to a regulatory
 * officer, whose decision is a new version. Initial registration needs a
 * current eligible check (and, for a sponsored student, the UK entry date);
 * annual registration is blocked only by an expired permission.
 */
export class RightToStudyService implements RegistrationBlockerProvider {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly notifications?: NotificationService,
  ) {}

  async listForPerson(tenantId: string, personId: string): Promise<RightToStudyDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(rightToStudyChecks).where(and(
      eq(rightToStudyChecks.tenantId, tenantId as Uuid), eq(rightToStudyChecks.personId, personId as Uuid), isNull(rightToStudyChecks.recordedUntil),
    )).orderBy(desc(rightToStudyChecks.checkedAt)));
    return rows.map(toDto);
  }

  /** The check that counts: the most recent one. */
  async current(tenantId: string, personId: string): Promise<RightToStudyDto | null> {
    return (await this.listForPerson(tenantId, personId))[0] ?? null;
  }

  /**
   * Records a completed check. A share code the student submitted is
   * completed in place (and cleared). Not eligible is recorded as referred.
   */
  async record(tenantId: string, personId: string, input: RecordRightToStudyInput, actorId: string): Promise<RightToStudyDto> {
    await this.#code(tenantId, 'basis_code', input.basisCode);
    await this.#code(tenantId, 'method_code', input.methodCode);
    if (input.restrictionCode) await this.#code(tenantId, 'restriction_code', input.restrictionCode);
    if (input.basisCode === 'student-route' && !input.permissionExpiresOn) throw new ValidationError('A Student route permission has an expiry date');
    if (input.permissionExpiresOn && input.permissionExpiresOn < today() && input.outcomeCode === 'eligible') {
      throw new ValidationError('An expired permission cannot be recorded as eligible');
    }
    const pending = (await this.listForPerson(tenantId, personId)).find((c) => c.outcomeCode === 'pending');
    const now = clockNow();
    const values = {
      tenantId: tenantId as Uuid, personId: personId as Uuid,
      enrolmentId: (input.enrolmentId ?? pending?.enrolmentId ?? null) as Uuid | null, casCaseId: (input.casCaseId ?? null) as Uuid | null,
      basisCode: input.basisCode, methodCode: input.methodCode,
      outcomeCode: input.outcomeCode === 'not-eligible' ? 'referred' : 'eligible',
      checkedBy: actorId, checkedAt: now,
      permissionExpiresOn: input.permissionExpiresOn ?? null, ukEntryDate: input.ukEntryDate ?? null, restrictionCode: input.restrictionCode ?? null,
      evidenceRef: input.evidenceRef ?? null, identityVerificationCheckId: (input.identityVerificationCheckId ?? null) as Uuid | null,
      recheckDueOn: input.recheckDueOn ?? null, shareCode: null, note: input.note?.trim() || null, expiryWarningSentAt: null,
      validFrom: now, recordedAt: now,
    };
    const id = pending?.checkId ?? randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      if (pending) await tx.update(rightToStudyChecks).set({ recordedUntil: now, validTo: now }).where(and(eq(rightToStudyChecks.id, id as Uuid), isNull(rightToStudyChecks.recordedUntil)));
      await tx.insert(rightToStudyChecks).values({ versionId: randomUUID(), id: id as Uuid, ...values });
    });
    return this.#get(tenantId, id);
  }

  /** A regulatory officer's decision on a referred check (D-17 E4): a new version. */
  async decide(tenantId: string, checkId: string, input: { outcomeCode: 'eligible' | 'not-eligible'; note: string }, actorId: string): Promise<RightToStudyDto> {
    const current = await this.#get(tenantId, checkId);
    if (current.outcomeCode !== 'referred') throw new ConflictError('Only a referred check is decided this way');
    if (current.checkedBy === actorId) throw new ConflictError('The person who referred the check cannot decide it');
    if (!input.note.trim()) throw new ValidationError('Record the reason for the decision');
    return this.#version(tenantId, current, { outcomeCode: input.outcomeCode, note: input.note.trim(), checkedBy: actorId, checkedAt: clockNow() });
  }

  /** The student shares a View and Prove code from the portal: a pending check for the registry. */
  async submitShareCode(tenantId: string, personId: string, shareCode: string, actorId: string): Promise<RightToStudyDto> {
    const code = shareCode.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{9}$/.test(code)) throw new ValidationError('A share code is 9 letters and numbers');
    const pending = (await this.listForPerson(tenantId, personId)).find((c) => c.outcomeCode === 'pending');
    if (pending) return this.#version(tenantId, pending, { shareCode: code, checkedAt: clockNow() });
    const now = clockNow();
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(rightToStudyChecks).values({
      versionId: randomUUID(), id: id, tenantId: tenantId as Uuid, personId: personId as Uuid,
      methodCode: 'view-and-prove', outcomeCode: 'pending', checkedBy: actorId, checkedAt: now, shareCode: code, validFrom: now, recordedAt: now,
    }));
    return this.#get(tenantId, id);
  }

  /** An inbound visa status change means the check must be done again; eligibility is never inferred from it. */
  async markRecheckRequired(tenantId: string, personId: string, reason: string, actorId: string): Promise<void> {
    const current = await this.current(tenantId, personId);
    if (!current || current.outcomeCode !== 'eligible') return;
    await this.#version(tenantId, current, { outcomeCode: 'recheck-required', note: reason, checkedBy: actorId, checkedAt: clockNow() });
  }

  /** What the registry and regulatory officers need to act on. */
  async worklist(tenantId: string): Promise<RightToStudyWorkItem[]> {
    const warningDays = (await this.#settings(tenantId)).expiryWarningDays;
    const horizon = addDays(today(), warningDays);
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(rightToStudyChecks).where(and(
      eq(rightToStudyChecks.tenantId, tenantId as Uuid), isNull(rightToStudyChecks.recordedUntil),
    )).orderBy(desc(rightToStudyChecks.checkedAt)));
    const latestPerPerson = new Map<string, RightToStudyCheck>();
    for (const r of rows) if (!latestPerPerson.has(r.personId)) latestPerPerson.set(r.personId, r);
    const items: RightToStudyWorkItem[] = [];
    for (const r of latestPerPerson.values()) {
      const check = toDto(r);
      if (r.outcomeCode === 'pending' && r.shareCode) items.push({ reason: 'share-code-submitted', check });
      else if (r.outcomeCode === 'referred') items.push({ reason: 'referred', check });
      else if (r.outcomeCode === 'recheck-required') items.push({ reason: 'recheck-required', check });
      else if (r.outcomeCode === 'eligible' && r.permissionExpiresOn) {
        if (r.permissionExpiresOn < today()) items.push({ reason: 'expired', check });
        else if (r.permissionExpiresOn <= horizon) items.push({ reason: 'expiring', check });
      }
    }
    return items;
  }

  /**
   * The daily expiry scan (run by the worker's reconcile loop): warns each
   * student once before expiry, and raises a UKVI alert for a sponsored
   * student whose permission has expired. It never changes an enrolment.
   */
  async scanExpiry(tenantId: string): Promise<{ warned: number; alerts: number }> {
    const { expiryWarningDays } = await this.#settings(tenantId);
    const horizon = addDays(today(), expiryWarningDays);
    const due = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(rightToStudyChecks).where(and(
      eq(rightToStudyChecks.tenantId, tenantId as Uuid), isNull(rightToStudyChecks.recordedUntil),
      eq(rightToStudyChecks.outcomeCode, 'eligible'), isNotNull(rightToStudyChecks.permissionExpiresOn), lte(rightToStudyChecks.permissionExpiresOn, horizon),
    )));
    let warned = 0;
    let alerts = 0;
    for (const r of due) {
      const latest = await this.current(tenantId, r.personId);
      if (latest?.checkId !== r.id) continue;
      if (!r.expiryWarningSentAt) {
        await this.notifications?.deliver(tenantId, {
          personId: r.personId, category: 'right-to-study',
          title: 'Your permission to study is due to expire',
          body: `Our records show your permission to stay in the UK ends on ${r.permissionExpiresOn}. Please send us your new permission, for example a View and Prove share code, before then.`,
          linkUrl: '/profile',
        });
        await withTenantContext(this.db, tenantId, (tx) => tx.update(rightToStudyChecks).set({ expiryWarningSentAt: clockNow() }).where(eq(rightToStudyChecks.versionId, r.versionId)));
        warned += 1;
      }
      if (r.permissionExpiresOn! < today() && (await this.#sponsored(tenantId, r.personId))) {
        const enrolmentId = r.enrolmentId ?? (await this.#currentEnrolment(tenantId, r.personId));
        if (enrolmentId) {
          const inserted = await withTenantContext(this.db, tenantId, (tx) => tx.insert(ukviComplianceAlerts).values({
            tenantId: tenantId as Uuid, enrolmentId: enrolmentId as Uuid, casCaseId: r.casCaseId, alertTypeCode: 'permission-expired', triggeredAt: clockNow(),
          }).onConflictDoNothing().returning({ id: ukviComplianceAlerts.id }));
          alerts += inserted.length;
        }
      }
    }
    return { warned, alerts };
  }

  /** Registration blockers (composed with financial registration's). */
  async blockersFor(tenantId: string, enrolmentId: string, _academicYear: string, periodTypeCode: 'annual' | 'initial' = 'annual'): Promise<RegistrationBlocker[]> {
    const [enrolment] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: enrolments.personId }).from(enrolments)
      .where(and(eq(enrolments.id, enrolmentId as Uuid), isNull(enrolments.recordedUntil))).limit(1));
    if (!enrolment) return [];
    const { scope } = await this.#settings(tenantId);
    if (scope === 'none') return [];
    const sponsored = await this.#sponsored(tenantId, enrolment.personId);
    if (scope === 'sponsored' && !sponsored) return [];
    const current = await this.current(tenantId, enrolment.personId);
    if (periodTypeCode === 'initial') {
      if (current?.outcomeCode !== 'eligible') {
        return [{ code: 'right-to-study', message: 'Your right to study in the UK has not been confirmed yet. Please share your evidence with the registry.' }];
      }
      if (sponsored && !current.ukEntryDate) return [{ code: 'uk-entry-date', message: 'Your date of entry to the UK must be recorded before you register' }];
      if (sponsored && !(await this.#sponsored(tenantId, enrolment.personId, true))) return [{ code: 'cas-not-assigned', message: 'Your CAS has not been assigned yet' }];
    }
    if (current?.outcomeCode === 'eligible' && current.permissionExpiresOn && current.permissionExpiresOn < today()) {
      return [{ code: 'permission-expired', message: 'Your permission to study has expired. Please send the registry your new permission.' }];
    }
    return [];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #get(tenantId: string, checkId: string): Promise<RightToStudyDto> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(rightToStudyChecks).where(and(
      eq(rightToStudyChecks.tenantId, tenantId as Uuid), eq(rightToStudyChecks.id, checkId as Uuid), isNull(rightToStudyChecks.recordedUntil),
    )).limit(1));
    if (!row) throw new NotFoundError('Right to study check', checkId);
    return toDto(row);
  }

  async #version(tenantId: string, current: RightToStudyDto, change: Partial<{ outcomeCode: RightToStudyOutcome; note: string; checkedBy: string; checkedAt: Date; shareCode: string | null }>, actorId?: string): Promise<RightToStudyDto> {
    void actorId;
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(rightToStudyChecks).where(and(eq(rightToStudyChecks.id, current.checkId as Uuid), isNull(rightToStudyChecks.recordedUntil))).limit(1);
      if (!row) throw new NotFoundError('Right to study check', current.checkId);
      await tx.update(rightToStudyChecks).set({ recordedUntil: now, validTo: now }).where(eq(rightToStudyChecks.versionId, row.versionId));
      const { versionId: _v, recordedUntil: _ru, validTo: _vt, ...rest } = row;
      await tx.insert(rightToStudyChecks).values({ ...rest, ...change, versionId: randomUUID(), validFrom: now, recordedAt: now });
    });
    return this.#get(tenantId, current.checkId);
  }

  async #sponsored(tenantId: string, personId: string, assignedOnly = false): Promise<boolean> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: casCases.id }).from(casCases).where(and(
      eq(casCases.tenantId, tenantId as Uuid), eq(casCases.personId, personId as Uuid), isNull(casCases.recordedUntil),
      assignedOnly ? eq(casCases.statusCode, 'assigned') : ne(casCases.statusCode, 'withdrawn'),
    )).limit(1));
    return Boolean(row);
  }

  async #currentEnrolment(tenantId: string, personId: string): Promise<string | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: enrolments.id }).from(enrolments).where(and(
      eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.personId, personId as Uuid), isNull(enrolments.recordedUntil),
      inArray(enrolments.statusCode, ['enrolled', 'intermitting', 'suspended', 'pre-registration']),
    )).orderBy(desc(enrolments.startDate)).limit(1));
    return row?.id ?? null;
  }

  async #settings(tenantId: string): Promise<{ scope: RightToStudyScope; expiryWarningDays: number }> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const c = (row?.configuration?.['rightToStudy'] ?? {}) as Record<string, unknown>;
    const scope = c['scope'] === 'sponsored' || c['scope'] === 'none' ? c['scope'] : 'all';
    const days = c['expiryWarningDays'];
    return { scope, expiryWarningDays: typeof days === 'number' && days >= 0 ? days : 60 };
  }

  async #code(tenantId: string, field: string, value: string): Promise<void> {
    if (!(await this.valueSets.validateFieldValue('right_to_study_check', field, value, tenantId))) {
      throw new ValidationError(`Invalid ${field.replace(/_code$/, '').replace(/_/g, ' ')} '${value}'`);
    }
  }
}

function toDto(r: RightToStudyCheck): RightToStudyDto {
  return {
    checkId: r.id, personId: r.personId, enrolmentId: r.enrolmentId, casCaseId: r.casCaseId,
    basisCode: r.basisCode, methodCode: r.methodCode, outcomeCode: r.outcomeCode as RightToStudyOutcome,
    checkedBy: r.checkedBy, checkedAt: r.checkedAt, permissionExpiresOn: r.permissionExpiresOn, ukEntryDate: r.ukEntryDate,
    restrictionCode: r.restrictionCode, evidenceRef: r.evidenceRef, identityVerificationCheckId: r.identityVerificationCheckId,
    recheckDueOn: r.recheckDueOn, shareCodeSubmitted: Boolean(r.shareCode), note: r.note,
  };
}
