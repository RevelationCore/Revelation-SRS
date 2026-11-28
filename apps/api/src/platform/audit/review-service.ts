import { randomUUID } from 'node:crypto';

import { eq, and, inArray } from 'drizzle-orm';
import {
  auditRecords,
  auditReviewCases,
  auditReviewFindings,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { DomainError, NotFoundError } from '@revelation-srs/domain';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Audit review case (BPR-D19). Extends the shared business_case primitive.
 * A DPO or system administrator opens a case to investigate a suspected
 * tamper or policy-breach pattern in the hash-chained audit log and
 * records individual findings against specific audit_record rows.
 */

export interface AddFindingInput {
  auditRecordId:   string;
  findingTypeCode: string;
  description?:    string;
}

export interface AuditReviewCaseDto {
  auditReviewCaseId: string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         Date;
}

export class AuditReviewService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async openCase(tenantId: string, ownerId: string, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'audit-log',
      subjectId:   tenantId,
      processId:   'BP-08-006',
      statusCode:  'open',
      ownerId,
    }, actorId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(auditReviewCases).values({
        id,
        tenantId:       tenantId as Uuid,
        businessCaseId: businessCaseId as Uuid,
        createdAt:      clockNow(),
      });
    });
    return id;
  }

  async addFinding(tenantId: string, auditReviewCaseId: string, input: AddFindingInput, reviewerId: string): Promise<string> {
    await this.#ensureCaseExists(tenantId, auditReviewCaseId);
    // R08-8 (BL-287): no one reviews their own actions.
    const [audited] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ actorId: auditRecords.actorId }).from(auditRecords)
      .where(and(eq(auditRecords.tenantId, tenantId as Uuid), eq(auditRecords.id, input.auditRecordId as Uuid))).limit(1));
    if (!audited) throw new NotFoundError('AuditRecord', input.auditRecordId);
    if (audited.actorId === reviewerId) throw new DomainError('A finding about your own action is recorded by another reviewer', 'separation-of-duties', 403);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(auditReviewFindings).values({
        id,
        tenantId:           tenantId as Uuid,
        auditReviewCaseId:  auditReviewCaseId as Uuid,
        auditRecordId:      input.auditRecordId as Uuid,
        findingTypeCode:    input.findingTypeCode,
        description:        input.description ?? null,
        createdAt:          clockNow(),
      });
    });
    return id;
  }

  /** Lists audit-review cases, optionally filtered by business-case status. */
  async listCases(tenantId: string, statusCode?: string): Promise<AuditReviewCaseDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-006', statusCode);
    if (businessCaseRows.length === 0) return [];

    const caseRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(auditReviewCases).where(and(
        eq(auditReviewCases.tenantId, tenantId as Uuid),
        inArray(auditReviewCases.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return caseRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          auditReviewCaseId: row.id,
          statusCode:        bc.statusCode,
          ownerId:           bc.ownerId,
          createdAt:         row.createdAt,
        };
      })
      .filter((r): r is AuditReviewCaseDto => r !== null);
  }

  async #ensureCaseExists(tenantId: string, auditReviewCaseId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: auditReviewCases.id }).from(auditReviewCases).where(and(
        eq(auditReviewCases.id,       auditReviewCaseId as Uuid),
        eq(auditReviewCases.tenantId, tenantId            as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('AuditReviewCase', auditReviewCaseId);
  }
}
