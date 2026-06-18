import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  enrolmentDownstreamTriggers,
  enrolments,
  ucasApplications,
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
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

export const ADMISSIONS_ENABLED_FLAG_KEY = 'admissions.enabled';
export const ADMISSIONS_UCAS_ADAPTER_ENABLED_FLAG_KEY = 'admissions.ucas-adapter.enabled';

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
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async ingestApplication(
    tenantId: string,
    payload: UcasApplicationPayload,
    actorId: string,
  ): Promise<{ applicationId: string; linkedEnrolmentId: string | null }> {
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

    return { applicationId, linkedEnrolmentId };
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
