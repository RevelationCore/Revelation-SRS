import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import {
  identityResolutionCases,
  identityResolutionCandidates,
  identityResolutionDecisions,
  personIdentityLinks,
  identityRedirects,
  dataCorrectionCases,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Identity resolution & correction case (BPR-D17). Candidate generation
 * only — a decision is never derived automatically from a match score; it
 * always requires an explicit `decide()` call from an authorised actor.
 */

export interface OpenResolutionCaseInput {
  subjectPersonId: string;
  ownerId:         string;
}

export interface AddCandidateInput {
  candidatePersonId: string;
  matchScore:        number;
  matchReasonCode:   string;
}

export interface DecideInput {
  decisionTypeCode: 'merge' | 'reject' | 'link';
  survivorPersonId?: string;
}

export interface IdentityResolutionCaseDto {
  identityResolutionCaseId: string;
  subjectPersonId: string;
  statusCode:      string;
  ownerId:         string;
  createdAt:       Date;
}

export interface DataCorrectionCaseDto {
  dataCorrectionCaseId: string;
  personId:             string;
  correctedEntityType:  string;
  correctedFieldName:   string;
  statusCode:           string;
  ownerId:              string;
  createdAt:            Date;
}

export class IdentityResolutionService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async openCase(tenantId: string, input: OpenResolutionCaseInput, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person',
      subjectId:   input.subjectPersonId,
      processId:   'BP-08-001',
      statusCode:  'open',
      ownerId:     input.ownerId,
    }, actorId);

    const caseId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(identityResolutionCases).values({
        id:             caseId,
        tenantId:       tenantId as Uuid,
        businessCaseId: businessCaseId as Uuid,
        createdAt:      clockNow(),
      });
    });
    return caseId;
  }

  async addCandidate(tenantId: string, identityResolutionCaseId: string, input: AddCandidateInput): Promise<string> {
    await this.#ensureCaseExists(tenantId, identityResolutionCaseId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(identityResolutionCandidates).values({
        id,
        tenantId:                 tenantId as Uuid,
        identityResolutionCaseId: identityResolutionCaseId as Uuid,
        candidatePersonId:        input.candidatePersonId as Uuid,
        matchScore:               input.matchScore.toFixed(4),
        matchReasonCode:          input.matchReasonCode,
        createdAt:                clockNow(),
      });
    });
    return id;
  }

  /** Records an explicit decision. Never called automatically from a match score. */
  async decide(tenantId: string, identityResolutionCaseId: string, input: DecideInput, decidedBy: string): Promise<string> {
    await this.#ensureCaseExists(tenantId, identityResolutionCaseId);

    if (input.decisionTypeCode === 'merge' && !input.survivorPersonId) {
      throw new ValidationError("A 'merge' decision requires survivorPersonId");
    }

    const decisionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(identityResolutionDecisions).values({
        id:                       decisionId,
        tenantId:                 tenantId as Uuid,
        identityResolutionCaseId: identityResolutionCaseId as Uuid,
        decisionTypeCode:         input.decisionTypeCode,
        survivorPersonId:         input.survivorPersonId ? (input.survivorPersonId as Uuid) : null,
        decidedBy,
        decidedAt:                clockNow(),
      });
    });
    return decisionId;
  }

  /** Links two person records and, for a merge, creates the redirect that propagates future lookups. */
  async linkPersons(tenantId: string, sourcePersonId: string, targetPersonId: string, linkTypeCode: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(personIdentityLinks).values({
        id,
        tenantId:       tenantId as Uuid,
        sourcePersonId: sourcePersonId as Uuid,
        targetPersonId: targetPersonId as Uuid,
        linkTypeCode,
        createdAt:      clockNow(),
      });

      if (linkTypeCode === 'merged-into') {
        await tx.insert(identityRedirects).values({
          id:            randomUUID(),
          tenantId:      tenantId as Uuid,
          oldPersonId:   sourcePersonId as Uuid,
          newPersonId:   targetPersonId as Uuid,
          effectiveFrom: clockNow(),
          propagatedAt:  null,
        });
      }
    });
    return id;
  }

  async openCorrectionCase(tenantId: string, personId: string, correctedEntityType: string, correctedFieldName: string, ownerId: string, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'person',
      subjectId:   personId,
      processId:   'BP-08-002',
      statusCode:  'open',
      ownerId,
    }, actorId);

    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(dataCorrectionCases).values({
        id,
        tenantId:            tenantId as Uuid,
        businessCaseId:      businessCaseId as Uuid,
        personId:            personId as Uuid,
        correctedEntityType,
        correctedFieldName,
        createdAt:           clockNow(),
      });
    });
    return id;
  }

  /** Lists current identity-resolution cases, optionally filtered by business-case status. */
  async listCases(tenantId: string, statusCode?: string): Promise<IdentityResolutionCaseDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-001', statusCode);
    if (businessCaseRows.length === 0) return [];

    const caseRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(identityResolutionCases).where(and(
        eq(identityResolutionCases.tenantId, tenantId as Uuid),
        inArray(identityResolutionCases.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return caseRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          identityResolutionCaseId: row.id,
          subjectPersonId: bc.subjectId,
          statusCode:      bc.statusCode,
          ownerId:         bc.ownerId,
          createdAt:       row.createdAt,
        };
      })
      .filter((r): r is IdentityResolutionCaseDto => r !== null);
  }

  /** Lists current data-correction cases, optionally filtered by business-case status. */
  async listCorrectionCases(tenantId: string, statusCode?: string): Promise<DataCorrectionCaseDto[]> {
    const businessCaseRows = await this.businessCases.listCasesByProcess(tenantId, 'BP-08-002', statusCode);
    if (businessCaseRows.length === 0) return [];

    const caseRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(dataCorrectionCases).where(and(
        eq(dataCorrectionCases.tenantId, tenantId as Uuid),
        inArray(dataCorrectionCases.businessCaseId, businessCaseRows.map((r) => r.caseId as Uuid)),
      )),
    );
    const businessCaseById = new Map(businessCaseRows.map((r) => [r.caseId, r]));
    return caseRows
      .map((row) => {
        const bc = businessCaseById.get(row.businessCaseId);
        if (!bc) return null;
        return {
          dataCorrectionCaseId: row.id,
          personId:             row.personId,
          correctedEntityType:  row.correctedEntityType,
          correctedFieldName:   row.correctedFieldName,
          statusCode:           bc.statusCode,
          ownerId:              bc.ownerId,
          createdAt:            row.createdAt,
        };
      })
      .filter((r): r is DataCorrectionCaseDto => r !== null);
  }

  async #ensureCaseExists(tenantId: string, identityResolutionCaseId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: identityResolutionCases.id }).from(identityResolutionCases).where(and(
        eq(identityResolutionCases.id,       identityResolutionCaseId as Uuid),
        eq(identityResolutionCases.tenantId, tenantId                  as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('IdentityResolutionCase', identityResolutionCaseId);
  }
}
