import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  engagementActions, engagementAlerts, engagementContactAttempts, engagementInterventionCases,
  engagementReferrals, type Db, withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError, EVENT_TYPES, NotFoundError, ValidationError,
  type EngagementInterventionClosedV1Payload, type EngagementInterventionOpenedV1Payload,
  type EngagementInterventionReviewedV1Payload, type EngagementReferralCreatedV1Payload,
} from '@revelation-srs/domain';

import { clockNow } from '../clock.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface TriageAlertInput {
  decision: 'no-action' | 'open-intervention';
  assignedRoleCode?: string;
  assignedActorId?: string;
  dueAt?: string;
  reasonCode: string;
}
export interface RecordContactInput {
  channelCode: 'email' | 'telephone' | 'sms' | 'portal' | 'in-person' | 'letter';
  attemptedAt: string;
  outcomeCode: 'no-response' | 'contacted' | 'response-received' | 'wrong-contact-details';
  communicationLocale?: string;
  operationalNote?: string;
}
export interface AddActionInput {
  actionTypeCode: string;
  operationalInstruction?: string;
  ownerRoleCode?: string;
  ownerActorId?: string;
  dueAt?: string;
}
export interface ReviewCaseInput {
  expectedVersionId: string;
  decision: 'continue' | 'close' | 'refer';
  outcomeCode?: string;
  reviewAt: string;
  nextDueAt?: string;
  referral?: {
    targetServiceCode: 'wellbeing' | 'safeguarding' | 'academic-status-review' | 'sponsor-compliance-review';
    referralTypeCode: 'support-request' | 'immediate-risk' | 'status-review' | 'compliance-review';
    externalReference?: string;
  };
}

export class EngagementInterventionService {
  constructor(private readonly db: Db, private readonly eventBus: IntegrationBusPublisher) {}

