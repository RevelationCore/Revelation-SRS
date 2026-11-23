import { createHash } from 'node:crypto';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  enrolmentDownstreamTriggers,
  enrolmentStatusTransitions,
  enrolments,
  feeLiabilities,
  integrationExchanges,
  slcNotifications,
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowInstances,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatorySlcConfirmationSentV1Payload,
  type RegulatorySlcNotificationReceivedV1Payload,
} from '@revelation-srs/domain';

import type { EnrolmentService } from '../enrolment/service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import { GovernedReview, type ReviewEffectInput } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const SUBMISSION_WORKFLOW_CODE = 'slc-confirmation-submission-approval';
const SUBMISSION_DECISION_STEP_KEY = 'approve-or-reject-submission';
const SUBMISSION_GATEWAY_KEY = 'G01';

export interface SubmissionRequestDto {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  recordCount:         number;
  context:             Record<string, unknown>;
  startedAt:           Date;
}

export interface SlcConfirmationRecord {
  triggerId: string;
  enrolmentId: string;
  slcReference: string;
  programmeId: string | null;
  modeOfStudyCode: string;
  confirmationType: 'enrolment' | 'withdrawal' | 'intermission' | 'resumption';
  feeAmount: string | null;
  startDate: string;
  expectedEndDate: string | null;
}

export interface SlcConfirmationPayload {
  confirmations: SlcConfirmationRecord[];
}

export interface SlcNotificationInput {
  enrolmentId: string;
  notificationTypeCode: string;
  effectiveDate: string;
  amount?: string | number | null;
  rawPayload?: Record<string, unknown>;
  idempotencyKey?: string;
  notificationId?: string;
}

export interface SlcNotificationDto {
  notificationId: string;
  enrolmentId: string;
  notificationTypeCode: string;
  effectiveDate: string;
  amount: string | null;
  receivedAt: Date;
}

