import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  casCases,
  casEligibilityChecks,
  casAssignmentVersions,
  sponsorReportVersions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * CAS governance (BPR-D03). cas_case is a separate governed aggregate for
 * CAS sponsor-compliance work, alongside ukvi_cas_request (see UkviService).
 * It adds the eligibility-check, assignment-version and sponsor-report-version
 * evidence trail ukvi_cas_request never captured.
 */

export interface OpenCasCaseInput {
  enrolmentId:         string;
  casReference?:       string;
}

export interface CasCaseDto {
  casCaseId:           string;
  enrolmentId:          string;
  casReference:         string | null;
  statusCode:           string;
  actorId:              string;
  validFrom:             Date;
  validTo:               Date | null;
  recordedAt:            Date;
  recordedUntil:         Date | null;
}

export interface RecordEligibilityCheckInput {
  guidanceVersion: string;
  checkTypeCode:   string;
  resultCode:      string;
  evidenceRef?:    string;
}

export interface RecordAssignmentVersionInput {
  assignedPayloadHash: string;
  casNumber?:          string;
  smsRequestSentAt?:   Date;
  smsReceiptRef?:      string;
}

export interface RecordSponsorReportVersionInput {
  reportPayloadRef:    string;
  distributionItemId?: string;
}

export class CasCaseService {
  constructor(private readonly db: Db) {}

  async openCase(tenantId: string, input: OpenCasCaseInput, actorId: string): Promise<string> {
    const caseId = randomUUID();
    const now    = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(casCases).values({
        versionId:           randomUUID(),
        id:                  caseId as Uuid,
        tenantId:            tenantId as Uuid,
        enrolmentId:         input.enrolmentId as Uuid,
        casReference:        input.casReference ?? null,
        statusCode:          'opened',
        actorId,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });

    return caseId;
  }

  async getCurrentCase(casCaseId: string, tenantId: string): Promise<CasCaseDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(casCases).where(and(
        eq(casCases.id,       casCaseId as Uuid),
        eq(casCases.tenantId, tenantId  as Uuid),
        isNull(casCases.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? caseToDto(rows[0]) : null;
  }

  async #advanceStatus(casCaseId: string, tenantId: string, statusCode: string, actorId: string): Promise<void> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(casCases)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(casCases.id,       casCaseId as Uuid),
          eq(casCases.tenantId, tenantId  as Uuid),
          isNull(casCases.recordedUntil),
        ));

      await tx.insert(casCases).values({
        versionId:          randomUUID(),
        id:                 casCaseId as Uuid,
        tenantId:           tenantId as Uuid,
        enrolmentId:        current.enrolmentId as Uuid,
        casReference:       current.casReference,
        statusCode,
        actorId,
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });
  }

  async recordEligibilityCheck(casCaseId: string, tenantId: string, input: RecordEligibilityCheckInput, actorId: string): Promise<string> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);

    const checkId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(casEligibilityChecks).values({
        id:              checkId,
        tenantId:        tenantId as Uuid,
        casCaseId:       casCaseId as Uuid,
        guidanceVersion: input.guidanceVersion,
        checkTypeCode:   input.checkTypeCode,
        resultCode:      input.resultCode,
        evidenceRef:     input.evidenceRef ? (input.evidenceRef as Uuid) : null,
        checkedBy:       actorId,
        checkedAt:       clockNow(),
      });
    });

    if (current.statusCode === 'opened') {
      await this.#advanceStatus(casCaseId, tenantId, 'eligibility-checked', actorId);
    }

    return checkId;
  }

  async recordAssignmentVersion(casCaseId: string, tenantId: string, input: RecordAssignmentVersionInput, actorId: string): Promise<string> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);

    const priorVersions = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(casAssignmentVersions).where(and(
        eq(casAssignmentVersions.casCaseId, casCaseId as Uuid),
        eq(casAssignmentVersions.tenantId,  tenantId   as Uuid),
      )).orderBy(desc(casAssignmentVersions.versionNumber)).limit(1),
    );
    const nextVersion = (priorVersions[0]?.versionNumber ?? 0) + 1;

    const assignmentId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(casAssignmentVersions).values({
        id:                  assignmentId,
        tenantId:            tenantId as Uuid,
        casCaseId:           casCaseId as Uuid,
        versionNumber:       nextVersion,
        assignedPayloadHash: input.assignedPayloadHash,
        casNumber:           input.casNumber ?? null,
        approvedBy:          actorId,
        approvedAt:          clockNow(),
        smsRequestSentAt:    input.smsRequestSentAt ?? null,
        smsReceiptRef:       input.smsReceiptRef ?? null,
      });
    });

    await this.#advanceStatus(casCaseId, tenantId, 'assigned', actorId);

    return assignmentId;
  }

  async recordSponsorReportVersion(casCaseId: string, tenantId: string, input: RecordSponsorReportVersionInput, actorId: string): Promise<string> {
    const current = await this.getCurrentCase(casCaseId, tenantId);
    if (!current) throw new NotFoundError('CasCase', casCaseId);

    const reportId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(sponsorReportVersions).values({
        id:                  reportId,
        tenantId:            tenantId as Uuid,
        casCaseId:           casCaseId as Uuid,
        reportPayloadRef:    input.reportPayloadRef,
        distributionItemId:  input.distributionItemId ? (input.distributionItemId as Uuid) : null,
        generatedAt:         clockNow(),
        generatedBy:         actorId,
      });
    });

    return reportId;
  }

  async listCasesForEnrolment(enrolmentId: string, tenantId: string): Promise<CasCaseDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(casCases).where(and(
        eq(casCases.enrolmentId, enrolmentId as Uuid),
        eq(casCases.tenantId,    tenantId    as Uuid),
        isNull(casCases.recordedUntil),
      )).orderBy(desc(casCases.recordedAt)),
    );
    return rows.map(caseToDto);
  }
}

function caseToDto(row: typeof casCases.$inferSelect): CasCaseDto {
  return {
    casCaseId:          row.id,
    enrolmentId:        row.enrolmentId,
    casReference:       row.casReference,
    statusCode:         row.statusCode,
    actorId:            row.actorId,
    validFrom:          row.validFrom,
    validTo:            row.validTo,
    recordedAt:         row.recordedAt,
    recordedUntil:      row.recordedUntil,
  };
}
