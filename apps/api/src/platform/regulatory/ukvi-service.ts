import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  engagementOutcomes,
  enrolmentDownstreamTriggers,
  ukviAttendanceReports,
  ukviCasRequests,
  ukviComplianceAlerts,
  ukviEngagementEvidenceSnapshots,
  ukviSponsorDecisions,
  ukviVisaStatuses,
  type Db,
  type UkviCasRequest,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatoryUkviAttendanceSubmittedV1Payload,
  type RegulatoryUkviCasAssignedV1Payload,
  type RegulatoryUkviCasRequestedV1Payload,
  type RegulatoryUkviComplianceAlertRaisedV1Payload,
  type RegulatoryUkviVisaStatusUpdatedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { RulesEngine } from '../rules-engine/engine.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

interface CasSourceRow {
  trigger_id: string;
  enrolment_id: string;
  person_id: string;
  legal_first_name: string | null;
  legal_family_name: string | null;
  date_of_birth: string | null;
  nationality_code: string | null;
  programme_id: string | null;
  programme_code: string | null;
  programme_title: string | null;
  mode_of_study_code: string;
  academic_year_of_entry: string;
  start_date: string;
  expected_end_date: string | null;
}

interface SponsoredStudentRow {
  enrolment_id: string;
  person_id: string;
  cas_reference: string | null;
  programme_id: string | null;
  programme_code: string | null;
  programme_title: string | null;
  status_code: string;
  legal_first_name: string | null;
  legal_family_name: string | null;
}

interface AttendanceReportRow {
  id: string;
  report_payload: unknown;
  submitted_at: Date | string;
}

export interface UkviPersonData {
  personId: string;
  legalFirstName: string | null;
  legalFamilyName: string | null;
  dateOfBirth: string | null;
  nationalityCode: string | null;
  programmeId: string | null;
  programmeCode: string | null;
  programmeTitle: string | null;
  modeOfStudyCode: string;
  academicYearOfEntry: string;
  startDate: string;
  expectedEndDate: string | null;
}

export interface UkviCasRequestGenerationResult {
  processedCount: number;
  casRequests: Array<{
    casRequestId: string;
    enrolmentId: string;
    personData: UkviPersonData;
  }>;
}

export interface UkviCasRequestDto {
  casRequestId: string;
  enrolmentId: string;
  casReference: string | null;
  statusCode: string;
  requestedAt: Date;
}

export interface UkviAttendanceStudent {
  enrolmentId: string;
  personId: string;
  casReference: string | null;
  programmeId: string | null;
  programmeCode: string | null;
  programmeTitle: string | null;
  enrolmentStatusCode: string;
  legalFirstName: string | null;
  legalFamilyName: string | null;
  absenceCount: number;
  thresholdBreached: boolean;
  attendanceDataCompleteness: 'pending-attendance-integration' | 'provided';
}

export interface UkviAttendanceReportPayload {
  academicPeriodId: string;
  generatedAt: string;
  studentCount: number;
  threshold: {
    unauthorisedAbsencesPerEightWeeks: number;
  };
  _attendance_data_completeness: 'pending-attendance-integration' | 'provided';
  students: UkviAttendanceStudent[];
}

