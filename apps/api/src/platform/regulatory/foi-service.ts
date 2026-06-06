import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  foiExtracts,
  foiRequests,
  type Db,
  type FoiRequest,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';

export interface FoiRequestInput {
  requestReference: string;
  receivedDate: string;
  description: string;
  legalBasis?: string | null;
}

export interface FoiRequestDto {
  requestId: string;
  requestReference: string;
  receivedDate: string;
  statutoryDeadlineDate: string;
  description: string;
  statusCode: string;
  legalBasis: string | null;
  closedAt: Date | null;
}

export interface FoiExtractDto {
  extractId: string;
  requestId: string;
  generatedAt: Date;
  generatedBy: string;
  querySummary: string;
  recordCount: number;
  payload: Record<string, unknown>;
}

interface AggregateRow {
  academic_year: string;
  enrolment_count: number | string;
  active_count: number | string;
  withdrawn_count: number | string;
  award_count: number | string;
}

interface PiiRow {
  student_number: string;
  enrolment_id: string;
  status_code: string;
  legal_first_name: string;
  legal_family_name: string;
}

export class FoiService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
  ) {}

  async recordRequest(
    tenantId: string,
    input: FoiRequestInput,
    actorId: string,
  ): Promise<{ requestId: string; statutoryDeadlineDate: string }> {
    if (!input.requestReference.trim()) throw new ValidationError('FOI request reference is required');
    if (!input.description.trim()) throw new ValidationError('FOI request description is required');
    const receivedDate = parseIsoDate(input.receivedDate, 'receivedDate');
    const statutoryDeadlineDate = addWorkingDays(receivedDate, 20);
    const requestId = randomUUID();
    const now = new Date();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(foiRequests).values({
        versionId: randomUUID(),
        id: requestId,
        tenantId,
        requestReference: input.requestReference,
        receivedDate: input.receivedDate,
        statutoryDeadlineDate: toIsoDate(statutoryDeadlineDate),
        description: input.description,
        statusCode: 'received',
        legalBasis: input.legalBasis ?? null,
        closedAt: null,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    return { requestId, statutoryDeadlineDate: toIsoDate(statutoryDeadlineDate) };
  }

  async generateExtract(
    requestId: string,
    tenantId: string,
    querySummary: string,
    actorId: string,
  ): Promise<FoiExtractDto> {
    if (!querySummary.trim()) throw new ValidationError('FOI extract query summary is required');
    const request = await this.#requireRequest(requestId, tenantId);
    if (request.statusCode === 'responded' || request.statusCode === 'refused') {
      throw new ValidationError(`Cannot generate FOI extract for request in '${request.statusCode}' status`);
    }

    const includePii = hasDpaLegalBasis(request.legalBasis);
    const aggregateRows = await this.#loadAggregateRows(tenantId);
    const piiRows = includePii ? await this.#loadPiiRows(tenantId) : [];
    const payload: Record<string, unknown> = {
      requestId,
      requestReference: request.requestReference,
      querySummary,
      generatedAt: new Date().toISOString(),
      piiIncluded: includePii,
      aggregates: aggregateRows.map((row) => ({
        academicYear: row.academic_year,
        enrolmentCount: toNumber(row.enrolment_count),
        activeCount: toNumber(row.active_count),
        withdrawnCount: toNumber(row.withdrawn_count),
        awardCount: toNumber(row.award_count),
      })),
      records: includePii
        ? piiRows.map((row) => ({
            studentNumber: row.student_number,
            enrolmentId: row.enrolment_id,
            statusCode: row.status_code,
            legalFirstName: row.legal_first_name,
            legalFamilyName: row.legal_family_name,
          }))
        : [],
      dataProtectionNotes: includePii
        ? ['PII included because the FOI request has a DPA legal basis.']
        : ['Default FOI extract excludes PII; only aggregate data is returned.'],
    };
    const recordCount = includePii
      ? piiRows.length
      : aggregateRows.reduce((sum, row) => sum + toNumber(row.enrolment_count), 0);
    const extractId = randomUUID();
    const generatedAt = new Date();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(foiExtracts).values({
        id: extractId,
        tenantId,
        foiRequestId: requestId,
        generatedAt,
        generatedBy: actorId,
        querySummary,
        recordCount,
        extractPayload: payload,
      });
    });

    return {
      extractId,
      requestId,
      generatedAt,
      generatedBy: actorId,
      querySummary,
      recordCount,
      payload,
    };
  }

  async updateRequestStatus(
    requestId: string,
    tenantId: string,
    statusCode: string,
    actorId: string,
  ): Promise<FoiRequestDto> {
    await this.#validateStatus(tenantId, statusCode);
    const current = await this.#requireRequest(requestId, tenantId);
    const now = new Date();
    const closedAt = statusCode === 'responded' || statusCode === 'refused'
      ? now
      : current.closedAt;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(foiRequests)
        .set({ recordedUntil: now })
        .where(
          and(
            eq(foiRequests.id, requestId),
            eq(foiRequests.tenantId, tenantId),
            isNull(foiRequests.recordedUntil),
          ),
        );

      await tx.insert(foiRequests).values({
        versionId: randomUUID(),
        id: current.id,
        tenantId,
        requestReference: current.requestReference,
        receivedDate: current.receivedDate,
        statutoryDeadlineDate: current.statutoryDeadlineDate,
        description: current.description,
        statusCode,
        legalBasis: current.legalBasis,
        closedAt,
        validFrom: current.validFrom,
        validTo: current.validTo,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    return {
      ...toRequestDto(current),
      statusCode,
      closedAt,
    };
  }

  async listRequests(tenantId: string, filters: { statusCode?: string; dueWithinDays?: number } = {}): Promise<FoiRequestDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(foiRequests)
        .where(
          and(
            eq(foiRequests.tenantId, tenantId),
            isNull(foiRequests.recordedUntil),
            ...(filters.statusCode ? [eq(foiRequests.statusCode, filters.statusCode)] : []),
          ),
        ),
    );

    const dueDate = typeof filters.dueWithinDays === 'number'
      ? addDays(new Date(), filters.dueWithinDays)
      : null;
    return rows
      .filter((row) => !dueDate || parseIsoDate(row.statutoryDeadlineDate, 'statutoryDeadlineDate') <= dueDate)
      .map(toRequestDto);
  }

  async getRequest(requestId: string, tenantId: string): Promise<FoiRequestDto> {
    return toRequestDto(await this.#requireRequest(requestId, tenantId));
  }

  async #requireRequest(requestId: string, tenantId: string): Promise<FoiRequest> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(foiRequests)
        .where(
          and(
            eq(foiRequests.id, requestId),
            eq(foiRequests.tenantId, tenantId),
            isNull(foiRequests.recordedUntil),
          ),
        )
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('FOI request', requestId);
    return rows[0];
  }

  async #validateStatus(tenantId: string, statusCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue('foi_request', 'status_code', statusCode, tenantId);
    if (!isValid) {
      throw new ValidationError(
        `Invalid FOI request status '${statusCode}'`,
        [{ field: 'statusCode', message: `Value '${statusCode}' is not active in the configured value set` }],
      );
    }
  }

  async #loadAggregateRows(tenantId: string): Promise<AggregateRow[]> {
    return (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        WITH enrolment_counts AS (
          SELECT
            academic_year_of_entry,
            COUNT(*) AS enrolment_count,
            COUNT(*) FILTER (WHERE status_code NOT IN ('withdrawn')) AS active_count,
            COUNT(*) FILTER (WHERE status_code = 'withdrawn') AS withdrawn_count
          FROM enrolment
          WHERE tenant_id = ${tenantId}
            AND recorded_until IS NULL
          GROUP BY academic_year_of_entry
        ),
        award_counts AS (
          SELECT
            e.academic_year_of_entry,
            COUNT(*) AS award_count
          FROM award a
          JOIN enrolment e
            ON e.id = a.enrolment_id
           AND e.tenant_id = ${tenantId}
           AND e.recorded_until IS NULL
          WHERE a.tenant_id = ${tenantId}
            AND a.recorded_until IS NULL
          GROUP BY e.academic_year_of_entry
        )
        SELECT
          enrolment_counts.academic_year_of_entry AS academic_year,
          enrolment_counts.enrolment_count,
          enrolment_counts.active_count,
          enrolment_counts.withdrawn_count,
          COALESCE(award_counts.award_count, 0) AS award_count
        FROM enrolment_counts
        LEFT JOIN award_counts
          ON award_counts.academic_year_of_entry = enrolment_counts.academic_year_of_entry
        ORDER BY enrolment_counts.academic_year_of_entry
      `),
    )) as unknown as AggregateRow[];
  }

  async #loadPiiRows(tenantId: string): Promise<PiiRow[]> {
    return (await withTenantContext(this.db, tenantId, async (tx) =>
      tx.execute(sql`
        SELECT
          p.student_number,
          e.id AS enrolment_id,
          e.status_code,
          pi.legal_first_name,
          pi.legal_family_name
        FROM enrolment e
        JOIN person p
          ON p.id = e.person_id
         AND p.tenant_id = ${tenantId}
        JOIN person_identity pi
          ON pi.person_id = e.person_id
         AND pi.tenant_id = ${tenantId}
         AND pi.recorded_until IS NULL
        WHERE e.tenant_id = ${tenantId}
          AND e.recorded_until IS NULL
        ORDER BY p.student_number
      `),
    )) as unknown as PiiRow[];
  }
}

function toRequestDto(row: FoiRequest): FoiRequestDto {
  return {
    requestId: row.id,
    requestReference: row.requestReference,
    receivedDate: row.receivedDate,
    statutoryDeadlineDate: row.statutoryDeadlineDate,
    description: row.description,
    statusCode: row.statusCode,
    legalBasis: row.legalBasis,
    closedAt: row.closedAt,
  };
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) {
    throw new ValidationError(`Invalid ${field} '${value}'`);
  }
  return date;
}

function addWorkingDays(startDate: Date, workingDays: number): Date {
  const date = new Date(startDate);
  let remaining = workingDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date;
}

function addDays(startDate: Date, days: number): Date {
  const date = new Date(startDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function hasDpaLegalBasis(legalBasis: string | null): boolean {
  return legalBasis?.toLowerCase().includes('dpa') ?? false;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}