  async triage(
    alertId: string, tenantId: string, input: TriageAlertInput, idempotencyKey: string,
    actorId: string, correlationId: string,
  ): Promise<{ interventionCaseId: string | null; created: boolean; alertStatusCode: string }> {
    this.#key(idempotencyKey);
    const duplicate = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementInterventionCases).where(and(
        eq(engagementInterventionCases.tenantId, tenantId as Uuid),
        eq(engagementInterventionCases.idempotencyKey, idempotencyKey),
      )).limit(1),
    );
    if (duplicate[0]) {
      return { interventionCaseId: duplicate[0].id, created: false, alertStatusCode: 'intervention-opened' };
    }
    const alerts = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementAlerts).where(and(
        eq(engagementAlerts.tenantId, tenantId as Uuid), eq(engagementAlerts.id, alertId as Uuid),
        isNull(engagementAlerts.recordedUntil),
      )).limit(1),
    );
    const alert = alerts[0];
    if (!alert) throw new NotFoundError('Engagement alert', alertId);
    if (input.decision === 'no-action') {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(engagementAlerts)
        .set({ statusCode: 'triaged-no-action', actorId })
        .where(and(eq(engagementAlerts.tenantId, tenantId as Uuid), eq(engagementAlerts.id, alertId as Uuid))));
      return { interventionCaseId: null, created: false, alertStatusCode: 'triaged-no-action' };
    }
    if (alert.statusCode === 'suspended-reconciliation' || alert.reevaluationRequired) {
      throw new ConflictError('Alert requires evidence reconciliation before intervention');
    }
    if (!input.assignedRoleCode || !input.dueAt) {
      throw new ValidationError('assignedRoleCode and dueAt are required to open an intervention');
    }
    const dueAt = this.#date(input.dueAt, 'dueAt');
    const now = clockNow();
    const caseId = randomUUID();
    const versionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(engagementInterventionCases).values({
        versionId, id: caseId, tenantId: tenantId as Uuid, alertId: alertId as Uuid,
        personId: alert.personId, enrolmentId: alert.enrolmentId, statusCode: 'open',
        outcomeCode: null, assignedRoleCode: input.assignedRoleCode!,
        assignedActorId: input.assignedActorId ?? null, workflowInstanceId: randomUUID(),
        correlationId: this.#uuid(correlationId), openedAt: now, reviewAt: null, dueAt, closedAt: null,
        actorId, idempotencyKey, validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
      });
      await tx.update(engagementAlerts).set({ statusCode: 'intervention-opened', actorId })
        .where(and(eq(engagementAlerts.tenantId, tenantId as Uuid), eq(engagementAlerts.id, alertId as Uuid)));
    });
    if (this.eventBus.isConnected()) {
      const payload: EngagementInterventionOpenedV1Payload = {
        interventionCaseId: caseId, alertId, personId: alert.personId, enrolmentId: alert.enrolmentId,
        assignedRoleCode: input.assignedRoleCode, dueAt: dueAt.toISOString(),
      };
      await this.eventBus.publish(EVENT_TYPES.ENGAGEMENT_INTERVENTION_OPENED, '1.0.0', tenantId,
        correlationId, 'sensitive', payload, { validAt: now });
    }
    return { interventionCaseId: caseId, created: true, alertStatusCode: 'intervention-opened' };
  }

  async recordContact(
    caseId: string, tenantId: string, input: RecordContactInput, idempotencyKey: string, actorId: string,
  ): Promise<{ contactAttemptId: string; created: boolean }> {
    this.#key(idempotencyKey);
    if (input.operationalNote && this.#restrictedNarrative(input.operationalNote)) {
      throw new ValidationError('Operational notes must not contain restricted health, disability or safeguarding narrative');
    }
    await this.#currentCase(caseId, tenantId);
    const existing = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: engagementContactAttempts.id }).from(engagementContactAttempts).where(and(
        eq(engagementContactAttempts.tenantId, tenantId as Uuid),
        eq(engagementContactAttempts.idempotencyKey, idempotencyKey),
      )).limit(1),
    );
    if (existing[0]) return { contactAttemptId: existing[0].id, created: false };
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(engagementContactAttempts).values({
      id, tenantId: tenantId as Uuid, interventionCaseId: caseId as Uuid,
      channelCode: input.channelCode, attemptedAt: this.#date(input.attemptedAt, 'attemptedAt'),
      outcomeCode: input.outcomeCode, communicationLocale: input.communicationLocale ?? null,
      operationalNote: input.operationalNote ?? null, dataClassification: 'sensitive-personal',
      actorId, idempotencyKey, createdAt: clockNow(),
    }));
    return { contactAttemptId: id, created: true };
  }

  async addAction(
    caseId: string, tenantId: string, input: AddActionInput, idempotencyKey: string, actorId: string,
  ): Promise<{ actionId: string; created: boolean }> {
    this.#key(idempotencyKey);
    await this.#currentCase(caseId, tenantId);
    const existing = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: engagementActions.id }).from(engagementActions).where(and(
        eq(engagementActions.tenantId, tenantId as Uuid), eq(engagementActions.idempotencyKey, idempotencyKey),
      )).limit(1),
    );
    if (existing[0]) return { actionId: existing[0].id, created: false };
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(engagementActions).values({
      id, tenantId: tenantId as Uuid, interventionCaseId: caseId as Uuid,
      actionTypeCode: input.actionTypeCode, operationalInstruction: input.operationalInstruction ?? null,
      ownerRoleCode: input.ownerRoleCode ?? null, ownerActorId: input.ownerActorId ?? null,
      dueAt: input.dueAt ? this.#date(input.dueAt, 'dueAt') : null,
      completedAt: null, completedBy: null, createdBy: actorId, idempotencyKey, createdAt: clockNow(),
    }));
    return { actionId: id, created: true };
  }

  async review(
    caseId: string, tenantId: string, input: ReviewCaseInput, idempotencyKey: string,
    actorId: string, correlationId: string,
  ): Promise<{ interventionCaseId: string; versionId: string; statusCode: string; referralId?: string; created: boolean }> {
    this.#key(idempotencyKey);
    const current = await this.#currentCase(caseId, tenantId);
    const duplicate = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementInterventionCases).where(and(
        eq(engagementInterventionCases.tenantId, tenantId as Uuid),
        eq(engagementInterventionCases.idempotencyKey, idempotencyKey),
      )).limit(1),
    );
    if (duplicate[0]) {
      return { interventionCaseId: caseId, versionId: duplicate[0].versionId, statusCode: duplicate[0].statusCode, created: false };
    }
    if (current.versionId !== input.expectedVersionId) throw new ConflictError('Intervention case version has changed');
    const reviewAt = this.#date(input.reviewAt, 'reviewAt');
    const closed = input.decision === 'close';
    if (closed && !input.outcomeCode) throw new ValidationError('outcomeCode is required to close a case');
    if (input.decision === 'refer' && !input.referral) throw new ValidationError('referral is required for a referral decision');
    const statusCode = closed ? 'closed' : input.decision === 'refer' ? 'referred' : 'review-due';
    const now = clockNow();
    const versionId = randomUUID();
    let referralId: string | undefined;
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(engagementInterventionCases).set({ recordedUntil: now }).where(and(
        eq(engagementInterventionCases.tenantId, tenantId as Uuid),
        eq(engagementInterventionCases.id, caseId as Uuid), isNull(engagementInterventionCases.recordedUntil),
        eq(engagementInterventionCases.versionId, input.expectedVersionId as Uuid),
      )).returning({ id: engagementInterventionCases.id });
      if (!updated[0]) throw new ConflictError('Intervention case was changed concurrently');
      await tx.insert(engagementInterventionCases).values({
        versionId, id: caseId as Uuid, tenantId: tenantId as Uuid, alertId: current.alertId,
        personId: current.personId, enrolmentId: current.enrolmentId, statusCode,
        outcomeCode: closed ? input.outcomeCode! : null, assignedRoleCode: current.assignedRoleCode,
        assignedActorId: current.assignedActorId, workflowInstanceId: current.workflowInstanceId,
        correlationId: this.#uuid(correlationId), openedAt: current.openedAt, reviewAt,
        dueAt: input.nextDueAt ? this.#date(input.nextDueAt, 'nextDueAt') : current.dueAt,
        closedAt: closed ? now : null, actorId, idempotencyKey, validFrom: now, validTo: null,
        recordedAt: now, recordedUntil: null,
      });
      if (input.decision === 'refer' && input.referral) {
        referralId = randomUUID();
        await tx.insert(engagementReferrals).values({
          id: referralId, tenantId: tenantId as Uuid, interventionCaseId: caseId as Uuid,
          targetServiceCode: input.referral.targetServiceCode, referralTypeCode: input.referral.referralTypeCode,
          statusCode: 'pending', externalReference: input.referral.externalReference ?? null,
          integrationExchangeId: null, correlationId: this.#uuid(correlationId), referredBy: actorId,
          referredAt: now, acknowledgedAt: null, idempotencyKey,
        });
      }
    });
    await this.#publishReview(current.personId, caseId, statusCode, input.outcomeCode, reviewAt,
      referralId, input.referral, tenantId, correlationId, now);
    return { interventionCaseId: caseId, versionId, statusCode, ...(referralId ? { referralId } : {}), created: true };
  }

  async getCase(caseId: string, tenantId: string) {
    const intervention = await this.#currentCase(caseId, tenantId);
    const related = await withTenantContext(this.db, tenantId, async (tx) => {
      const [contacts, actions, referrals] = await Promise.all([
        tx.select().from(engagementContactAttempts).where(and(
          eq(engagementContactAttempts.tenantId, tenantId as Uuid),
          eq(engagementContactAttempts.interventionCaseId, caseId as Uuid),
        )).orderBy(asc(engagementContactAttempts.attemptedAt)),
        tx.select().from(engagementActions).where(and(
          eq(engagementActions.tenantId, tenantId as Uuid), eq(engagementActions.interventionCaseId, caseId as Uuid),
        )).orderBy(asc(engagementActions.createdAt)),
        tx.select().from(engagementReferrals).where(and(
          eq(engagementReferrals.tenantId, tenantId as Uuid), eq(engagementReferrals.interventionCaseId, caseId as Uuid),
        )).orderBy(asc(engagementReferrals.referredAt)),
      ]);
      return { contacts, actions, referrals };
    });
    return { intervention, ...related };
  }

  async #currentCase(caseId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementInterventionCases).where(and(
        eq(engagementInterventionCases.tenantId, tenantId as Uuid),
        eq(engagementInterventionCases.id, caseId as Uuid), isNull(engagementInterventionCases.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Engagement intervention case', caseId);
    return rows[0];
  }
  async #publishReview(
    personId: string, caseId: string, statusCode: string, outcomeCode: string | undefined,
    reviewAt: Date, referralId: string | undefined, referral: ReviewCaseInput['referral'],
    tenantId: string, correlationId: string, now: Date,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    const reviewed: EngagementInterventionReviewedV1Payload = {
      interventionCaseId: caseId, personId, statusCode, reviewAt: reviewAt.toISOString(),
      ...(outcomeCode ? { outcomeCode } : {}),
    };
    await this.eventBus.publish(EVENT_TYPES.ENGAGEMENT_INTERVENTION_REVIEWED, '1.0.0', tenantId,
      correlationId, 'sensitive', reviewed, { validAt: reviewAt });
    if (referralId && referral) {
      const referred: EngagementReferralCreatedV1Payload = {
        referralId, interventionCaseId: caseId, personId, targetServiceCode: referral.targetServiceCode,
        referralTypeCode: referral.referralTypeCode, statusCode: 'pending',
      };
      await this.eventBus.publish(EVENT_TYPES.ENGAGEMENT_REFERRAL_CREATED, '1.0.0', tenantId,
        correlationId, 'sensitive', referred, { validAt: now });
    }
    if (statusCode === 'closed' && outcomeCode) {
      const closed: EngagementInterventionClosedV1Payload = {
        interventionCaseId: caseId, personId, outcomeCode, closedAt: now.toISOString(),
      };
      await this.eventBus.publish(EVENT_TYPES.ENGAGEMENT_INTERVENTION_CLOSED, '1.0.0', tenantId,
        correlationId, 'sensitive', closed, { validAt: now });
    }
  }
  #key(value: string): void {
    if (!value.trim()) throw new ValidationError('Idempotency-Key header is required');
  }
  #date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) throw new ValidationError(`${field} must be an ISO 8601 date-time`);
    return date;
  }
  #uuid(value: string): Uuid {
    return /^[0-9a-f-]{36}$/i.test(value) ? value as Uuid : randomUUID();
  }
  #restrictedNarrative(value: string): boolean {
    return /\b(diagnos|medical|medication|disab|safeguard|self[- ]?harm|suicid|mental health)\b/i.test(value);
  }
}
