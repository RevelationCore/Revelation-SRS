import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import { wellbeingCases }       from '../db/schema/wellbeing-case.js';
import {
  disabilitySupportCases,
  dsaEntitlements,
  evidenceReferences,
  type DisabilitySupportCase,
  type DsaEntitlement,
  type EvidenceReference,
} from '../db/schema/disability.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateCaseInput {
  personId:              string;
  supportTypeCode:       'dsa' | 'institutional' | 'interim';
  statusCode?:           string;
  dsaAwardRef?:          string;
  notes?:                string;
  assignedAdvisorId?:    string;
}

export interface CreateDsaEntitlementInput {
  disabilitySupportCaseId: string;
  personId:                string;
  entitlementTypeCode:     string;
  providerRef?:            string;
  effectiveFrom:           Date;
  effectiveTo?:            Date;
  approvedBy:              string;
}

export interface AddEvidenceInput {
  disabilitySupportCaseId: string;
  personId:                string;
  evidenceTypeCode:        string;
  edrmsDocumentRef?:       string;
  edrmsDocumentUrl?:       string;
  uploadedBy:              string;
}

export interface CaseWithParent {
  wellbeingCase:    typeof wellbeingCases.$inferSelect;
  disabilityCase:   DisabilitySupportCase;
}

// ── Wellbeing case ref generator ──────────────────────────────────────────────

function generateCaseRef(): string {
  const year   = new Date().getFullYear();
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 8);
  return `WB-${year}-${suffix}`;
}

// ── Case CRUD ─────────────────────────────────────────────────────────────────

/**
 * Create a wellbeing_case parent and a disability_support_case in one transaction.
 * Returns the logical ID of the disability support case (shared across versions).
 */
export async function createDisabilityCase(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateCaseInput,
): Promise<{ wellbeingCaseId: string; disabilityCaseId: string }> {
  // Insert parent wellbeing_case
  const [wc] = await tx.insert(wellbeingCases).values({
    tenantId,
    personId:          input.personId,
    caseRef:           generateCaseRef(),
    statusCode:        'active',
    assignedAdvisorId: input.assignedAdvisorId ?? null,
    notes:             input.notes ?? null,
  }).returning({ id: wellbeingCases.id });

  if (!wc) throw new Error('Failed to create wellbeing case');

  // Insert first bitemporal version of disability_support_case.
  // id = logical identifier shared across all versions; versionId is auto-generated PK.
  const logicalId = randomUUID();
  await tx.insert(disabilitySupportCases).values({
    id:                   logicalId,
    tenantId,
    wellbeingCaseId:      wc.id,
    personId:             input.personId,
    supportTypeCode:      input.supportTypeCode,
    statusCode:           input.statusCode ?? 'assessment_pending',
    supportPlanStatusCode: 'none',
    dsaAwardRef:          input.dsaAwardRef ?? null,
    actorId,
    validFrom:            new Date(),
    validTo:              null,
    recordedAt:           new Date(),
    recordedUntil:        null,
  });

  return { wellbeingCaseId: wc.id, disabilityCaseId: logicalId };
}

