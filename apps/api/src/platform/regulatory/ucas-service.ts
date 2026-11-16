import { createHash, randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  enrolmentDownstreamTriggers,
  enrolments,
  programmes,
  ucasApplications,
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
  type RegulatoryUcasApplicationReceivedV1Payload,
  type RegulatoryUcasConfirmationSentV1Payload,
} from '@revelation-srs/domain';

import type { EnrolmentService } from '../enrolment/service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { AdmissionsService } from '../admissions/admissions-service.js';
import type { ApplicationService, ReceiveApplicationInput } from '../admissions/application-service.js';
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import { GovernedReview, type ReviewEffectInput } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

export const ADMISSIONS_ENABLED_FLAG_KEY = 'admissions.enabled';
export const ADMISSIONS_UCAS_ADAPTER_ENABLED_FLAG_KEY = 'admissions.ucas-adapter.enabled';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** UCAS mode-of-study codes (inbound contract) to the SRS value set. */
const UCAS_MODE_OF_STUDY: Record<string, string> = { FT: 'full-time', PT: 'part-time' };

const SUBMISSION_WORKFLOW_CODE = 'ucas-confirmation-submission-approval';
const SUBMISSION_DECISION_STEP_KEY = 'approve-or-reject-submission';
const SUBMISSION_GATEWAY_KEY = 'G01';

export interface UcasSubmissionRequestDto {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  recordCount:         number;
  context:             Record<string, unknown>;
  startedAt:           Date;
}

export interface UcasApplicationPayload {
  ucasPersonalId: string;
  cycle: string;
  statusCode: string;
  applicant?: {
    givenNames?: string;
    familyName?: string;
    dateOfBirth?: string;
    email?: string;
  };
  enrolment?: {
    programmeId?: string;
    modeOfStudyCode?: string;
    attendanceTypeCode?: string;
    academicYearOfEntry?: string;
    startDate?: string;
    expectedEndDate?: string;
    feeBandCode?: string;
    fundingSourceCode?: string;
    slcReference?: string;
    ukviCasRequired?: boolean;
  };
  legalFirstName?: string;
  legalFamilyName?: string;
  dateOfBirth?: string;
  emailPersonal?: string;
  programmeId?: string;
  modeOfStudyCode?: string;
  attendanceTypeCode?: string;
  academicYearOfEntry?: string;
  startDate?: string;
  expectedEndDate?: string;
  feeBandCode?: string;
  fundingSourceCode?: string;
  slcReference?: string;
  ukviCasRequired?: boolean;
  [key: string]: unknown;
}

export interface UcasApplicationDto {
  applicationId:     string;
  ucasPersonalId:    string;
  cycle:             string;
  statusCode:        string;
  linkedEnrolmentId: string | null;
  receivedAt:        Date;
  validFrom:         Date;
  recordedAt:        Date;
}

export interface UcasConfirmationPayload {
  cycle: string;
  confirmations: Array<{
    triggerId:        string;
    enrolmentId:      string;
    ucasPersonalId:   string;
    confirmationType: 'enrolled' | 'withdrawn' | 'deferred';
    confirmedAt:      string;
  }>;
}

