import { createHash, randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import {
  hesaIdentifierAssignments,
  hesaStudentReturnRecords,
  hesaStudentReturns,
  hesaSubmissions,
  hesaValidationIssues,
  hesaValidationReports,
  type Db,
  type HesaStudentReturn,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatoryHesaIdAssignedV1Payload,
  type RegulatoryHesaReturnGeneratedV1Payload,
  type RegulatoryHesaReturnSubmittedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { StudentService } from '../students/service.js';
import { clockNow } from '../clock.js';

import { RegulatoryExchangeService } from './exchange-service.js';

interface HesaEnrolmentRow {
  enrolment_id: string;
  mode_of_study_code: string;
  fee_band_code: string | null;
  academic_year_of_entry: string;
  programme_code: string | null;
  qualification_type_code: string | null;
  owning_school: string | null;
}

interface HesaSourceRow {
  person_id: string;
  hesa_id: string | null;
  legal_first_name: string | null;
  legal_family_name: string | null;
  date_of_birth: string | null;
  gender_code: string | null;
  nationality_code: string | null;
  enrolments: HesaEnrolmentRow[];
  // Representative enrolment used for top-level HESA fields (first by academic_year_of_entry)
  mode_of_study_code: string;
  fee_band_code: string | null;
  academic_year_of_entry: string;
  programme_code: string | null;
  qualification_type_code: string | null;
  owning_school: string | null;
}

export interface HesaReturnDto {
  returnId: string;
  academicYear: string;
  statusCode: string;
  submittedAt: Date | null;
  validatedAt: Date | null;
  submissionReference: string | null;
  amendmentOfId: string | null;
  generatedBy: string;
  generatedAt: Date;
  recordCount: number;
  /** Number of records that differ from the original return (non-null when amendmentOfId is set). */
  amendedRecordCount: number | null;
  validationSummary: {
    blockingErrorCount: number;
    warningCount: number;
  };
}

export interface HesaValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; enrolmentId: string | null; message: string }>;
  warnings: Array<{ field: string; enrolmentId: string | null; message: string }>;
}

export interface HesaValidationReportPayload {
  issues?: Array<{
    studentReference?: string;
    enrolmentId?: string;
    fieldCode?: string;
    severityCode?: 'error' | 'warning';
    message?: string;
    externalReference?: string;
  }>;
  identifierAssignments?: Array<{
    studentReference?: string;
    enrolmentId?: string;
    hesaId: string;
  }>;
  [key: string]: unknown;
}