export interface SlcExchangeStatusDto {
  exchangeId: string;
  directionCode: string;
  exchangeTypeCode: string;
  idempotencyKey: string;
  statusCode: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

export class SlcService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
    private readonly enrolmentService: EnrolmentService,
    exchanges?: RegulatoryExchangeService,
    private readonly workflowBridge?: WorkflowBridgeService,
    private readonly reviewExecution?: ReviewExecutionService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  #submissionReview(): GovernedReview {
    if (!this.workflowBridge) throw new ValidationError('SLC submission workflow is not configured');
    return new GovernedReview(this.workflowBridge, this.reviewExecution, {
      workflowCode: SUBMISSION_WORKFLOW_CODE,
      stepKey: SUBMISSION_DECISION_STEP_KEY,
      gatewayKey: SUBMISSION_GATEWAY_KEY,
      outcomeStepKey: 'request-closed',
      assigneeRoleCode: 'regulatory-officer',
      subjectEntityType: 'slc_confirmation_batch',
      effectDecisionCodes: ['approved'],
    });
  }

  /** On Temporal-run requests the worker submits the snapshotted batch before the review closes. */
  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    if (!this.workflowBridge) return;
    this.#submissionReview().register(activities, (input) => this.#applySubmissionApproval(input));
  }

  /**
   * Submits exactly the snapshotted trigger set. Only triggers still pending
   * are processed, so a retried effect sends nothing twice.
   */
  async #applySubmissionApproval(input: ReviewEffectInput): Promise<Record<string, unknown>> {
    const triggerIds = input.context['triggerIds'] as string[];
    const result = await this.generateConfirmations(input.tenantId, input.actorId, { dryRun: false, triggerIds });
    return { processedCount: result.processedCount };
  }

  async generateConfirmations(
    tenantId: string,
    actorId: string,
    opts: { dryRun?: boolean; triggerIds?: string[] } = {},
  ): Promise<{ processedCount: number; payload: SlcConfirmationPayload }> {
    const now = clockNow();
    const confirmations: SlcConfirmationRecord[] = [];

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          trigger: enrolmentDownstreamTriggers,
          enrolment: enrolments,
          fee: feeLiabilities,
        })
        .from(enrolmentDownstreamTriggers)
        .innerJoin(
          enrolments,
          and(
            eq(enrolments.id, enrolmentDownstreamTriggers.enrolmentId),
            eq(enrolments.tenantId, tenantId),
            isNull(enrolments.recordedUntil),
          ),
        )
        .leftJoin(
          feeLiabilities,
          and(
            eq(feeLiabilities.enrolmentId, enrolments.id),
            eq(feeLiabilities.tenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(enrolmentDownstreamTriggers.tenantId, tenantId),
            eq(enrolmentDownstreamTriggers.triggerTypeCode, 'slc-confirmation'),
            eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
            ...(opts.triggerIds ? [inArray(enrolmentDownstreamTriggers.id, opts.triggerIds as Uuid[])] : []),
          ),
        ),
    );

    const seenTriggers = new Set<string>();
    for (const row of rows) {
      if (seenTriggers.has(row.trigger.id)) continue;
      seenTriggers.add(row.trigger.id);

      const record = buildConfirmationRecord(row.trigger.id, row.enrolment, row.fee,
        (row.trigger.payloadSummary)?.['notificationType'] === 'resumption');
      confirmations.push(record);

      if (opts.dryRun) continue;

      const exchange = await this.exchanges.recordExchange(
        tenantId,
        'slc-enrolment-exchange.v1',
        {
          directionCode: 'outbound',
          exchangeTypeCode: 'slc-confirmation',
          idempotencyKey: `slc-confirmation:${row.trigger.id}`,
          payloadHash: hashPayload(record),
          payloadSummary: { ...record },
          sentAt: now,
        },
        actorId,
      );

      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx
          .update(enrolmentDownstreamTriggers)
          .set({ statusCode: 'processed', sentAt: now })
          .where(
            and(
              eq(enrolmentDownstreamTriggers.id, row.trigger.id),
              eq(enrolmentDownstreamTriggers.tenantId, tenantId),
              eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
            ),
          );
      });

      await this.#publishConfirmationSent(tenantId, actorId, {
        enrolmentId: row.enrolment.id,
        confirmationType: record.confirmationType,
        exchangeId: exchange.id,
      });
    }

    return { processedCount: confirmations.length, payload: { confirmations } };
  }

  // ── Submission approval workflow ────────────────────────────────────────────
  // Reference implementation for BPR-W12 (technical debt item: all regulatory
  // submission processes should be workflow-gated rather than a stateless
  // "generate with dryRun" toggle). Unlike the old two-call preview/submit
  // (nothing persisted a batch between the calls, so the submitted set could
  // silently diverge from what was previewed), the previewed trigger IDs are
  // snapshotted into the workflow context and re-used verbatim at decision
  // time — an approver acts on exactly what they saw, not a fresh live query.

  /** Snapshots the current preview and starts an approval workflow for it. */
  async requestSubmission(tenantId: string, requesterId: string, reason?: string): Promise<SubmissionRequestDto> {
    if (!this.workflowBridge) throw new ValidationError('SLC submission workflow is not configured');

    const preview = await this.generateConfirmations(tenantId, requesterId, { dryRun: true });
    if (preview.payload.confirmations.length === 0) {
      throw new ValidationError('No pending SLC confirmations to submit');
    }
    const triggerIds = preview.payload.confirmations.map((c) => c.triggerId);

    const workflowDefinitionVersionId = await this.#getActiveSubmissionWorkflowVersionId(tenantId);
    const started = await this.#submissionReview().start(tenantId, {
      workflowDefinitionVersionId,
      startedBy: requesterId,
      context: { triggerIds, recordCount: triggerIds.length, ...(reason ? { reason } : {}) },
      taskPayload: { triggerIds, recordCount: triggerIds.length },
    });

    return {
      workflowInstanceId: started.workflowInstanceId,
      workflowTaskId: started.workflowTaskId,
      statusCode: 'running',
      recordCount: triggerIds.length,
      context: { triggerIds, recordCount: triggerIds.length },
      startedAt: clockNow(),
    };
  }

  /** Lists pending (running) submission requests for the approval queue. */
  async listPendingSubmissionRequests(tenantId: string): Promise<SubmissionRequestDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ instance: workflowInstances, task: workflowTasks })
        .from(workflowInstances)
        .innerJoin(workflowTasks, and(
          eq(workflowTasks.workflowInstanceId, workflowInstances.id),
          eq(workflowTasks.stepKey, SUBMISSION_DECISION_STEP_KEY),
        ))
        .where(and(
          eq(workflowInstances.tenantId, tenantId as Uuid),
          eq(workflowInstances.workflowCode, SUBMISSION_WORKFLOW_CODE),
          eq(workflowInstances.statusCode, 'running'),
        ))
        .orderBy(desc(workflowInstances.startedAt)),
    );
    return rows.map((r) => ({
      workflowInstanceId: r.instance.id,
      workflowTaskId:      r.task.id,
      statusCode:          r.instance.statusCode,
      recordCount:         Array.isArray(r.instance.context['triggerIds']) ? (r.instance.context['triggerIds'] as unknown[]).length : 0,
      context:             r.instance.context,
      startedAt:           r.instance.startedAt,
    }));
  }

  /**
   * Records the decision. On approval, submits exactly the snapshotted
   * trigger set (not a fresh query) via the existing generateConfirmations
   * path — so items added/removed from the pending queue after the request
   * was submitted don't silently change what gets sent to SLC.
   */
  async decideSubmissionRequest(
    tenantId: string,
    workflowInstanceId: string,
    decisionCode: 'approved' | 'rejected',
    actorId: string,
    reason?: string,
  ): Promise<{ processedCount: number; status: 'applied' } | { processedCount: 0; status: 'pending'; commandId: string }> {
    const review = this.#submissionReview();

    const instance = await this.#getSubmissionInstance(tenantId, workflowInstanceId);
    if (instance.statusCode !== 'running') {
      throw new ValidationError(`Cannot decide a submission request in status '${instance.statusCode}'`);
    }

    const task = await this.#findSubmissionDecisionTask(tenantId, workflowInstanceId);
    const result = await review.decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode, actorId, ...(reason ? { reason } : {}),
      effect: (input) => this.#applySubmissionApproval(input),
    });
    if (result.status === 'pending') return { processedCount: 0, status: 'pending', commandId: result.commandId };
    return { processedCount: (result.result['processedCount'] as number | undefined) ?? 0, status: 'applied' };
  }

  async #getSubmissionInstance(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as Uuid),
        eq(workflowInstances.tenantId, tenantId as Uuid),
        eq(workflowInstances.workflowCode, SUBMISSION_WORKFLOW_CODE),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return rows[0];
  }

  async #findSubmissionDecisionTask(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
        eq(workflowTasks.tenantId, tenantId as Uuid),
        eq(workflowTasks.stepKey, SUBMISSION_DECISION_STEP_KEY),
      )).limit(1),
    );
    return rows[0] ?? null;
  }

  async #getActiveSubmissionWorkflowVersionId(tenantId: string): Promise<string> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ versionId: workflowDefinitionVersions.id })
        .from(workflowDefinitions)
        .innerJoin(
          workflowDefinitionVersions,
          and(
            eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
            eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
          ),
        )
        .where(and(
          eq(workflowDefinitions.definitionCode, SUBMISSION_WORKFLOW_CODE),
          eq(workflowDefinitions.statusCode, 'active'),
          eq(workflowDefinitionVersions.statusCode, 'active'),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', SUBMISSION_WORKFLOW_CODE);
    return rows[0].versionId;
  }

  async generateStatusChangeNotification(
    enrolmentId: string,
    tenantId: string,
    actorId: string,
  ): Promise<SlcConfirmationRecord> {
    const enrolment = await this.enrolmentService.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    if (!enrolment.slcReference) {
      throw new ValidationError('Cannot generate SLC status notification without an SLC reference');
    }

    const feeRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(feeLiabilities)
        .where(and(eq(feeLiabilities.tenantId, tenantId), eq(feeLiabilities.enrolmentId, enrolmentId)))
        .limit(1),
    );

    const record: SlcConfirmationRecord = {
      triggerId: `status:${enrolmentId}`,
      enrolmentId,
      slcReference: enrolment.slcReference,
      programmeId: enrolment.programmeId,
      modeOfStudyCode: enrolment.modeOfStudyCode,
      confirmationType: mapSlcConfirmationType(enrolment.statusCode, await this.#resumed(tenantId, enrolmentId, enrolment.statusCode)),
      feeAmount: formatFeeAmount(feeRows[0]?.amountMinorUnits ?? null),
      startDate: enrolment.startDate,
      expectedEndDate: enrolment.expectedEndDate,
    };

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'slc-enrolment-exchange.v1',
      {
        directionCode: 'outbound',
        exchangeTypeCode: 'slc-status-change',
        idempotencyKey: `slc-status:${enrolmentId}:${enrolment.statusCode}:${record.confirmationType}`,
        payloadHash: hashPayload(record),
        payloadSummary: { ...record },
      },
      actorId,
    );

    await this.#publishConfirmationSent(tenantId, actorId, {
      enrolmentId,
      confirmationType: record.confirmationType,
      exchangeId: exchange.id,
    });

    return record;
  }

  async processInboundNotification(
    tenantId: string,
    notification: SlcNotificationInput,
    actorId: string,
  ): Promise<string> {
    await this.#validateNotificationType(tenantId, notification.notificationTypeCode);

    const enrolment = await this.enrolmentService.getEnrolment(notification.enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', notification.enrolmentId);

    const rawPayload = notification.rawPayload ?? { ...notification };
    const idempotencyKey = notification.idempotencyKey
      ?? notification.notificationId
      ?? `slc-notification:${notification.enrolmentId}:${notification.notificationTypeCode}:${notification.effectiveDate}`;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(slcNotifications)
        .values({
          tenantId,
          enrolmentId: notification.enrolmentId,
          notificationTypeCode: notification.notificationTypeCode,
          effectiveDate: notification.effectiveDate,
          amount: notification.amount === undefined || notification.amount === null
            ? null
            : String(notification.amount),
          rawPayload,
        })
        .returning({ id: slcNotifications.id }),
    );
    const notificationId = rows[0]!.id;

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'slc-enrolment-exchange.v1',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'slc-notification',
        idempotencyKey,
        payloadHash: hashPayload(rawPayload),
        payloadSummary: {
          notificationId,
          enrolmentId: notification.enrolmentId,
          notificationTypeCode: notification.notificationTypeCode,
        },
      },
      actorId,
    );

    await this.#publishNotificationReceived(tenantId, actorId, {
      enrolmentId: notification.enrolmentId,
      notificationTypeCode: notification.notificationTypeCode,
      amount: notification.amount === undefined || notification.amount === null
        ? null
        : String(notification.amount),
      effectiveDate: notification.effectiveDate,
      notificationId,
    });

    void exchange;
    for (const listener of this.#notificationListeners) await listener(tenantId, notification, actorId);
    return notificationId;
  }

  #notificationListeners: Array<(tenantId: string, notification: SlcNotificationInput, actorId: string) => Promise<unknown>> = [];

  /** Something that follows an SLC notification, such as financial registration (D-18). */
  onNotification(listener: (tenantId: string, notification: SlcNotificationInput, actorId: string) => Promise<unknown>): void {
    this.#notificationListeners.push(listener);
  }

  async listNotifications(enrolmentId: string, tenantId: string): Promise<SlcNotificationDto[]> {
    const enrolment = await this.enrolmentService.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(slcNotifications)
        .where(and(eq(slcNotifications.tenantId, tenantId), eq(slcNotifications.enrolmentId, enrolmentId))),
    );

    return rows.map((row) => ({
      notificationId: row.id,
      enrolmentId: row.enrolmentId,
      notificationTypeCode: row.notificationTypeCode,
      effectiveDate: row.effectiveDate,
      amount: row.amount,
      receivedAt: row.receivedAt,
    }));
  }

  async getExchangeStatus(tenantId: string): Promise<SlcExchangeStatusDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(and(eq(integrationExchanges.tenantId, tenantId), eq(integrationExchanges.contractId, 'slc-enrolment-exchange.v1'))),
    );

    return rows.map((row) => ({
      exchangeId: row.id,
      directionCode: row.directionCode,
      exchangeTypeCode: row.exchangeTypeCode,
      idempotencyKey: row.idempotencyKey,
      statusCode: row.statusCode,
      sentAt: row.sentAt,
      receivedAt: row.receivedAt,
      createdAt: row.createdAt,
    }));
  }

  async #validateNotificationType(tenantId: string, notificationTypeCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue(
      'slc_notification',
      'notification_type_code',
      notificationTypeCode,
      tenantId,
    );

    if (isValid === false) {
      throw new ValidationError(
        `Invalid SLC notification type '${notificationTypeCode}'`,
        [{ field: 'notificationTypeCode', message: 'Value is not active in slc-notification-type-code' }],
      );
    }
  }

  async #publishConfirmationSent(
    tenantId: string,
    actorId: string,
    payload: RegulatorySlcConfirmationSentV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_SLC_CONFIRMATION_SENT, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  /** Whether the enrolment's latest status change was a return from interruption or suspension (F3). */
  async #resumed(tenantId: string, enrolmentId: string, statusCode: string): Promise<boolean> {
    if (statusCode !== 'enrolled') return false;
    const [latest] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ from: enrolmentStatusTransitions.fromStatusCode, to: enrolmentStatusTransitions.toStatusCode })
      .from(enrolmentStatusTransitions)
      .where(and(eq(enrolmentStatusTransitions.tenantId, tenantId as Uuid), eq(enrolmentStatusTransitions.enrolmentId, enrolmentId as Uuid)))
      .orderBy(desc(enrolmentStatusTransitions.createdAt)).limit(1));
    return latest?.to === 'enrolled' && ['intermitting', 'suspended'].includes(latest.from);
  }

  async #publishNotificationReceived(
    tenantId: string,
    actorId: string,
    payload: RegulatorySlcNotificationReceivedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_SLC_NOTIFICATION_RECEIVED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }
}

