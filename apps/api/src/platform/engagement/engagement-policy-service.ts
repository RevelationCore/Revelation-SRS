import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  engagementAlerts, engagementObservations, engagementPolicyVersions, enrolments,
  expectedEngagementEvents, type Db, withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES, NotFoundError, ValidationError,
  type EngagementAlertRaisedV1Payload, type EngagementAlertSuspendedV1Payload,
} from '@revelation-srs/domain';

import { clockNow } from '../clock.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface CreateEngagementPolicyInput {
  policyCode: string; versionNumber: number; displayName: string;
  statusCode: 'draft' | 'approved'; validFrom: string; validTo?: string;
  applicability?: Record<string, unknown>; evidenceWindowDays: number;
  minimumExpectedEvents: number; minimumAbsenceCount: number;
  minimumAbsenceRate: number; severityCode: 'low' | 'medium' | 'high';
  reviewDeadlineDays: number;
}
export interface EvaluateEngagementInput {
  policyVersionId: string; personId: string; enrolmentId: string;
  evidenceWindowFrom: string; evidenceWindowTo: string;
}
export interface EngagementPolicyDto {
  policyVersionId: string; policyId: string; policyCode: string; versionNumber: number;
  displayName: string; statusCode: string; validFrom: Date; validTo: Date | null;
  applicability: Record<string, unknown>; evidenceWindow: Record<string, unknown>;
  alertRules: Record<string, unknown>; reviewDeadline: Record<string, unknown>;
  approvedBy: string | null; approvedAt: Date | null;
}
export interface EngagementAlertDto {
  alertId: string; personId: string; enrolmentId: string; policyVersionId: string;
  evidenceWindowFrom: Date; evidenceWindowTo: Date; evidenceSnapshot: Record<string, unknown>;
  evidenceHash: string; explanation: Record<string, unknown>; severityCode: string;
  statusCode: string; reevaluationRequired: boolean; recordedAt: Date;
}
interface Rules {
  minimumExpectedEvents: number; minimumAbsenceCount: number;
  minimumAbsenceRate: number; severityCode: string;
}

export class EngagementPolicyService {
  constructor(private readonly db: Db, private readonly eventBus: IntegrationBusPublisher) {}