export class HesaService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly students: StudentService,
    exchanges?: RegulatoryExchangeService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async generateStudentReturn(
    tenantId: string,
    academicYear: string,
    actorId: string,
    amendmentOfId?: string | null,
  ): Promise<string> {
    if (amendmentOfId) {
      const original = await this.#getReturnRow(amendmentOfId, tenantId);
      if (!original) throw new NotFoundError('HESA return', amendmentOfId);
    }

    const returnId = randomUUID();
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(hesaStudentReturns).values({
        id: returnId,
        tenantId,
        academicYear,
        statusCode: 'draft',
        amendmentOfId: amendmentOfId ?? null,
        generatedBy: actorId,
        generatedAt: now,
      });
    });

    const sourceRows = await this.#loadSourceRows(tenantId, academicYear);

    // For amendment returns, load the original records keyed by person_id so we can
    // diff new payloads against the original and satisfy HES-005 delta tracking.
    const originalRecordsByPersonId = amendmentOfId
      ? await this.#loadRecordsByPersonId(amendmentOfId, tenantId)
      : new Map<string, typeof hesaStudentReturnRecords.$inferSelect>();

    await withTenantContext(this.db, tenantId, async (tx) => {
      for (const source of sourceRows) {
        const payload = mapStudentToHesa(source);
        const amendmentDiff = amendmentOfId
          ? diffHesaPayload(originalRecordsByPersonId.get(source.person_id)?.recordPayload, payload)
          : null;
        // enrolmentId on the record stores the representative (first) enrolment for this person.
        // Multiple enrolments are captured inside recordPayload._enrolments.
        await tx.insert(hesaStudentReturnRecords).values({
          hesaStudentReturnId: returnId,
          enrolmentId: source.enrolments[0]!.enrolment_id,
          hesaId: source.hesa_id,
          recordPayload: payload,
          amendmentDiff,
        });
      }
    });

    await this.#publishReturnGenerated(tenantId, actorId, {
      returnId,
      academicYear,
      recordCount: sourceRows.length,
      generatedAt: now.toISOString(),
    });

    return returnId;
  }

  async validateReturn(returnId: string, tenantId: string, actorId: string): Promise<HesaValidationResult> {
    await this.#requireReturn(returnId, tenantId);
    const records = await this.#getRecords(returnId, tenantId);
    const result = validateHesaRecords(records);
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      const reportRows = await tx
        .insert(hesaValidationReports)
        .values({
          hesaStudentReturnId: returnId,
          integrationExchangeId: null,
          sourceCode: 'internal',
          receivedAt: now,
          receivedBy: actorId,
          rawPayload: { ...result },
          blockingErrorCount: result.errors.length,
          warningCount: result.warnings.length,
        })
        .returning({ id: hesaValidationReports.id });

      const reportId = reportRows[0]!.id;
      for (const issue of [...result.errors, ...result.warnings]) {
        await tx.insert(hesaValidationIssues).values({
          hesaValidationReportId: reportId,
          hesaStudentReturnRecordId: findRecordId(records, issue.enrolmentId),
          enrolmentId: issue.enrolmentId,
          fieldCode: issue.field,
          severityCode: result.errors.includes(issue) ? 'error' : 'warning',
          message: issue.message,
          externalReference: null,
        });
      }

      if (result.isValid) {
        await tx
          .update(hesaStudentReturns)
          .set({ statusCode: 'validated', validatedAt: now })
          .where(and(eq(hesaStudentReturns.id, returnId), eq(hesaStudentReturns.tenantId, tenantId)));
      }
    });

    return result;
  }

  async generateSubmissionFile(returnId: string, tenantId: string, actorId: string): Promise<Buffer> {
    const hesaReturn = await this.#requireReturn(returnId, tenantId);
    if (hesaReturn.statusCode === 'draft') {
      throw new ValidationError('HESA return must be validated before a submission file can be generated');
    }

    const records = await this.#getRecords(returnId, tenantId);
    const xml = serialiseHesaXml(hesaReturn.academicYear, records.map((r) => r.recordPayload as HesaRecordPayload));
    const payloadHash = createHash('sha256').update(xml).digest('hex');

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'hesa-student-return.{year}',
      {
        directionCode: 'outbound',
        exchangeTypeCode: 'hesa-submission-file',
        idempotencyKey: `hesa:${returnId}:file:${payloadHash}`,
        payloadHash,
        payloadSummary: {
          returnId,
          academicYear: hesaReturn.academicYear,
          recordCount: records.length,
        },
      },
      actorId,
    );

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(hesaSubmissions).values({
        hesaStudentReturnId: returnId,
        integrationExchangeId: exchange.id,
        payloadHash,
        payloadSummary: {
          academicYear: hesaReturn.academicYear,
          recordCount: records.length,
        },
        generatedBy: actorId,
      }).onConflictDoNothing();
    });

    return Buffer.from(xml, 'utf8');
  }

  async processValidationReport(
    returnId: string,
    tenantId: string,
    report: HesaValidationReportPayload,
    actorId: string,
  ): Promise<{ reportId: string; assignmentsProcessed: number; blockingErrorCount: number; warningCount: number }> {
    await this.#requireReturn(returnId, tenantId);
    const records = await this.#getRecords(returnId, tenantId);
    const issues = report.issues ?? [];
    const blockingErrorCount = issues.filter((i) => i.severityCode === 'error').length;
    const warningCount = issues.filter((i) => i.severityCode !== 'error').length;
    const payloadHash = createHash('sha256').update(JSON.stringify(report)).digest('hex');

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'hesa-student-return.{year}',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'hesa-validation-report',
        idempotencyKey: `hesa:${returnId}:validation-report:${payloadHash}`,
        payloadHash,
        payloadSummary: {
          returnId,
          issueCount: issues.length,
          assignmentCount: report.identifierAssignments?.length ?? 0,
        },
      },
      actorId,
    );

    let reportId = '';
    await withTenantContext(this.db, tenantId, async (tx) => {
      const reportRows = await tx
        .insert(hesaValidationReports)
        .values({
          hesaStudentReturnId: returnId,
          integrationExchangeId: exchange.id,
          sourceCode: 'hesa-authority',
          receivedBy: actorId,
          rawPayload: report,
          blockingErrorCount,
          warningCount,
        })
        .returning({ id: hesaValidationReports.id });

      reportId = reportRows[0]!.id;

      for (const issue of issues) {
        const record = matchRecord(records, issue.studentReference, issue.enrolmentId);
        await tx.insert(hesaValidationIssues).values({
          hesaValidationReportId: reportId,
          hesaStudentReturnRecordId: record?.id ?? null,
          enrolmentId: issue.enrolmentId ?? getPayloadString(record?.recordPayload, '_enrolmentId'),
          fieldCode: issue.fieldCode ?? 'UNKNOWN',
          severityCode: issue.severityCode ?? 'warning',
          message: issue.message ?? 'HESA validation issue',
          externalReference: issue.externalReference ?? null,
        });
      }
    });

    let assignmentsProcessed = 0;
    for (const assignment of report.identifierAssignments ?? []) {
      const record = matchRecord(records, assignment.studentReference, assignment.enrolmentId);
      if (!record) continue;
      const payload = record.recordPayload as HesaRecordPayload;
      const personId = getPayloadString(payload, '_personId');
      const enrolmentId = getPayloadString(payload, '_enrolmentId');
      if (!personId || !enrolmentId) continue;

      await this.students.updateHesaId(personId, tenantId, assignment.hesaId);
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx
          .update(hesaStudentReturnRecords)
          .set({ hesaId: assignment.hesaId })
          .where(eq(hesaStudentReturnRecords.id, record.id));

        await tx.insert(hesaIdentifierAssignments).values({
          hesaStudentReturnId: returnId,
          hesaStudentReturnRecordId: record.id,
          personId,
          enrolmentId,
          hesaId: assignment.hesaId,
          assignedBy: actorId,
        });
      });

      assignmentsProcessed += 1;
      await this.#publishHesaIdAssigned(tenantId, actorId, {
        returnId,
        enrolmentId,
        hesaId: assignment.hesaId,
        assignedAt: clockNow().toISOString(),
      });
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(hesaStudentReturns)
        .set({ statusCode: blockingErrorCount > 0 ? 'amendment-required' : 'validation-report-received' })
        .where(and(eq(hesaStudentReturns.id, returnId), eq(hesaStudentReturns.tenantId, tenantId)));
    });

    return { reportId, assignmentsProcessed, blockingErrorCount, warningCount };
  }

  async markSubmitted(
    returnId: string,
    tenantId: string,
    submissionReference: string | null,
    actorId: string,
  ): Promise<void> {
    const hesaReturn = await this.#requireReturn(returnId, tenantId);
    const now = clockNow();

    const submissions = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(hesaSubmissions)
        .where(eq(hesaSubmissions.hesaStudentReturnId, returnId))
        .limit(1),
    );
    if (submissions.length === 0) {
      throw new ValidationError('A generated HESA submission file is required before marking the return submitted');
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(hesaSubmissions)
        .set({ submittedAt: now, submissionReference })
        .where(eq(hesaSubmissions.hesaStudentReturnId, returnId));

      await tx
        .update(hesaStudentReturns)
        .set({ statusCode: 'submitted', submittedAt: now, submissionReference })
        .where(and(eq(hesaStudentReturns.id, returnId), eq(hesaStudentReturns.tenantId, tenantId)));
    });

    await this.#publishReturnSubmitted(tenantId, actorId, {
      returnId,
      academicYear: hesaReturn.academicYear,
      submissionReference,
      submittedAt: now.toISOString(),
    });
  }

  async generateAmendment(returnId: string, tenantId: string, actorId: string): Promise<string> {
    const hesaReturn = await this.#requireReturn(returnId, tenantId);
    if (hesaReturn.statusCode !== 'amendment-required') {
      throw new ValidationError('Only returns in amendment-required status can generate amendments');
    }
    return this.generateStudentReturn(tenantId, hesaReturn.academicYear, actorId, returnId);
  }

  async getReturn(returnId: string, tenantId: string): Promise<HesaReturnDto> {
    const hesaReturn = await this.#requireReturn(returnId, tenantId);
    return this.#toDto(hesaReturn, tenantId);
  }

  async listReturns(tenantId: string, academicYear?: string): Promise<HesaReturnDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(hesaStudentReturns)
        .where(
          and(
            eq(hesaStudentReturns.tenantId, tenantId),
            ...(academicYear ? [eq(hesaStudentReturns.academicYear, academicYear)] : []),
          ),
        ),
    );

    return Promise.all(rows.map((row) => this.#toDto(row, tenantId)));
  }

  async #loadSourceRows(tenantId: string, academicYear: string): Promise<HesaSourceRow[]> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      // One row per enrolment; grouped into one HesaSourceRow per person below.
      const rawRows = await tx.execute(sql`
        SELECT
          e.id AS enrolment_id,
          e.person_id,
          p.hesa_id,
          pi.legal_first_name,
          pi.legal_family_name,
          pi.date_of_birth,
          pi.gender_code,
          pi.nationality_code,
          e.mode_of_study_code,
          e.fee_band_code,
          e.academic_year_of_entry,
          pr.code AS programme_code,
          pr.qualification_type_code,
          pr.owning_school
        FROM enrolment e
        JOIN person p
          ON p.id = e.person_id
         AND p.tenant_id = e.tenant_id
        LEFT JOIN person_identity pi
          ON pi.person_id = p.id
         AND pi.tenant_id = e.tenant_id
         AND pi.recorded_until IS NULL
        LEFT JOIN programme pr
          ON pr.id = e.programme_id
         AND pr.tenant_id = e.tenant_id
         AND pr.recorded_until IS NULL
        WHERE e.tenant_id = ${tenantId}
          AND e.recorded_until IS NULL
          AND e.academic_year_of_entry = ${academicYear}
        ORDER BY e.person_id, e.academic_year_of_entry
      `) as unknown as Array<{
        enrolment_id: string; person_id: string; hesa_id: string | null;
        legal_first_name: string | null; legal_family_name: string | null;
        date_of_birth: string | null; gender_code: string | null; nationality_code: string | null;
        mode_of_study_code: string; fee_band_code: string | null; academic_year_of_entry: string;
        programme_code: string | null; qualification_type_code: string | null; owning_school: string | null;
      }>;

      // Group by person_id so that each person produces exactly one HESA record (one HUSID).
      // If a student has multiple enrolments in the same academic year (programme transfer),
      // their enrolments are listed under MODS and the first enrolment drives top-level fields.
      const byPerson = new Map<string, HesaSourceRow>();
      for (const row of rawRows) {
        const enrolmentRow: HesaEnrolmentRow = {
          enrolment_id: row.enrolment_id,
          mode_of_study_code: row.mode_of_study_code,
          fee_band_code: row.fee_band_code,
          academic_year_of_entry: row.academic_year_of_entry,
          programme_code: row.programme_code,
          qualification_type_code: row.qualification_type_code,
          owning_school: row.owning_school,
        };

        const existing = byPerson.get(row.person_id);
        if (existing) {
          existing.enrolments.push(enrolmentRow);
        } else {
          byPerson.set(row.person_id, {
            person_id:           row.person_id,
            hesa_id:             row.hesa_id,
            legal_first_name:    row.legal_first_name,
            legal_family_name:   row.legal_family_name,
            date_of_birth:       row.date_of_birth,
            gender_code:         row.gender_code,
            nationality_code:    row.nationality_code,
            enrolments:          [enrolmentRow],
            // Top-level HESA fields taken from the first (earliest) enrolment
            mode_of_study_code:  row.mode_of_study_code,
            fee_band_code:       row.fee_band_code,
            academic_year_of_entry: row.academic_year_of_entry,
            programme_code:      row.programme_code,
            qualification_type_code: row.qualification_type_code,
            owning_school:       row.owning_school,
          });
        }
      }
      return [...byPerson.values()];
    });
  }

  async #requireReturn(returnId: string, tenantId: string): Promise<HesaStudentReturn> {
    const hesaReturn = await this.#getReturnRow(returnId, tenantId);
    if (!hesaReturn) throw new NotFoundError('HESA return', returnId);
    return hesaReturn;
  }

  async #getReturnRow(returnId: string, tenantId: string): Promise<HesaStudentReturn | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(hesaStudentReturns)
        .where(and(eq(hesaStudentReturns.id, returnId), eq(hesaStudentReturns.tenantId, tenantId)))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async #getRecords(returnId: string, tenantId: string) {
    await this.#requireReturn(returnId, tenantId);
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(hesaStudentReturnRecords)
        .where(eq(hesaStudentReturnRecords.hesaStudentReturnId, returnId)),
    );
  }

  async #loadRecordsByPersonId(
    returnId: string,
    tenantId: string,
  ): Promise<Map<string, typeof hesaStudentReturnRecords.$inferSelect>> {
    const records = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(hesaStudentReturnRecords)
        .where(eq(hesaStudentReturnRecords.hesaStudentReturnId, returnId)),
    );
    const byPersonId = new Map<string, typeof hesaStudentReturnRecords.$inferSelect>();
    for (const record of records) {
      const personId = getPayloadString(record.recordPayload, '_personId');
      if (personId) byPersonId.set(personId, record);
    }
    return byPersonId;
  }

  async #toDto(row: HesaStudentReturn, tenantId: string): Promise<HesaReturnDto> {
    const summaryRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM hesa_student_return_record WHERE hesa_student_return_id = ${row.id}) AS record_count,
          (SELECT count(*)::int FROM hesa_student_return_record WHERE hesa_student_return_id = ${row.id} AND amendment_diff IS NOT NULL AND amendment_diff != '{}'::jsonb) AS amended_record_count,
          COALESCE((
            SELECT blocking_error_count FROM hesa_validation_report
            WHERE hesa_student_return_id = ${row.id}
              AND source_code = 'hesa-authority'
            ORDER BY received_at DESC LIMIT 1
          ), (
            SELECT blocking_error_count FROM hesa_validation_report
            WHERE hesa_student_return_id = ${row.id}
              AND source_code = 'internal'
            ORDER BY received_at DESC LIMIT 1
          ), 0)::int AS blocking_error_count,
          COALESCE((
            SELECT warning_count FROM hesa_validation_report
            WHERE hesa_student_return_id = ${row.id}
              AND source_code = 'hesa-authority'
            ORDER BY received_at DESC LIMIT 1
          ), (
            SELECT warning_count FROM hesa_validation_report
            WHERE hesa_student_return_id = ${row.id}
              AND source_code = 'internal'
            ORDER BY received_at DESC LIMIT 1
          ), 0)::int AS warning_count
      `) as Promise<Array<{ record_count: number; amended_record_count: number; blocking_error_count: number; warning_count: number }>>,
    );
    const summary = summaryRows[0] ?? { record_count: 0, amended_record_count: 0, blocking_error_count: 0, warning_count: 0 };

    return {
      returnId: row.id,
      academicYear: row.academicYear,
      statusCode: row.statusCode,
      submittedAt: row.submittedAt,
      validatedAt: row.validatedAt,
      submissionReference: row.submissionReference,
      amendmentOfId: row.amendmentOfId,
      generatedBy: row.generatedBy,
      generatedAt: row.generatedAt,
      recordCount: summary.record_count,
      amendedRecordCount: row.amendmentOfId ? summary.amended_record_count : null,
      validationSummary: {
        blockingErrorCount: summary.blocking_error_count,
        warningCount: summary.warning_count,
      },
    };
  }

  async #publishReturnGenerated(
    tenantId: string,
    actorId: string,
    payload: RegulatoryHesaReturnGeneratedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_HESA_RETURN_GENERATED, '1.0.0', tenantId, actorId, 'regulatory', payload);
  }

  async #publishReturnSubmitted(
    tenantId: string,
    actorId: string,
    payload: RegulatoryHesaReturnSubmittedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_HESA_RETURN_SUBMITTED, '1.0.0', tenantId, actorId, 'regulatory', payload);
  }

  async #publishHesaIdAssigned(
    tenantId: string,
    actorId: string,
    payload: RegulatoryHesaIdAssignedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_HESA_ID_ASSIGNED, '1.0.0', tenantId, actorId, 'regulatory', payload);
  }
}

type HesaReturnRecord = typeof hesaStudentReturnRecords.$inferSelect;
type HesaRecordPayload = Record<string, unknown>;

function mapStudentToHesa(source: HesaSourceRow): HesaRecordPayload {
  // Use the first enrolment for top-level HESA fields; all enrolments are listed under _enrolments.
  const primaryEnrolment = source.enrolments[0]!;
  return {
    _personId: source.person_id,
    _enrolmentId: primaryEnrolment.enrolment_id,
    _enrolments: source.enrolments,
    HUSID: source.hesa_id,
    SURNAME: source.legal_family_name,
    FNAMES: source.legal_first_name,
    BIRTHDTE: source.date_of_birth,
    SEXID: source.gender_code,
    NATION: source.nationality_code,
    MODE: mapMode(primaryEnrolment.mode_of_study_code),
    MSTUFEE: primaryEnrolment.fee_band_code,
    YEARPRG: 1,
    QUALAID: primaryEnrolment.qualification_type_code,
    SBJCA: primaryEnrolment.owning_school,
    ITTSCHM: null,
    PROGRAMME: primaryEnrolment.programme_code,
    MODS: [],
    _mapping_note: 'Fields without direct SRS source are emitted as null for institutional completion.',
  };
}

function validateHesaRecords(records: HesaReturnRecord[]): HesaValidationResult {
  const errors: HesaValidationResult['errors'] = [];
  const warnings: HesaValidationResult['warnings'] = [];

  for (const record of records) {
    const payload = record.recordPayload as HesaRecordPayload;
    const enrolmentId = getPayloadString(payload, '_enrolmentId') ?? record.enrolmentId;
    const birthDate = getPayloadString(payload, 'BIRTHDTE');
    const mode = getPayloadString(payload, 'MODE');
    const year = payload['YEARPRG'];

    if (!birthDate || Number.isNaN(Date.parse(birthDate))) {
      errors.push({ field: 'BIRTHDTE', enrolmentId, message: 'Birth date is required and must be a valid date' });
    } else if (ageAt(new Date(birthDate), clockNow()) < 16) {
      errors.push({ field: 'BIRTHDTE', enrolmentId, message: 'Student must be at least 16 years old' });
    }

    if (!mode || !['01', '02', '03', '04'].includes(mode)) {
      errors.push({ field: 'MODE', enrolmentId, message: 'Mode of study must map to a valid HESA MODE code' });
    }

    if (typeof year !== 'number' || year < 1) {
      errors.push({ field: 'YEARPRG', enrolmentId, message: 'Year of programme must be a positive integer' });
    }

    if (payload['QUALDEG'] && !payload['CLSSHDG']) {
      errors.push({ field: 'CLSSHDG', enrolmentId, message: 'Classification is required when qualification degree is present' });
    }

    if (!payload['HUSID']) {
      warnings.push({ field: 'HUSID', enrolmentId, message: 'HESA ID is not assigned yet; first submission may request assignment' });
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

function serialiseHesaXml(academicYear: string, records: HesaRecordPayload[]): string {
  const students = records.map((record) => {
    const fields = ['HUSID', 'SURNAME', 'FNAMES', 'BIRTHDTE', 'SEXID', 'NATION', 'MODE', 'MSTUFEE', 'YEARPRG', 'QUALAID', 'SBJCA', 'ITTSCHM'];
    const body = fields
      .map((field) => `    <${field}>${escapeXml(record[field] ?? '')}</${field}>`)
      .join('\n');
    return `  <Student>\n${body}\n  </Student>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<StudentReturn academicYear="${escapeXml(academicYear)}">\n${students}\n</StudentReturn>\n`;
}

function matchRecord(records: HesaReturnRecord[], studentReference?: string, enrolmentId?: string): HesaReturnRecord | undefined {
  return records.find((record) => {
    const payload = record.recordPayload as HesaRecordPayload;
    const enrolments = Array.isArray(payload['_enrolments'])
      ? (payload['_enrolments'] as Array<{ enrolment_id: string }>)
      : [];
    const anyEnrolmentMatch = enrolmentId
      ? enrolments.some((e) => e.enrolment_id === enrolmentId)
      : false;
    return (
      anyEnrolmentMatch ||
      record.enrolmentId === enrolmentId ||
      getPayloadString(payload, '_personId') === studentReference ||
      getPayloadString(payload, 'HUSID') === studentReference ||
      getPayloadString(payload, '_enrolmentId') === studentReference ||
      record.id === studentReference
    );
  });
}

/**
 * Returns a field-level diff between an original HESA record payload and its amended version.
 * Only HESA-coded fields (those not prefixed with '_') are compared.
 * Returns null when there is no original to compare against (new students in an amendment).
 */
function diffHesaPayload(
  original: HesaRecordPayload | undefined,
  amended: HesaRecordPayload,
): Record<string, { previous: unknown; current: unknown }> | null {
  if (!original) return null; // student is new in this amendment — no prior record to diff against
  const diff: Record<string, { previous: unknown; current: unknown }> = {};
  const hesaFields = Object.keys(amended).filter((k) => !k.startsWith('_'));
  for (const field of hesaFields) {
    const prev = original[field];
    const curr = amended[field];
    if (JSON.stringify(prev) !== JSON.stringify(curr)) {
      diff[field] = { previous: prev ?? null, current: curr ?? null };
    }
  }
  return Object.keys(diff).length > 0 ? diff : {};
}

function findRecordId(records: HesaReturnRecord[], enrolmentId: string | null): string | null {
  if (!enrolmentId) return null;
  return records.find((r) => r.enrolmentId === enrolmentId)?.id ?? null;
}

function getPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapMode(modeOfStudyCode: string): string {
  switch (modeOfStudyCode) {
    case 'full-time': return '01';
    case 'part-time': return '02';
    case 'distance': return '03';
    case 'sandwich': return '04';
    default: return modeOfStudyCode;
  }
}

function ageAt(birthDate: Date, at: Date): number {
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