type EnrolmentRow = typeof enrolments.$inferSelect;
type FeeLiabilityRow = typeof feeLiabilities.$inferSelect;

function buildConfirmationRecord(
  triggerId: string,
  enrolment: EnrolmentRow,
  fee: FeeLiabilityRow | null,
  resumed = false,
): SlcConfirmationRecord {
  return {
    triggerId,
    enrolmentId: enrolment.id,
    slcReference: enrolment.slcReference ?? enrolment.id,
    programmeId: enrolment.programmeId,
    modeOfStudyCode: enrolment.modeOfStudyCode,
    confirmationType: mapSlcConfirmationType(enrolment.statusCode, resumed),
    feeAmount: formatFeeAmount(fee?.amountMinorUnits ?? null),
    startDate: enrolment.startDate,
    expectedEndDate: enrolment.expectedEndDate,
  };
}

/** F3 (BL-214): a return to study from interruption or suspension is a resumption, not a new enrolment. */
function mapSlcConfirmationType(statusCode: string, resumed = false): 'enrolment' | 'withdrawal' | 'intermission' | 'resumption' {
  if (resumed && statusCode === 'enrolled') return 'resumption';
  if (statusCode === 'withdrawn') return 'withdrawal';
  if (statusCode === 'intermitting' || statusCode === 'suspended') return 'intermission';
  return 'enrolment';
}

function formatFeeAmount(amountMinorUnits: bigint | null): string | null {
  if (amountMinorUnits === null) return null;
  return (Number(amountMinorUnits) / 100).toFixed(2);
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