/** Return the current (open) version of a disability support case by logical ID. */
export async function findCurrentCase(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<CaseWithParent | null> {
  const rows = await tx
    .select()
    .from(disabilitySupportCases)
    .innerJoin(wellbeingCases, eq(disabilitySupportCases.wellbeingCaseId, wellbeingCases.id))
    .where(
      and(
        eq(disabilitySupportCases.tenantId, tenantId),
        eq(disabilitySupportCases.id, caseId),
        isNull(disabilitySupportCases.recordedUntil),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    wellbeingCase:  row.wellbeing_case,
    disabilityCase: row.disability_support_case,
  };
}

/** List current versions of all disability cases for a person. */
export async function listCasesForPerson(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<CaseWithParent[]> {
  const rows = await tx
    .select()
    .from(disabilitySupportCases)
    .innerJoin(wellbeingCases, eq(disabilitySupportCases.wellbeingCaseId, wellbeingCases.id))
    .where(
      and(
        eq(disabilitySupportCases.tenantId, tenantId),
        eq(disabilitySupportCases.personId, personId),
        isNull(disabilitySupportCases.recordedUntil),
      ),
    )
    .orderBy(disabilitySupportCases.recordedAt);

  return rows.map((r) => ({
    wellbeingCase:  r.wellbeing_case,
    disabilityCase: r.disability_support_case,
  }));
}

/**
 * Transition a disability case to a new status.
 *
 * Closes the current version (sets recorded_until = now()) and inserts a new
 * version with the updated status.  All other fields are carried forward.
 */
export async function transitionCaseStatus(
  tx:        WellbeingTx,
  tenantId:  string,
  caseId:    string,
  newStatus: string,
  actorId:   string,
): Promise<void> {
  const current = await findCurrentCase(tx, tenantId, caseId);
  if (!current) {
    throw new Error(`Disability case ${caseId} not found or already closed`);
  }

  const now = new Date();

  // Close the current version
  await tx
    .update(disabilitySupportCases)
    .set({ recordedUntil: now })
    .where(
      and(
        eq(disabilitySupportCases.tenantId, tenantId),
        eq(disabilitySupportCases.id, caseId),
        isNull(disabilitySupportCases.recordedUntil),
      ),
    );

  // Insert new version carrying forward all non-status fields
  const prev = current.disabilityCase;
  await tx.insert(disabilitySupportCases).values({
    id:                   caseId,
    tenantId,
    wellbeingCaseId:      prev.wellbeingCaseId,
    personId:             prev.personId,
    supportTypeCode:      prev.supportTypeCode,
    statusCode:           newStatus,
    supportPlanStatusCode: prev.supportPlanStatusCode,
    dsaAwardRef:          prev.dsaAwardRef ?? null,
    actorId,
    validFrom:            now,
    validTo:              null,
    recordedAt:           now,
    recordedUntil:        null,
  });
}

// ── DSA entitlements ──────────────────────────────────────────────────────────

/** Create the first bitemporal version of a DSA entitlement. */
export async function addDsaEntitlement(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateDsaEntitlementInput,
): Promise<string> {
  const logicalId = randomUUID();
  await tx.insert(dsaEntitlements).values({
    id:                      logicalId,
    tenantId,
    disabilitySupportCaseId: input.disabilitySupportCaseId,
    personId:                input.personId,
    entitlementTypeCode:     input.entitlementTypeCode,
    providerRef:             input.providerRef ?? null,
    effectiveFrom:           input.effectiveFrom,
    effectiveTo:             input.effectiveTo ?? null,
    approvedBy:              input.approvedBy,
    actorId,
    validFrom:               new Date(),
    validTo:                 null,
    recordedAt:              new Date(),
    recordedUntil:           null,
  });
  return logicalId;
}

/** List current (open) DSA entitlements for a disability support case. */
export async function listDsaEntitlements(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<DsaEntitlement[]> {
  return tx
    .select()
    .from(dsaEntitlements)
    .where(
      and(
        eq(dsaEntitlements.tenantId, tenantId),
        eq(dsaEntitlements.disabilitySupportCaseId, caseId),
        isNull(dsaEntitlements.recordedUntil),
      ),
    )
    .orderBy(dsaEntitlements.effectiveFrom);
}

// ── Evidence references ───────────────────────────────────────────────────────

/** Register an evidence metadata reference (document binary lives in EDRMS). */
export async function addEvidenceReference(
  tx:       WellbeingTx,
  tenantId: string,
  input:    AddEvidenceInput,
): Promise<string> {
  const [row] = await tx.insert(evidenceReferences).values({
    tenantId,
    disabilitySupportCaseId: input.disabilitySupportCaseId,
    evidenceTypeCode:        input.evidenceTypeCode,
    edrmsDocumentRef:        input.edrmsDocumentRef ?? null,
    edrmsDocumentUrl:        input.edrmsDocumentUrl ?? null,
    statusCode:              'pending',
    uploadedBy:              input.uploadedBy,
  }).returning({ id: evidenceReferences.id });

  if (!row) throw new Error('Failed to create evidence reference');
  return row.id;
}

/** List all evidence references for a disability support case. */
export async function listEvidence(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<EvidenceReference[]> {
  return tx
    .select()
    .from(evidenceReferences)
    .where(
      and(
        eq(evidenceReferences.tenantId, tenantId),
        eq(evidenceReferences.disabilitySupportCaseId, caseId),
      ),
    )
    .orderBy(evidenceReferences.createdAt);
}

/** Update the status of an evidence reference. */
export async function updateEvidenceStatus(
  tx:         WellbeingTx,
  tenantId:   string,
  evidenceId: string,
  statusCode: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE wellbeing.evidence_reference
    SET    status_code = ${statusCode},
           received_at = CASE WHEN ${statusCode} = 'received' THEN now() ELSE received_at END,
           updated_at  = now()
    WHERE  tenant_id   = ${tenantId}::uuid
      AND  id          = ${evidenceId}::uuid
  `);
}

/** Fetch a single evidence reference by ID. */
export async function findEvidence(
  tx:         WellbeingTx,
  tenantId:   string,
  evidenceId: string,
): Promise<EvidenceReference | null> {
  const rows = await tx
    .select()
    .from(evidenceReferences)
    .where(
      and(
        eq(evidenceReferences.tenantId, tenantId),
        eq(evidenceReferences.id, evidenceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