  async createPolicy(tenantId: string, input: CreateEngagementPolicyInput, actorId: string): Promise<EngagementPolicyDto> {
    const validFrom = this.#date(input.validFrom, 'validFrom');
    const validTo = input.validTo ? this.#date(input.validTo, 'validTo') : null;
    if (validTo && validTo <= validFrom) throw new ValidationError('validTo must be after validFrom');
    for (const [field, value] of [
      ['versionNumber', input.versionNumber], ['evidenceWindowDays', input.evidenceWindowDays],
      ['minimumExpectedEvents', input.minimumExpectedEvents], ['minimumAbsenceCount', input.minimumAbsenceCount],
      ['reviewDeadlineDays', input.reviewDeadlineDays],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) throw new ValidationError(`${field} must be a positive integer`);
    }
    if (input.minimumAbsenceRate < 0 || input.minimumAbsenceRate > 1) {
      throw new ValidationError('minimumAbsenceRate must be between 0 and 1');
    }
    const now = clockNow();
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(engagementPolicyVersions).values({
        versionId: randomUUID(), id: randomUUID(), tenantId: tenantId as Uuid,
        policyCode: input.policyCode, versionNumber: input.versionNumber, displayName: input.displayName,
        statusCode: input.statusCode, applicability: input.applicability ?? {},
        evidenceWindow: { durationDays: input.evidenceWindowDays },
        alertRules: {
          minimumExpectedEvents: input.minimumExpectedEvents, minimumAbsenceCount: input.minimumAbsenceCount,
          minimumAbsenceRate: input.minimumAbsenceRate, severityCode: input.severityCode,
        },
        reviewDeadline: { durationDays: input.reviewDeadlineDays },
        approvedBy: input.statusCode === 'approved' ? actorId : null,
        approvedAt: input.statusCode === 'approved' ? now : null,
        actorId, validFrom, validTo, recordedAt: now, recordedUntil: null,
      }).returning(),
    );
    return this.#policy(rows[0]!);
  }

  async listPolicies(tenantId: string, policyCode?: string): Promise<EngagementPolicyDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementPolicyVersions).where(and(
        eq(engagementPolicyVersions.tenantId, tenantId as Uuid), isNull(engagementPolicyVersions.recordedUntil),
        policyCode ? eq(engagementPolicyVersions.policyCode, policyCode) : undefined,
      )).orderBy(asc(engagementPolicyVersions.policyCode), asc(engagementPolicyVersions.versionNumber)),
    );
    return rows.map((row) => this.#policy(row));
  }

  async evaluate(
    tenantId: string, input: EvaluateEngagementInput, actorId: string, correlationId: string,
  ): Promise<{ matched: boolean; alertCreated: boolean; alert: EngagementAlertDto | null }> {
    const from = this.#date(input.evidenceWindowFrom, 'evidenceWindowFrom');
    const to = this.#date(input.evidenceWindowTo, 'evidenceWindowTo');
    if (to <= from) throw new ValidationError('evidenceWindowTo must be after evidenceWindowFrom');
    const policy = await this.#approvedPolicy(input.policyVersionId, tenantId, to);
    const configuredWindowDays = Number(policy.evidenceWindow['durationDays']);
    const requestedWindowDays = (to.valueOf() - from.valueOf()) / 86_400_000;
    if (!Number.isFinite(configuredWindowDays) || requestedWindowDays > configuredWindowDays) {
      throw new ValidationError('Evidence window exceeds the approved policy duration');
    }
    await this.#ensureEnrolment(input.enrolmentId, input.personId, tenantId);
    const rules = this.#rules(policy.alertRules);
    const evidence = await withTenantContext(this.db, tenantId, async (tx) => {
      const events = await tx.select().from(expectedEngagementEvents).where(and(
        eq(expectedEngagementEvents.tenantId, tenantId as Uuid),
        eq(expectedEngagementEvents.personId, input.personId as Uuid),
        eq(expectedEngagementEvents.enrolmentId, input.enrolmentId as Uuid),
        isNull(expectedEngagementEvents.recordedUntil), gte(expectedEngagementEvents.scheduledFrom, from),
        lte(expectedEngagementEvents.scheduledFrom, to),
      )).orderBy(asc(expectedEngagementEvents.scheduledFrom));
      const ids = events.map((event) => event.id);
      const observations = ids.length === 0 ? [] : await tx.select().from(engagementObservations).where(and(
        eq(engagementObservations.tenantId, tenantId as Uuid),
        inArray(engagementObservations.expectedEventId, ids as Uuid[]),
        isNull(engagementObservations.recordedUntil),
      ));
      return { events, observations };
    });
    const observationByEvent = new Map(evidence.observations.map((row) => [row.expectedEventId, row]));
    const unsafeCodes = new Set(['missing', 'duplicate', 'disputed', 'conflicting', 'quarantined']);
    const items = evidence.events.map((event) => {
      const observation = observationByEvent.get(event.id);
      return {
        expectedEventId: event.id, scheduledFrom: event.scheduledFrom.toISOString(),
        observationVersionId: observation?.versionId ?? null, outcomeCode: observation?.outcomeCode ?? null,
        dataQualityCode: observation?.dataQualityCode ?? 'missing',
      };
    });
    const absenceCount = items.filter((item) => item.outcomeCode === 'absent' || item.outcomeCode === 'not-captured').length;
    const unsafeEvidenceCount = items.filter((item) => unsafeCodes.has(item.dataQualityCode)).length;
    const absenceRate = items.length === 0 ? 0 : absenceCount / items.length;
    const matched = items.length >= rules.minimumExpectedEvents
      && absenceCount >= rules.minimumAbsenceCount && absenceRate >= rules.minimumAbsenceRate;
    if (!matched) return { matched: false, alertCreated: false, alert: null };
    const snapshot = {
      schemaVersion: 1, expectedEventCount: items.length, absenceCount, absenceRate, unsafeEvidenceCount, items,
    };
    const evidenceHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const explanation = {
      policyCode: policy.policyCode, policyVersion: policy.versionNumber, rules,
      facts: { expectedEventCount: items.length, absenceCount, absenceRate, unsafeEvidenceCount },
      decision: unsafeEvidenceCount > 0 ? 'reconciliation-required' : 'human-review-required',
      automatedAdverseActionPermitted: false,
    };
    const existing = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementAlerts).where(and(
        eq(engagementAlerts.tenantId, tenantId as Uuid), eq(engagementAlerts.personId, input.personId as Uuid),
        eq(engagementAlerts.policyVersionId, input.policyVersionId as Uuid),
        eq(engagementAlerts.evidenceWindowFrom, from), eq(engagementAlerts.evidenceWindowTo, to),
        eq(engagementAlerts.evidenceHash, evidenceHash), isNull(engagementAlerts.recordedUntil),
      )).limit(1),
    );
    if (existing[0]) return { matched: true, alertCreated: false, alert: this.#alert(existing[0]) };
    const statusCode = unsafeEvidenceCount > 0 ? 'suspended-reconciliation' : 'open';
    const now = clockNow();
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(engagementAlerts).values({
        versionId: randomUUID(), id: randomUUID(), tenantId: tenantId as Uuid,
        personId: input.personId as Uuid, enrolmentId: input.enrolmentId as Uuid,
        policyVersionId: input.policyVersionId as Uuid, evidenceWindowFrom: from, evidenceWindowTo: to,
        evidenceSnapshot: snapshot, evidenceHash, explanation, severityCode: rules.severityCode,
        statusCode, reevaluationRequired: unsafeEvidenceCount > 0, actorId,
        validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
      }).returning(),
    );
    const alert = this.#alert(rows[0]!);
    if (this.eventBus.isConnected()) {
      const common: EngagementAlertRaisedV1Payload = {
        alertId: alert.alertId, personId: alert.personId, enrolmentId: alert.enrolmentId,
        policyVersionId: alert.policyVersionId, evidenceHash, evidenceWindowFrom: from.toISOString(),
        evidenceWindowTo: to.toISOString(), severityCode: rules.severityCode, statusCode,
      };
      const payload: EngagementAlertRaisedV1Payload | EngagementAlertSuspendedV1Payload =
        statusCode === 'suspended-reconciliation' ? { ...common, reasonCode: 'unsafe-evidence-quality' } : common;
      await this.eventBus.publish(
        statusCode === 'suspended-reconciliation' ? EVENT_TYPES.ENGAGEMENT_ALERT_SUSPENDED : EVENT_TYPES.ENGAGEMENT_ALERT_RAISED,
        '1.0.0', tenantId, correlationId, 'sensitive', payload, { validAt: now },
      );
    }
    return { matched: true, alertCreated: true, alert };
  }

  async listAlerts(tenantId: string, filter: { personId?: string; statusCode?: string }): Promise<EngagementAlertDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementAlerts).where(and(
        eq(engagementAlerts.tenantId, tenantId as Uuid), isNull(engagementAlerts.recordedUntil),
        filter.personId ? eq(engagementAlerts.personId, filter.personId as Uuid) : undefined,
        filter.statusCode ? eq(engagementAlerts.statusCode, filter.statusCode) : undefined,
      )).orderBy(asc(engagementAlerts.evidenceWindowTo)),
    );
    return rows.map((row) => this.#alert(row));
  }

  async #approvedPolicy(id: string, tenantId: string, at: Date): Promise<EngagementPolicyDto> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementPolicyVersions).where(and(
        eq(engagementPolicyVersions.tenantId, tenantId as Uuid), eq(engagementPolicyVersions.versionId, id as Uuid),
        eq(engagementPolicyVersions.statusCode, 'approved'), lte(engagementPolicyVersions.validFrom, at),
        isNull(engagementPolicyVersions.recordedUntil),
      )).limit(1),
    );
    if (!rows[0] || (rows[0].validTo && rows[0].validTo <= at)) throw new NotFoundError('Approved engagement policy version', id);
    return this.#policy(rows[0]);
  }
  async #ensureEnrolment(id: string, personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.id, id as Uuid),
        eq(enrolments.personId, personId as Uuid), isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', id);
  }
  #rules(value: Record<string, unknown>): Rules {
    const valueRules = value as Partial<Rules>;
    if (typeof valueRules.minimumExpectedEvents !== 'number' || typeof valueRules.minimumAbsenceCount !== 'number'
      || typeof valueRules.minimumAbsenceRate !== 'number' || typeof valueRules.severityCode !== 'string') {
      throw new ValidationError('Policy alert rules are invalid');
    }
    return valueRules as Rules;
  }
  #date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) throw new ValidationError(`${field} must be an ISO 8601 date-time`);
    return date;
  }
  #policy(row: typeof engagementPolicyVersions.$inferSelect): EngagementPolicyDto {
    return {
      policyVersionId: row.versionId, policyId: row.id, policyCode: row.policyCode, versionNumber: row.versionNumber,
      displayName: row.displayName, statusCode: row.statusCode, validFrom: row.validFrom, validTo: row.validTo,
      applicability: row.applicability, evidenceWindow: row.evidenceWindow, alertRules: row.alertRules,
      reviewDeadline: row.reviewDeadline, approvedBy: row.approvedBy, approvedAt: row.approvedAt,
    };
  }
  #alert(row: typeof engagementAlerts.$inferSelect): EngagementAlertDto {
    return {
      alertId: row.id, personId: row.personId, enrolmentId: row.enrolmentId, policyVersionId: row.policyVersionId,
      evidenceWindowFrom: row.evidenceWindowFrom, evidenceWindowTo: row.evidenceWindowTo,
      evidenceSnapshot: row.evidenceSnapshot, evidenceHash: row.evidenceHash, explanation: row.explanation,
      severityCode: row.severityCode, statusCode: row.statusCode, reevaluationRequired: row.reevaluationRequired,
      recordedAt: row.recordedAt,
    };
  }
}