export class UcasService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly enrolmentsService: EnrolmentService,
    exchanges?: RegulatoryExchangeService,
    private readonly admissionsService?: AdmissionsService,
    private readonly featureFlags?: FeatureFlagService,
    private readonly workflowBridge?: WorkflowBridgeService,
    private readonly reviewExecution?: ReviewExecutionService,
    /** The channel-neutral application this adapter feeds (BPR-D01). */
    private readonly applications?: ApplicationService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  #submissionReview(): GovernedReview {
    if (!this.workflowBridge) throw new ValidationError('UCAS submission workflow is not configured');
    return new GovernedReview(this.workflowBridge, this.reviewExecution, {
      workflowCode: SUBMISSION_WORKFLOW_CODE,
      stepKey: SUBMISSION_DECISION_STEP_KEY,
      gatewayKey: SUBMISSION_GATEWAY_KEY,
      outcomeStepKey: 'request-closed',
      assigneeRoleCode: 'regulatory-officer',
      subjectEntityType: 'ucas_confirmation_batch',
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
    const cycle = input.context['cycle'] as string;
    const triggerIds = input.context['triggerIds'] as string[];
    const result = await this.generateOutboundConfirmations(input.tenantId, cycle, input.actorId, { dryRun: false, triggerIds });
    return { processedCount: result.processedCount };
  }

  async ingestApplication(
    tenantId: string,
    payload: UcasApplicationPayload,
    actorId: string,
  ): Promise<{ applicationId: string; linkedEnrolmentId: string | null; studentApplicationId: string | null }> {
    this.#validatePayloadShape(payload);
    await this.#validateStatusCode(tenantId, payload.statusCode);

    const now = clockNow();
    const payloadHash = hashPayload(payload);
    const existing = await this.#findCurrentByApplicantCycle(tenantId, payload.ucasPersonalId, payload.cycle);
    const applicationId = existing?.id ?? randomUUID();
    let linkedEnrolmentId = existing?.linkedEnrolmentId ?? null;

    await withTenantContext(this.db, tenantId, async (tx) => {
      if (existing) {
        await tx
          .update(ucasApplications)
          .set({ recordedUntil: now })
          .where(
            and(
              eq(ucasApplications.id, existing.id),
              eq(ucasApplications.tenantId, tenantId),
              isNull(ucasApplications.recordedUntil),
            ),
          );
      }

      await tx.insert(ucasApplications).values({
        versionId:          randomUUID(),
        id:                 applicationId,
        tenantId,
        ucasPersonalId:     payload.ucasPersonalId,
        cycle:              payload.cycle,
        statusCode:         payload.statusCode,
        linkedEnrolmentId,
        rawPayload:         payload,
        receivedAt:         now,
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });

    await this.exchanges.recordExchange(
      tenantId,
      'ucas-admissions-exchange.{cycle}',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'ucas-application',
        idempotencyKey: `ucas:${payload.ucasPersonalId}:${payload.cycle}:${payload.statusCode}`,
        payloadHash,
        payloadSummary: {
          ucasPersonalId: payload.ucasPersonalId,
          cycle: payload.cycle,
          statusCode: payload.statusCode,
        },
        receivedAt: now,
      },
      actorId,
    );

    const studentApplicationId = await this.#feedApplication(tenantId, applicationId, payload, actorId);

    await this.#publishApplicationReceived(tenantId, actorId, {
      applicationId,
      ucasPersonalId: payload.ucasPersonalId,
      cycle: payload.cycle,
      statusCode: payload.statusCode,
      tenantId,
    });

    if (
      payload.statusCode === 'confirmed'
      && !linkedEnrolmentId
      && await this.#admissionsUcasWorkflowEnabled(tenantId)
    ) {
      await this.admissionsService?.startHandoff(tenantId, {
        applicationId,
        sourceApplicationReference: payload.ucasPersonalId,
        source:     'ucas',
        cycle:      payload.cycle,
        statusCode: payload.statusCode,
        rawPayload: payload,
      }, actorId);
    }

    return { applicationId, linkedEnrolmentId, studentApplicationId };
  }

  /**
   * Receives the UCAS record as a channel-neutral application (BPR-D01), so
   * assessment, offers and conditions work the same as for any other channel.
   * A record without the applicant's names is not fed (there is no applicant
   * to match or create); one without a recognised programme, intake or mode
   * of study is received as incomplete until UCAS sends them.
   */
  async #feedApplication(tenantId: string, ucasApplicationId: string, payload: UcasApplicationPayload, actorId: string): Promise<string | null> {
    if (!this.applications) return null;
    const nested = payload.applicant ?? {};
    const route = payload.enrolment ?? {};
    const legalFirstName = payload.legalFirstName ?? nested.givenNames;
    const legalFamilyName = payload.legalFamilyName ?? nested.familyName;
    if (!legalFirstName || !legalFamilyName) return null;

    const dateOfBirth = payload.dateOfBirth ?? nested.dateOfBirth;
    const emailPersonal = payload.emailPersonal ?? nested.email;
    const startDate = payload.startDate ?? route.startDate;
    const mode = payload.modeOfStudyCode ?? route.modeOfStudyCode;
    const input: ReceiveApplicationInput = {
      channelCode: 'ucas',
      sourceReference: `${payload.cycle}:${payload.ucasPersonalId}`,
      cycle: payload.cycle,
      programmeId: payload.programmeId ?? route.programmeId ?? await this.#programmeFromChoices(tenantId, payload),
      intakeCode: startDate && /^\d{4}-\d{2}/.test(startDate) ? startDate.slice(0, 7) : null,
      modeOfStudyCode: mode ? (UCAS_MODE_OF_STUDY[mode] ?? mode) : null,
      ucasApplicationId,
      applicant: {
        legalFirstName, legalFamilyName,
        ...(dateOfBirth ? { dateOfBirth } : {}), ...(emailPersonal ? { emailPersonal } : {}),
      },
      payload,
    };
    const { application } = await this.applications.receive(tenantId, input, actorId, { lenient: true });
    return application.id;
  }

  /** The programme of the confirmed choice, or of the first choice, by programme code. */
  async #programmeFromChoices(tenantId: string, payload: UcasApplicationPayload): Promise<string | null> {
    const choices = Array.isArray(payload['choices']) ? payload['choices'] as Array<Record<string, unknown>> : [];
    const choice = choices.find((c) => c['decisionCode'] === 'confirmed') ?? choices.find((c) => c['choiceNumber'] === 1) ?? choices[0];
    const code = typeof choice?.['programmeCode'] === 'string' ? choice['programmeCode'] : null;
    if (!code) return null;
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: programmes.id }).from(programmes)
      .where(and(eq(programmes.tenantId, tenantId as Uuid), eq(programmes.code, code))).limit(1));
    return rows[0]?.id ?? null;
  }

  async linkApplicationToEnrolment(
    applicationId: string,
    enrolmentId: string,
    tenantId: string,
  ): Promise<void> {
    const application = await this.#getCurrentApplication(applicationId, tenantId);
    if (!application) throw new NotFoundError('UCAS application', applicationId);

    const enrolment = await this.enrolmentsService.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

    await this.#setLinkedEnrolment(applicationId, tenantId, enrolmentId);
  }

  async generateOutboundConfirmations(
    tenantId: string,
    cycle: string,
    actorId: string,
    opts: { dryRun?: boolean; triggerIds?: string[] } = {},
  ): Promise<{ processedCount: number; payload: UcasConfirmationPayload }> {
    const now = clockNow();
    const confirmations: UcasConfirmationPayload['confirmations'] = [];

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ trigger: enrolmentDownstreamTriggers, enrolment: enrolments })
        .from(enrolmentDownstreamTriggers)
        .innerJoin(
          enrolments,
          and(
            eq(enrolments.id, enrolmentDownstreamTriggers.enrolmentId),
            eq(enrolments.tenantId, tenantId),
            isNull(enrolments.recordedUntil),
          ),
        )
        .where(
          and(
            eq(enrolmentDownstreamTriggers.tenantId, tenantId),
            eq(enrolmentDownstreamTriggers.triggerTypeCode, 'ucas-confirmation'),
            eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
            ...(opts.triggerIds ? [inArray(enrolmentDownstreamTriggers.id, opts.triggerIds as Uuid[])] : []),
          ),
        ),
    );

    for (const row of rows) {
      const ucasPersonalId = row.enrolment.ucasPersonalId;
      if (!ucasPersonalId) continue;

      const confirmation = {
        triggerId: row.trigger.id,
        enrolmentId: row.enrolment.id,
        ucasPersonalId,
        confirmationType: mapConfirmationType(row.enrolment.statusCode),
        confirmedAt: now.toISOString(),
      };
      confirmations.push(confirmation);

      if (opts.dryRun) continue;

      const exchange = await this.exchanges.recordExchange(
        tenantId,
        'ucas-admissions-exchange.{cycle}',
        {
          directionCode: 'outbound',
          exchangeTypeCode: 'ucas-confirmation',
          idempotencyKey: `ucas-confirmation:${row.trigger.id}`,
          payloadHash: hashPayload(confirmation),
          payloadSummary: confirmation,
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
        ucasPersonalId,
        cycle,
        confirmationType: confirmation.confirmationType,
        exchangeId: exchange.id,
      });
    }

    return {
      processedCount: confirmations.length,
      payload: { cycle, confirmations },
    };
  }

  // ── Submission approval workflow (BPR-W12 rollout) ──────────────────────────
  // Snapshots the previewed trigger set into the workflow context, exactly as
  // SlcService.requestSubmission does, so a later approval acts on precisely
  // what was reviewed rather than a fresh (possibly diverged) query.

  async requestSubmission(
    tenantId: string,
    cycle: string,
    requesterId: string,
    reason?: string,
  ): Promise<UcasSubmissionRequestDto> {
    if (!this.workflowBridge) throw new ValidationError('UCAS submission workflow is not configured');

    const preview = await this.generateOutboundConfirmations(tenantId, cycle, requesterId, { dryRun: true });
    if (preview.payload.confirmations.length === 0) {
      throw new ValidationError('No pending UCAS confirmations to submit');
    }
    const triggerIds = preview.payload.confirmations.map((c) => c.triggerId);

    const workflowDefinitionVersionId = await this.#getActiveSubmissionWorkflowVersionId(tenantId);
    const started = await this.#submissionReview().start(tenantId, {
      workflowDefinitionVersionId,
      startedBy: requesterId,
      context: { cycle, triggerIds, recordCount: triggerIds.length, ...(reason ? { reason } : {}) },
      taskPayload: { cycle, triggerIds, recordCount: triggerIds.length },
    });

    return {
      workflowInstanceId: started.workflowInstanceId,
      workflowTaskId: started.workflowTaskId,
      statusCode: 'running',
      recordCount: triggerIds.length,
      context: { cycle, triggerIds, recordCount: triggerIds.length },
      startedAt: clockNow(),
    };
  }

  async listPendingSubmissionRequests(tenantId: string): Promise<UcasSubmissionRequestDto[]> {
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

  async listApplications(
    tenantId: string,
    filters: { cycle?: string; statusCode?: string } = {},
  ): Promise<UcasApplicationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ucasApplications)
        .where(
          and(
            eq(ucasApplications.tenantId, tenantId),
            isNull(ucasApplications.recordedUntil),
            ...(filters.cycle ? [eq(ucasApplications.cycle, filters.cycle)] : []),
            ...(filters.statusCode ? [eq(ucasApplications.statusCode, filters.statusCode)] : []),
          ),
        ),
    );

    return rows.map(applicationToDto);
  }

  async #validateStatusCode(tenantId: string, statusCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue(
      'ucas_application',
      'status_code',
      statusCode,
      tenantId,
    );

    if (isValid === false) {
      throw new ValidationError(
        `Invalid UCAS application status '${statusCode}'`,
        [{ field: 'statusCode', message: 'Status is not active in ucas-application-status-code' }],
      );
    }
  }

  #validatePayloadShape(payload: UcasApplicationPayload): void {
    const missing: Array<{ field: string; message: string }> = [];
    if (!payload.ucasPersonalId) missing.push({ field: 'ucasPersonalId', message: 'UCAS personal ID is required' });
    if (!payload.cycle) missing.push({ field: 'cycle', message: 'UCAS cycle is required' });
    if (!payload.statusCode) missing.push({ field: 'statusCode', message: 'UCAS status code is required' });
    if (missing.length) throw new ValidationError('Invalid UCAS application payload', missing);
  }

  async #admissionsUcasWorkflowEnabled(tenantId: string): Promise<boolean> {
    if (!this.admissionsService) return false;
    if (!this.featureFlags) return true;
    const admissionsEnabled = await this.#evaluateBooleanFlag(tenantId, ADMISSIONS_ENABLED_FLAG_KEY, true);
    const ucasAdapterEnabled = await this.#evaluateBooleanFlag(tenantId, ADMISSIONS_UCAS_ADAPTER_ENABLED_FLAG_KEY, true);
    return shouldStartUcasAdmissionsWorkflow({ admissionsEnabled, ucasAdapterEnabled });
  }

  async #evaluateBooleanFlag(tenantId: string, flagKey: string, fallback: boolean): Promise<boolean> {
    if (!this.featureFlags) return fallback;
    try {
      const flag = await this.featureFlags.getFlagByKey(flagKey);
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true || result.variantKey === 'on';
    } catch {
      return fallback;
    }
  }

  async #findCurrentByApplicantCycle(tenantId: string, ucasPersonalId: string, cycle: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ucasApplications)
        .where(
          and(
            eq(ucasApplications.tenantId, tenantId),
            eq(ucasApplications.ucasPersonalId, ucasPersonalId),
            eq(ucasApplications.cycle, cycle),
            isNull(ucasApplications.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ?? null;
  }

  async #getCurrentApplication(applicationId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ucasApplications)
        .where(
          and(
            eq(ucasApplications.id, applicationId),
            eq(ucasApplications.tenantId, tenantId),
            isNull(ucasApplications.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ?? null;
  }

  async #setLinkedEnrolment(applicationId: string, tenantId: string, linkedEnrolmentId: string): Promise<void> {
    const current = await this.#getCurrentApplication(applicationId, tenantId);
    if (!current) throw new NotFoundError('UCAS application', applicationId);

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(ucasApplications)
        .set({ recordedUntil: now })
        .where(
          and(
            eq(ucasApplications.id, applicationId),
            eq(ucasApplications.tenantId, tenantId),
            isNull(ucasApplications.recordedUntil),
          ),
        );

      await tx.insert(ucasApplications).values({
        versionId: randomUUID(),
        id: current.id,
        tenantId: current.tenantId,
        ucasPersonalId: current.ucasPersonalId,
        cycle: current.cycle,
        statusCode: current.statusCode,
        linkedEnrolmentId,
        rawPayload: current.rawPayload,
        receivedAt: current.receivedAt,
        validFrom: current.validFrom,
        validTo: current.validTo,
        recordedAt: now,
        recordedUntil: null,
      });
    });
  }

  async #publishApplicationReceived(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUcasApplicationReceivedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(
      EVENT_TYPES.REGULATORY_UCAS_APPLICATION_RECEIVED,
      '1.0.0',
      tenantId,
      actorId,
      'personal',
      payload,
    );
  }

  async #publishConfirmationSent(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUcasConfirmationSentV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(
      EVENT_TYPES.REGULATORY_UCAS_CONFIRMATION_SENT,
      '1.0.0',
      tenantId,
      actorId,
      'personal',
      payload,
    );
  }
}

function applicationToDto(row: typeof ucasApplications.$inferSelect): UcasApplicationDto {
  return {
    applicationId: row.id,
    ucasPersonalId: row.ucasPersonalId,
    cycle: row.cycle,
    statusCode: row.statusCode,
    linkedEnrolmentId: row.linkedEnrolmentId,
    receivedAt: row.receivedAt,
    validFrom: row.validFrom,
    recordedAt: row.recordedAt,
  };
}

function mapConfirmationType(statusCode: string): 'enrolled' | 'withdrawn' | 'deferred' {
  if (statusCode === 'withdrawn') return 'withdrawn';
  // 'intermitting' is a student-approved leave of absence — maps to UCAS 'deferred'.
  // 'suspended' is an institutional administrative hold with no UCAS equivalent; treat as enrolled
  // (no change notification) until the suspension resolves to a withdrawal or reinstatement.
  if (statusCode === 'intermitting') return 'deferred';
  return 'enrolled';
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function shouldStartUcasAdmissionsWorkflow(input: {
  admissionsEnabled: boolean;
  ucasAdapterEnabled: boolean;
}): boolean {
  return input.admissionsEnabled && input.ucasAdapterEnabled;
}