export interface UkviVisaStatusUpdateInput {
  statusCode: string;
  effectiveDate: string;
  rawPayload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface UkviComplianceAlertDto {
  alertId: string;
  enrolmentId: string;
  casReference: string | null;
  alertTypeCode: string;
  triggeredAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface UkviEvidenceSnapshotDto {
  snapshotId: string;
  enrolmentId: string;
  engagementAlertId: string;
  policyVersionId: string;
  evidenceWindowFrom: Date;
  evidenceWindowTo: Date;
  evidenceSummary: Record<string, unknown>;
  evidenceHash: string;
  evidenceQualityCode: string;
  createdAt: Date;
  createdBy: string;
}

export interface UkviSponsorDecisionDto {
  decisionId: string;
  enrolmentId: string;
  evidenceSnapshotId: string;
  outcomeCode: string;
  rationaleCode: string;
  guidanceVersion: string;
  statusCode: string;
  decidedAt: Date;
  decidedBy: string;
  authorisedAt: Date | null;
  authorisedBy: string | null;
  externalReportId: string | null;
}

export class UkviService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
    private readonly rules: RulesEngine,
    exchanges?: RegulatoryExchangeService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async generateCasRequests(tenantId: string, actorId: string): Promise<UkviCasRequestGenerationResult> {
    const now = clockNow();
    const rows = await this.#loadPendingCasSources(tenantId);
    const casRequests: UkviCasRequestGenerationResult['casRequests'] = [];
    const seenTriggers = new Set<string>();

    for (const row of rows) {
      if (seenTriggers.has(row.trigger_id)) continue;
      seenTriggers.add(row.trigger_id);

      const casRequestId = randomUUID();
      const personData = mapCasPersonData(row);

      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.insert(ukviCasRequests).values({
          versionId: randomUUID(),
          id: casRequestId,
          tenantId,
          enrolmentId: row.enrolment_id,
          casReference: null,
          statusCode: 'pending',
          requestedAt: now,
          validFrom: now,
          validTo: null,
          recordedAt: now,
          recordedUntil: null,
        });
      });

      await this.exchanges.recordExchange(
        tenantId,
        'ukvi-sponsor-compliance.v1',
        {
          directionCode: 'outbound',
          exchangeTypeCode: 'ukvi-cas-request',
          idempotencyKey: `ukvi-cas:${row.trigger_id}`,
          payloadHash: hashPayload(personData),
          payloadSummary: {
            enrolmentId: row.enrolment_id,
            programmeCode: row.programme_code,
            startDate: row.start_date,
          },
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
              eq(enrolmentDownstreamTriggers.id, row.trigger_id),
              eq(enrolmentDownstreamTriggers.tenantId, tenantId),
              eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
            ),
          );
      });

      await this.#publishCasRequested(tenantId, actorId, {
        enrolmentId: row.enrolment_id,
        casRequestId,
        requestedAt: now.toISOString(),
      });

      casRequests.push({ casRequestId, enrolmentId: row.enrolment_id, personData });
    }

    return { processedCount: casRequests.length, casRequests };
  }

  async recordCasAssignment(
    casRequestId: string,
    casReference: string,
    tenantId: string,
    actorId: string,
  ): Promise<UkviCasRequestDto> {
    if (!casReference.trim()) {
      throw new ValidationError('CAS reference is required');
    }

    const current = await this.#getCasRequest(casRequestId, tenantId);
    if (!current) throw new NotFoundError('UKVI CAS request', casRequestId);
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(ukviCasRequests)
        .set({ recordedUntil: now })
        .where(
          and(
            eq(ukviCasRequests.id, casRequestId),
            eq(ukviCasRequests.tenantId, tenantId),
            isNull(ukviCasRequests.recordedUntil),
          ),
        );

      await tx.insert(ukviCasRequests).values({
        versionId: randomUUID(),
        id: current.id,
        tenantId,
        enrolmentId: current.enrolmentId,
        casReference,
        statusCode: 'assigned',
        requestedAt: current.requestedAt,
        validFrom: current.validFrom,
        validTo: current.validTo,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    await this.#publishCasAssigned(tenantId, actorId, {
      enrolmentId: current.enrolmentId,
      casRequestId,
      casReference,
      assignedAt: now.toISOString(),
    });

    return {
      casRequestId,
      enrolmentId: current.enrolmentId,
      casReference,
      statusCode: 'assigned',
      requestedAt: current.requestedAt,
    };
  }

  async generateAttendanceReport(
    _tenantId: string,
    _academicPeriodId: string,
    _actorId: string,
  ): Promise<{ reportId: string; payload: UkviAttendanceReportPayload }> {
    throw new ValidationError(
      'Direct attendance-report generation is retired; create an engagement evidence snapshot, record a human sponsor decision and obtain independent authorisation',
    );
  }

  async processVisaStatusUpdate(
    tenantId: string,
    casReference: string,
    update: UkviVisaStatusUpdateInput,
    actorId: string,
  ): Promise<{ visaStatusId: string; alertId: string | null }> {
    await this.#validateVisaStatus(tenantId, update.statusCode);
    const casRequest = await this.#getCasRequestByReference(casReference, tenantId);
    if (!casRequest) throw new NotFoundError('UKVI CAS reference', casReference);

    const now = clockNow();
    const visaStatusId = randomUUID();
    const rawPayload = update.rawPayload ?? { casReference, ...update };

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(ukviVisaStatuses).values({
        versionId: randomUUID(),
        id: visaStatusId,
        tenantId,
        enrolmentId: casRequest.enrolmentId,
        casReference,
        statusCode: update.statusCode,
        effectiveDate: update.effectiveDate,
        rawPayload,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    await this.exchanges.recordExchange(
      tenantId,
      'ukvi-sponsor-compliance.v1',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'ukvi-visa-status',
        idempotencyKey: update.idempotencyKey ?? `ukvi-visa-status:${casReference}:${update.statusCode}:${update.effectiveDate}`,
        payloadHash: hashPayload(rawPayload),
        payloadSummary: {
          enrolmentId: casRequest.enrolmentId,
          casReference,
          statusCode: update.statusCode,
          effectiveDate: update.effectiveDate,
        },
      },
      actorId,
    );

    let alertId: string | null = null;
    if (update.statusCode === 'curtailed' || update.statusCode === 'refused') {
      alertId = await this.#raiseAlertIfAbsent(
        tenantId,
        casRequest.enrolmentId,
        casReference,
        'visa-curtailed',
        actorId,
        now,
      );
    }

    await this.#publishVisaStatusUpdated(tenantId, actorId, {
      enrolmentId: casRequest.enrolmentId,
      casReference,
      statusCode: update.statusCode,
      effectiveDate: update.effectiveDate,
    });

    return { visaStatusId, alertId };
  }

  async evaluateComplianceAlerts(tenantId: string, actorId: string): Promise<{ alertsRaised: number }> {
    const threshold = await this.#getAttendanceThreshold(tenantId);
    const latestReport = await this.#loadLatestAttendanceReport(tenantId);
    const students = extractAttendanceStudents(latestReport?.report_payload);
    const now = clockNow();
    let alertsRaised = 0;

    for (const student of students) {
      if (student.absenceCount < threshold) continue;
      const alertId = await this.#raiseAlertIfAbsent(
        tenantId,
        student.enrolmentId,
        student.casReference,
        'attendance-threshold-breach',
        actorId,
        now,
        true,
      );
      if (alertId) alertsRaised += 1;
    }

    return { alertsRaised };
  }

  async resolveComplianceAlert(alertId: string, tenantId: string, actorId: string): Promise<void> {
    const now = clockNow();
    const updated = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(ukviComplianceAlerts)
        .set({ resolvedAt: now, resolvedBy: actorId })
        .where(and(eq(ukviComplianceAlerts.id, alertId), eq(ukviComplianceAlerts.tenantId, tenantId)))
        .returning({ id: ukviComplianceAlerts.id }),
    );

    if (!updated[0]) throw new NotFoundError('UKVI compliance alert', alertId);
  }

  async listCasRequests(tenantId: string, filters: { statusCode?: string } = {}): Promise<UkviCasRequestDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ukviCasRequests)
        .where(
          and(
            eq(ukviCasRequests.tenantId, tenantId),
            isNull(ukviCasRequests.recordedUntil),
            ...(filters.statusCode ? [eq(ukviCasRequests.statusCode, filters.statusCode)] : []),
          ),
        ),
    );

    return rows.map(toCasDto);
  }

  async listComplianceAlerts(tenantId: string, unresolvedOnly = false): Promise<UkviComplianceAlertDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ukviComplianceAlerts)
        .where(
          and(
            eq(ukviComplianceAlerts.tenantId, tenantId),
            ...(unresolvedOnly ? [isNull(ukviComplianceAlerts.resolvedAt)] : []),
          ),
        ),
    );

    return rows.map((row) => ({
      alertId: row.id,
      enrolmentId: row.enrolmentId,
      casReference: row.casReference,
      alertTypeCode: row.alertTypeCode,
      triggeredAt: row.triggeredAt,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy,
    }));
  }

  /**
   * Reads the attendance module's sponsor-compliance-referral handoff
   * (POST /students/:personId/engagement-outcomes, outcomeCode
   * 'referred-sponsor-compliance') rather than joining the module's own
   * alert/case/referral tables directly — those moved to modules/attendance
   * in the Stage 1 extraction and are no longer reachable from core.
   */
  async createEngagementEvidenceSnapshot(
    tenantId: string,
    engagementAlertId: string,
    actorId: string,
  ): Promise<UkviEvidenceSnapshotDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId:          engagementOutcomes.enrolmentId,
        policyVersionId:      engagementOutcomes.policyVersionId,
        evidenceWindowFrom:   engagementOutcomes.evidenceWindowFrom,
        evidenceWindowTo:     engagementOutcomes.evidenceWindowTo,
        evidenceSnapshot:     engagementOutcomes.evidenceSnapshot,
        evidenceHash:         engagementOutcomes.evidenceHash,
        reevaluationRequired: engagementOutcomes.reevaluationRequired,
        recordedAt:           engagementOutcomes.recordedAt,
      })
        .from(engagementOutcomes)
        .where(and(
          eq(engagementOutcomes.tenantId, tenantId),
          eq(engagementOutcomes.sourceAlertId, engagementAlertId),
          eq(engagementOutcomes.outcomeCode, 'referred-sponsor-compliance'),
          isNull(engagementOutcomes.recordedUntil),
        ))
        .limit(1),
    );
    const source = rows[0];
    if (!source || !source.policyVersionId || !source.evidenceWindowFrom
      || !source.evidenceWindowTo || !source.evidenceSnapshot || !source.evidenceHash) {
      throw new NotFoundError('sponsor-compliance engagement referral', engagementAlertId);
    }

    const quality = source.reevaluationRequired ? 'reconciliation-required' : 'verified';
    const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(ukviEngagementEvidenceSnapshots).values({
        tenantId,
        enrolmentId: source.enrolmentId,
        engagementAlertId,
        policyVersionId: source.policyVersionId!,
        evidenceWindowFrom: new Date(source.evidenceWindowFrom!),
        evidenceWindowTo: new Date(source.evidenceWindowTo!),
        evidenceSummary: source.evidenceSnapshot!,
        evidenceHash: source.evidenceHash!,
        evidenceQualityCode: quality,
        sourceRecordedAt: new Date(source.recordedAt),
        createdBy: actorId,
      }).onConflictDoNothing().returning(),
    );

    const snapshot = inserted[0] ?? (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(ukviEngagementEvidenceSnapshots).where(and(
        eq(ukviEngagementEvidenceSnapshots.tenantId, tenantId),
        eq(ukviEngagementEvidenceSnapshots.engagementAlertId, engagementAlertId),
        eq(ukviEngagementEvidenceSnapshots.evidenceHash, source.evidenceHash!),
      )).limit(1),
    ))[0];
    if (!snapshot) throw new ValidationError('Could not create UKVI engagement evidence snapshot');
    return toEvidenceSnapshotDto(snapshot);
  }

  async createSponsorDecision(
    tenantId: string,
    input: {
      evidenceSnapshotId: string;
      outcomeCode: 'report' | 'no-report' | 'further-review';
      rationaleCode: string;
      guidanceVersion: string;
    },
    actorId: string,
  ): Promise<UkviSponsorDecisionDto> {
    if (!input.rationaleCode.trim() || !input.guidanceVersion.trim()) {
      throw new ValidationError('Rationale code and guidance version are required');
    }
    const snapshots = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(ukviEngagementEvidenceSnapshots).where(and(
        eq(ukviEngagementEvidenceSnapshots.id, input.evidenceSnapshotId),
        eq(ukviEngagementEvidenceSnapshots.tenantId, tenantId),
      )).limit(1),
    );
    const snapshot = snapshots[0];
    if (!snapshot) throw new NotFoundError('UKVI engagement evidence snapshot', input.evidenceSnapshotId);
    if (snapshot.evidenceQualityCode !== 'verified' && input.outcomeCode !== 'further-review') {
      throw new ValidationError('Evidence requiring reconciliation cannot support a report/no-report decision');
    }
    const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(ukviSponsorDecisions).values({
        tenantId,
        enrolmentId: snapshot.enrolmentId,
        evidenceSnapshotId: snapshot.id,
        outcomeCode: input.outcomeCode,
        rationaleCode: input.rationaleCode,
        guidanceVersion: input.guidanceVersion,
        decidedBy: actorId,
      }).onConflictDoNothing().returning(),
    );
    if (!inserted[0]) throw new ValidationError('A sponsor decision already exists for this evidence snapshot');
    return toSponsorDecisionDto(inserted[0]);
  }

  async authoriseSponsorDecision(
    decisionId: string,
    tenantId: string,
    actorId: string,
  ): Promise<UkviSponsorDecisionDto> {
    const decisions = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(ukviSponsorDecisions).where(and(
        eq(ukviSponsorDecisions.id, decisionId),
        eq(ukviSponsorDecisions.tenantId, tenantId),
      )).limit(1),
    );
    const decision = decisions[0];
    if (!decision) throw new NotFoundError('UKVI sponsor decision', decisionId);
    if (decision.statusCode !== 'pending-authorisation') {
      throw new ValidationError('Sponsor decision is already authorised');
    }
    if (decision.decidedBy === actorId) {
      throw new ValidationError('The decision maker cannot authorise their own sponsor decision');
    }
    const now = clockNow();
    let reportId: string | null = null;
    if (decision.outcomeCode === 'report') {
      const snapshots = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select().from(ukviEngagementEvidenceSnapshots).where(eq(
          ukviEngagementEvidenceSnapshots.id,
          decision.evidenceSnapshotId,
        )).limit(1),
      );
      const snapshot = snapshots[0]!;
      const payload = {
        decisionId,
        enrolmentId: decision.enrolmentId,
        guidanceVersion: decision.guidanceVersion,
        rationaleCode: decision.rationaleCode,
        evidenceSnapshotId: snapshot.id,
        evidenceHash: snapshot.evidenceHash,
        evidenceWindowFrom: snapshot.evidenceWindowFrom.toISOString(),
        evidenceWindowTo: snapshot.evidenceWindowTo.toISOString(),
        authorisedAt: now.toISOString(),
        authorisedBy: actorId,
      };
      const academicPeriod = await this.#academicPeriodForEvidenceWindow(
        tenantId,
        snapshot.evidenceWindowFrom,
      );
      const reports = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.insert(ukviAttendanceReports).values({
          tenantId,
          academicPeriodId: academicPeriod,
          submittedAt: now,
          reportPayload: payload,
          submittedBy: actorId,
        }).returning({ id: ukviAttendanceReports.id }),
      );
      reportId = reports[0]!.id;
      await this.exchanges.recordExchange(tenantId, 'ukvi-sponsor-compliance.v1', {
        directionCode: 'outbound',
        exchangeTypeCode: 'ukvi-sponsor-report',
        idempotencyKey: `ukvi-sponsor-decision:${decisionId}`,
        payloadHash: hashPayload(payload),
        payloadSummary: { decisionId, reportId, enrolmentId: decision.enrolmentId },
        sentAt: now,
      }, actorId);
      await this.#publishAttendanceSubmitted(tenantId, actorId, {
        academicPeriodId: academicPeriod,
        reportId,
        submittedAt: now.toISOString(),
        studentCount: 1,
      });
    }
    const updated = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.update(ukviSponsorDecisions).set({
        statusCode: 'authorised',
        authorisedAt: now,
        authorisedBy: actorId,
        externalReportId: reportId,
      }).where(and(
        eq(ukviSponsorDecisions.id, decisionId),
        eq(ukviSponsorDecisions.tenantId, tenantId),
      )).returning(),
    );
    return toSponsorDecisionDto(updated[0]!);
  }

  async listSponsorDecisions(tenantId: string): Promise<UkviSponsorDecisionDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(ukviSponsorDecisions)
        .where(eq(ukviSponsorDecisions.tenantId, tenantId)),
    );
    return rows.map(toSponsorDecisionDto);
  }

  async getOperationalStatus(tenantId: string): Promise<{
    reconciliationRequired: number;
    pendingAuthorisation: number;
    failedExchanges: number;
  }> {
    const rows = (await withTenantContext(this.db, tenantId, async (tx) => tx.execute(sql`
      SELECT
        (SELECT count(*)::int FROM ukvi_engagement_evidence_snapshot
          WHERE tenant_id = ${tenantId} AND evidence_quality_code = 'reconciliation-required')
          AS reconciliation_required,
        (SELECT count(*)::int FROM ukvi_sponsor_decision
          WHERE tenant_id = ${tenantId} AND status_code = 'pending-authorisation')
          AS pending_authorisation,
        (SELECT count(*)::int FROM integration_exchange
          WHERE tenant_id = ${tenantId}
            AND contract_id = 'ukvi-sponsor-compliance.v1'
            AND status_code IN ('failed', 'dead-letter'))
          AS failed_exchanges
    `))) as unknown as Array<{
      reconciliation_required: number;
      pending_authorisation: number;
      failed_exchanges: number;
    }>;
    const row = rows[0]!;
    return {
      reconciliationRequired: row.reconciliation_required,
      pendingAuthorisation: row.pending_authorisation,
      failedExchanges: row.failed_exchanges,
    };
  }

  async #academicPeriodForEvidenceWindow(tenantId: string, evidenceFrom: Date): Promise<string> {
    const rows = (await withTenantContext(this.db, tenantId, async (tx) => tx.execute(sql`
      SELECT id
      FROM academic_period
      WHERE tenant_id = ${tenantId}
        AND start_date <= ${evidenceFrom.toISOString()}::date
        AND end_date >= ${evidenceFrom.toISOString()}::date
      ORDER BY start_date DESC
      LIMIT 1
    `))) as unknown as Array<{ id: string }>;
    if (!rows[0]) throw new NotFoundError('academic period for UKVI evidence', evidenceFrom.toISOString());
    return rows[0].id;
  }

  async #loadPendingCasSources(tenantId: string): Promise<CasSourceRow[]> {
    return (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        SELECT
          edt.id AS trigger_id,
          e.id AS enrolment_id,
          e.person_id,
          pi.legal_first_name,
          pi.legal_family_name,
          pi.date_of_birth,
          pi.nationality_code,
          e.programme_id,
          pr.code AS programme_code,
          pr.title AS programme_title,
          e.mode_of_study_code,
          e.academic_year_of_entry,
          e.start_date,
          e.expected_end_date
        FROM enrolment_downstream_trigger edt
        JOIN enrolment e
          ON e.id = edt.enrolment_id
         AND e.tenant_id = ${tenantId}
         AND e.recorded_until IS NULL
        JOIN person_identity pi
          ON pi.person_id = e.person_id
         AND pi.tenant_id = ${tenantId}
         AND pi.recorded_until IS NULL
        LEFT JOIN programme pr
          ON pr.id = e.programme_id
         AND pr.tenant_id = ${tenantId}
         AND pr.recorded_until IS NULL
        WHERE edt.tenant_id = ${tenantId}
          AND edt.trigger_type_code = 'ukvi-cas'
          AND edt.status_code = 'pending'
        ORDER BY edt.created_at ASC
      `),
    )) as unknown as CasSourceRow[];
  }

  async #loadSponsoredStudents(tenantId: string): Promise<SponsoredStudentRow[]> {
    return (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        WITH assigned_cas AS (
          SELECT DISTINCT ON (tenant_id, enrolment_id)
            tenant_id,
            enrolment_id,
            cas_reference
          FROM ukvi_cas_request
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
            AND status_code = 'assigned'
          ORDER BY tenant_id, enrolment_id, requested_at DESC
        ),
        profile_sponsored AS (
          SELECT DISTINCT tenant_id, enrolment_id
          FROM student_regulatory_profile
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
            AND ukvi_sponsorship_required = true
            AND enrolment_id IS NOT NULL
        )
        SELECT DISTINCT ON (e.id)
          e.id AS enrolment_id,
          e.person_id,
          assigned_cas.cas_reference,
          e.programme_id,
          pr.code AS programme_code,
          pr.title AS programme_title,
          e.status_code,
          pi.legal_first_name,
          pi.legal_family_name
        FROM enrolment e
        LEFT JOIN assigned_cas
          ON assigned_cas.tenant_id = e.tenant_id
         AND assigned_cas.enrolment_id = e.id
        LEFT JOIN profile_sponsored
          ON profile_sponsored.tenant_id = e.tenant_id
         AND profile_sponsored.enrolment_id = e.id
        JOIN person_identity pi
          ON pi.person_id = e.person_id
         AND pi.tenant_id = ${tenantId}
         AND pi.recorded_until IS NULL
        LEFT JOIN programme pr
          ON pr.id = e.programme_id
         AND pr.tenant_id = ${tenantId}
         AND pr.recorded_until IS NULL
        WHERE e.tenant_id = ${tenantId}
          AND e.recorded_until IS NULL
          AND e.status_code IN ('enrolled', 'intermitting', 'suspended')
          AND (assigned_cas.enrolment_id IS NOT NULL OR profile_sponsored.enrolment_id IS NOT NULL)
        ORDER BY e.id
      `),
    )) as unknown as SponsoredStudentRow[];
  }

  async #loadLatestAttendanceReport(tenantId: string): Promise<AttendanceReportRow | null> {
    const rows = (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        SELECT id, report_payload, submitted_at
        FROM ukvi_attendance_report
        WHERE tenant_id = ${tenantId}
        ORDER BY submitted_at DESC
        LIMIT 1
      `),
    )) as unknown as AttendanceReportRow[];

    return rows[0] ?? null;
  }

  async #getCasRequest(casRequestId: string, tenantId: string): Promise<UkviCasRequest | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ukviCasRequests)
        .where(
          and(
            eq(ukviCasRequests.id, casRequestId),
            eq(ukviCasRequests.tenantId, tenantId),
            isNull(ukviCasRequests.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ?? null;
  }

  async #getCasRequestByReference(casReference: string, tenantId: string): Promise<UkviCasRequest | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(ukviCasRequests)
        .where(
          and(
            eq(ukviCasRequests.casReference, casReference),
            eq(ukviCasRequests.tenantId, tenantId),
            isNull(ukviCasRequests.recordedUntil),
          ),
        )
        .limit(1),
    );

    return rows[0] ?? null;
  }

  async #raiseAlertIfAbsent(
    tenantId: string,
    enrolmentId: string,
    casReference: string | null,
    alertTypeCode: string,
    actorId: string,
    triggeredAt: Date,
    includeResolvedDuplicates = false,
  ): Promise<string | null> {
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: ukviComplianceAlerts.id })
        .from(ukviComplianceAlerts)
        .where(
          and(
            eq(ukviComplianceAlerts.tenantId, tenantId),
            eq(ukviComplianceAlerts.enrolmentId, enrolmentId),
            eq(ukviComplianceAlerts.alertTypeCode, alertTypeCode),
            ...(includeResolvedDuplicates ? [] : [isNull(ukviComplianceAlerts.resolvedAt)]),
          ),
        )
        .limit(1),
    );
    if (existing[0]) return null;

    // Use ON CONFLICT DO NOTHING against the unique partial index
    // (tenant_id, enrolment_id, alert_type_code) WHERE resolved_at IS NULL
    // to guard against a concurrent insert that passed the SELECT check above.
    const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(ukviComplianceAlerts)
        .values({
          tenantId,
          enrolmentId,
          casReference,
          alertTypeCode,
          triggeredAt,
          resolvedAt: null,
          resolvedBy: null,
        })
        .onConflictDoNothing()
        .returning({ id: ukviComplianceAlerts.id }),
    );

    if (!inserted[0]) return null; // concurrent insert won the race; not an error
    const alertId = inserted[0].id;
    await this.#publishComplianceAlertRaised(tenantId, actorId, {
      enrolmentId,
      alertTypeCode,
      casReference,
      triggeredAt: triggeredAt.toISOString(),
    });
    return alertId;
  }

  async #validateVisaStatus(tenantId: string, statusCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue('ukvi_visa_status', 'status_code', statusCode, tenantId);
    if (!isValid) {
      throw new ValidationError(
        `Invalid UKVI visa status '${statusCode}'`,
        [{ field: 'statusCode', message: `Value '${statusCode}' is not active in the configured value set` }],
      );
    }
  }

  async #getAttendanceThreshold(tenantId: string): Promise<number> {
    try {
      const rule = await this.rules.getRule<{ maxUnauthorisedAbsences?: number; threshold?: number } | number>(
        { tenantId, programmeId: '' },
        'ukvi-attendance-threshold',
        'default',
      );
      if (typeof rule === 'number') return rule;
      return rule.maxUnauthorisedAbsences ?? rule.threshold ?? 10;
    } catch {
      return 10;
    }
  }

  async #publishCasRequested(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUkviCasRequestedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_UKVI_CAS_REQUESTED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  async #publishCasAssigned(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUkviCasAssignedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_UKVI_CAS_ASSIGNED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  async #publishAttendanceSubmitted(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUkviAttendanceSubmittedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_UKVI_ATTENDANCE_SUBMITTED, '1.0.0', tenantId, actorId, 'regulatory', payload);
  }

  async #publishVisaStatusUpdated(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUkviVisaStatusUpdatedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_UKVI_VISA_STATUS_UPDATED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  async #publishComplianceAlertRaised(
    tenantId: string,
    actorId: string,
    payload: RegulatoryUkviComplianceAlertRaisedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_UKVI_COMPLIANCE_ALERT, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }
}

function mapCasPersonData(row: CasSourceRow): UkviPersonData {
  return {
    personId: row.person_id,
    legalFirstName: row.legal_first_name,
    legalFamilyName: row.legal_family_name,
    dateOfBirth: row.date_of_birth,
    nationalityCode: row.nationality_code,
    programmeId: row.programme_id,
    programmeCode: row.programme_code,
    programmeTitle: row.programme_title,
    modeOfStudyCode: row.mode_of_study_code,
    academicYearOfEntry: row.academic_year_of_entry,
    startDate: row.start_date,
    expectedEndDate: row.expected_end_date,
  };
}

function toCasDto(row: UkviCasRequest): UkviCasRequestDto {
  return {
    casRequestId: row.id,
    enrolmentId: row.enrolmentId,
    casReference: row.casReference,
    statusCode: row.statusCode,
    requestedAt: row.requestedAt,
  };
}

function toEvidenceSnapshotDto(
  row: typeof ukviEngagementEvidenceSnapshots.$inferSelect,
): UkviEvidenceSnapshotDto {
  return {
    snapshotId: row.id,
    enrolmentId: row.enrolmentId,
    engagementAlertId: row.engagementAlertId,
    policyVersionId: row.policyVersionId,
    evidenceWindowFrom: row.evidenceWindowFrom,
    evidenceWindowTo: row.evidenceWindowTo,
    evidenceSummary: row.evidenceSummary,
    evidenceHash: row.evidenceHash,
    evidenceQualityCode: row.evidenceQualityCode,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function toSponsorDecisionDto(
  row: typeof ukviSponsorDecisions.$inferSelect,
): UkviSponsorDecisionDto {
  return {
    decisionId: row.id,
    enrolmentId: row.enrolmentId,
    evidenceSnapshotId: row.evidenceSnapshotId,
    outcomeCode: row.outcomeCode,
    rationaleCode: row.rationaleCode,
    guidanceVersion: row.guidanceVersion,
    statusCode: row.statusCode,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    authorisedAt: row.authorisedAt,
    authorisedBy: row.authorisedBy,
    externalReportId: row.externalReportId,
  };
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function extractAttendanceStudents(payload: unknown): Array<{
  enrolmentId: string;
  casReference: string | null;
  absenceCount: number;
}> {
  if (!payload || typeof payload !== 'object') return [];
  const students = (payload as { students?: unknown }).students;
  if (!Array.isArray(students)) return [];

  return students
    .map((student) => {
      if (!student || typeof student !== 'object') return null;
      const record = student as Record<string, unknown>;
      const enrolmentId = typeof record['enrolmentId'] === 'string' ? record['enrolmentId'] : null;
      if (!enrolmentId) return null;
      const absenceCount = typeof record['absenceCount'] === 'number' ? record['absenceCount'] : 0;
      const casReference = typeof record['casReference'] === 'string' ? record['casReference'] : null;
      return { enrolmentId, casReference, absenceCount };
    })
    .filter((student): student is { enrolmentId: string; casReference: string | null; absenceCount: number } => Boolean(student));
}
