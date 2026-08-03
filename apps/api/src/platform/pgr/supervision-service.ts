import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  pgrSupervisionCases,
  pgrSupervisorNominations,
  staffAssignments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { RegulatoryExchangeService } from '../regulatory/exchange-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * PGR supervision and research context (BP-03-007, BPR-D07 part 1, ADR-023).
 *
 * pgr_supervision_case extends the shared business_case primitive.
 * Nominations are working data attached to the case only — staff_assignment
 * rows are created solely once the PGR Director/Committee approves
 * (BP-03-007 step 6), so an incomplete or unapproved team is never
 * representable as current. A change of supervisor end-dates the
 * superseded assignment and creates a new one rather than overwriting it.
 */

export interface OpenSupervisionCaseInput {
  enrolmentId:        string;
  ownerId:            string;
  degreeAim?:         string;
  researchArea?:      string;
  schoolOwner?:       string;
  intendedStartDate?: string;
}

export interface NominateSupervisorInput {
  personId:               string;
  roleDetailCode:         'principal' | 'additional' | 'external';
  orgOwner?:              string;
  externalOrganisation?:  string;
  contractualStatusCode?: string;
  accessLevelCode?:       string;
}

export interface DirectorDecisionInput {
  decisionTypeCode: 'approve' | 'return' | 'reject';
  reasonText?:      string;
}

export interface SupervisionCaseDto {
  supervisionCaseId: string;
  businessCaseId:    string;
  enrolmentId:       string;
  statusCode:        string;
  ownerId:           string;
  degreeAim:         string | null;
  researchArea:      string | null;
  schoolOwner:       string | null;
  intendedStartDate: string | null;
  createdAt:         Date;
}

export interface SupervisorNominationDto {
  nominationId:           string;
  supervisionCaseId:      string;
  personId:               string;
  roleDetailCode:         string;
  orgOwner:               string | null;
  externalOrganisation:   string | null;
  contractualStatusCode:  string | null;
  accessLevelCode:        string | null;
  eligibilityCheckedAt:   Date | null;
  nominatedAt:            Date;
}

export interface StaffAssignmentDto {
  assignmentId:          string;
  enrolmentId:           string;
  supervisionCaseId:     string;
  personId:              string;
  assignmentTypeCode:    string;
  roleDetailCode:        string;
  orgOwner:              string | null;
  externalOrganisation:  string | null;
  contractualStatusCode: string | null;
  accessLevelCode:       string | null;
  validFrom:             Date;
  validTo:               Date | null;
}

export class SupervisionService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly exchanges: RegulatoryExchangeService,
  ) {}

  async openSupervisionCase(tenantId: string, input: OpenSupervisionCaseInput, actorId: string): Promise<string> {
    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment',
      subjectId:   input.enrolmentId,
      processId:   'BP-03-007',
      statusCode:  'proposed',
      ownerId:     input.ownerId,
    }, actorId);

    const supervisionCaseId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrSupervisionCases).values({
        id:                supervisionCaseId,
        tenantId:          tenantId as Uuid,
        businessCaseId:    businessCaseId as Uuid,
        enrolmentId:       input.enrolmentId as Uuid,
        degreeAim:         input.degreeAim ?? null,
        researchArea:      input.researchArea ?? null,
        schoolOwner:       input.schoolOwner ?? null,
        intendedStartDate: input.intendedStartDate ?? null,
        createdAt:         clockNow(),
      });
    });
    return supervisionCaseId;
  }

  /** Records a proposed nominee. Working data only — not a staff_assignment until approval. */
  async nominateSupervisor(
    tenantId: string,
    supervisionCaseId: string,
    input: NominateSupervisorInput,
    actorId: string,
  ): Promise<string> {
    const supervisionCase = await this.#getSupervisionCase(tenantId, supervisionCaseId);
    if (supervisionCase.statusCode !== 'proposed') {
      throw new ValidationError(`Cannot nominate supervisors for a case in status '${supervisionCase.statusCode}'`);
    }

    const nominationId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrSupervisorNominations).values({
        id:                    nominationId,
        tenantId:              tenantId as Uuid,
        supervisionCaseId:     supervisionCaseId as Uuid,
        personId:              input.personId as Uuid,
        roleDetailCode:        input.roleDetailCode,
        orgOwner:              input.orgOwner ?? null,
        externalOrganisation:  input.externalOrganisation ?? null,
        contractualStatusCode: input.contractualStatusCode ?? null,
        accessLevelCode:       input.accessLevelCode ?? null,
        eligibilityCheckedAt:  null,
        nominatedBy:           actorId,
        nominatedAt:           clockNow(),
      });
    });
    return nominationId;
  }

  /**
   * Records the HR eligibility/capacity/conflict check as a recorded
   * exchange (BP-03-007 step 3) rather than a bespoke local audit row —
   * matches how every other external-system check is recorded in this
   * codebase (RegulatoryExchangeService.recordExchange). Also stamps the
   * nomination so an approval can confirm every nominee was checked.
   */
  async recordEligibilityCheck(
    tenantId: string,
    nominationId: string,
    actorId: string,
  ): Promise<void> {
    const nomination = await this.#getNomination(tenantId, nominationId);

    await this.exchanges.recordExchange(
      tenantId,
      'hr-staff-assignments.v1',
      {
        directionCode:    'inbound',
        exchangeTypeCode: 'pgr-supervisor-eligibility-check',
        idempotencyKey:   `pgr-supervisor-eligibility:${nominationId}`,
        payloadSummary:   { supervisionCaseId: nomination.supervisionCaseId, personId: nomination.personId },
      },
      actorId,
    );

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(pgrSupervisorNominations)
        .set({ eligibilityCheckedAt: clockNow() })
        .where(and(
          eq(pgrSupervisorNominations.id, nominationId as Uuid),
          eq(pgrSupervisorNominations.tenantId, tenantId as Uuid),
        ));
    });
  }

  /**
   * Records the PGR Director/Committee's decision. On approval, creates a
   * current staff_assignment for every nominee (BP-03-007 step 6) and
   * end-dates any previously current assignments for the enrolment — a
   * change of supervisor supersedes the prior team without deleting it.
   * On return/reject, no assignment is created or altered.
   */
  async recordDirectorDecision(
    tenantId: string,
    supervisionCaseId: string,
    input: DirectorDecisionInput,
    actorId: string,
  ): Promise<void> {
    const supervisionCase = await this.#getSupervisionCase(tenantId, supervisionCaseId);
    if (supervisionCase.statusCode !== 'proposed') {
      throw new ValidationError(`Supervision case '${supervisionCaseId}' has already been decided`);
    }

    const decisionCode = input.decisionTypeCode === 'approve' ? 'approved'
      : input.decisionTypeCode === 'return' ? 'returned'
      : 'rejected';

    if (input.decisionTypeCode === 'approve') {
      const nominations = await this.listNominations(tenantId, supervisionCaseId);
      if (nominations.length === 0) {
        throw new ValidationError(`Supervision case '${supervisionCaseId}' has no nominated supervisors to approve`);
      }
      if (nominations.some((n) => !n.eligibilityCheckedAt)) {
        throw new ValidationError('Every nominated supervisor must have a recorded eligibility check before approval');
      }
    }

    await this.businessCases.recordDecision(supervisionCase.businessCaseId, tenantId, {
      decisionTypeCode: input.decisionTypeCode,
      authorityActorId: actorId,
      ...(input.reasonText ? { reasonText: input.reasonText } : {}),
      effectiveAt:      clockNow(),
    });
    await this.businessCases.advanceCaseStatus(supervisionCase.businessCaseId, tenantId, decisionCode, actorId);

    if (input.decisionTypeCode !== 'approve') return;

    const now = clockNow();
    const nominations = await this.listNominations(tenantId, supervisionCaseId);
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(staffAssignments)
        .set({ recordedUntil: now })
        .where(and(
          eq(staffAssignments.tenantId, tenantId as Uuid),
          eq(staffAssignments.enrolmentId, supervisionCase.enrolmentId as Uuid),
          isNull(staffAssignments.recordedUntil),
        ));

      for (const nomination of nominations) {
        await tx.insert(staffAssignments).values({
          versionId:             randomUUID(),
          id:                    randomUUID(),
          tenantId:              tenantId as Uuid,
          enrolmentId:           supervisionCase.enrolmentId as Uuid,
          supervisionCaseId:     supervisionCaseId as Uuid,
          personId:              nomination.personId as Uuid,
          assignmentTypeCode:    'supervisor',
          roleDetailCode:        nomination.roleDetailCode,
          orgOwner:              nomination.orgOwner,
          externalOrganisation:  nomination.externalOrganisation,
          contractualStatusCode: nomination.contractualStatusCode,
          accessLevelCode:       nomination.accessLevelCode,
          actorId,
          validFrom:             now,
          validTo:               null,
          recordedAt:            now,
          recordedUntil:         null,
        });
      }
    });
  }

  /**
   * Publishes the current team to CRIS. Only meaningful once the case is
   * approved — an incomplete or unapproved team is never represented as
   * current downstream (BP-03-007 exception E3).
   */
  async publishToCris(tenantId: string, supervisionCaseId: string, actorId: string): Promise<void> {
    const supervisionCase = await this.#getSupervisionCase(tenantId, supervisionCaseId);
    if (supervisionCase.statusCode !== 'approved') {
      throw new ValidationError('Only an approved supervision case may be published to CRIS');
    }

    const current = await this.listCurrentAssignments(tenantId, supervisionCase.enrolmentId);
    await this.exchanges.recordExchange(
      tenantId,
      'cris-pgr-profile.v1',
      {
        directionCode:    'outbound',
        exchangeTypeCode: 'pgr-supervision-published',
        idempotencyKey:   `pgr-supervision-published:${supervisionCaseId}`,
        payloadSummary:   { enrolmentId: supervisionCase.enrolmentId, supervisors: current.map((a) => a.personId) },
      },
      actorId,
    );
  }

  /**
   * Closes (end-dates) all current supervision assignments for an
   * enrolment without creating replacements — used once PGR completion is
   * recorded (BP-06-006 step 6). History is preserved, never deleted.
   */
  async closeCurrentAssignments(tenantId: string, enrolmentId: string): Promise<void> {
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(staffAssignments)
        .set({ recordedUntil: now })
        .where(and(
          eq(staffAssignments.tenantId, tenantId as Uuid),
          eq(staffAssignments.enrolmentId, enrolmentId as Uuid),
          isNull(staffAssignments.recordedUntil),
        ));
    });
  }

  async getSupervisionCase(tenantId: string, supervisionCaseId: string): Promise<SupervisionCaseDto> {
    return this.#getSupervisionCase(tenantId, supervisionCaseId);
  }

  async listNominations(tenantId: string, supervisionCaseId: string): Promise<SupervisorNominationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrSupervisorNominations).where(and(
        eq(pgrSupervisorNominations.tenantId, tenantId as Uuid),
        eq(pgrSupervisorNominations.supervisionCaseId, supervisionCaseId as Uuid),
      )),
    );
    return rows.map(nominationToDto);
  }

  async listCurrentAssignments(tenantId: string, enrolmentId: string): Promise<StaffAssignmentDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(staffAssignments).where(and(
        eq(staffAssignments.tenantId, tenantId as Uuid),
        eq(staffAssignments.enrolmentId, enrolmentId as Uuid),
        isNull(staffAssignments.recordedUntil),
      )),
    );
    return rows.map(assignmentToDto);
  }

  async #getSupervisionCase(tenantId: string, supervisionCaseId: string): Promise<SupervisionCaseDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrSupervisionCases).where(and(
        eq(pgrSupervisionCases.id, supervisionCaseId as Uuid),
        eq(pgrSupervisionCases.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('PgrSupervisionCase', supervisionCaseId);

    const businessCase = await this.businessCases.getCurrentCase(row.businessCaseId, tenantId);
    if (!businessCase) throw new NotFoundError('BusinessCase', row.businessCaseId);

    return {
      supervisionCaseId: row.id,
      businessCaseId:    row.businessCaseId,
      enrolmentId:       row.enrolmentId,
      statusCode:        businessCase.statusCode,
      ownerId:           businessCase.ownerId,
      degreeAim:         row.degreeAim,
      researchArea:      row.researchArea,
      schoolOwner:       row.schoolOwner,
      intendedStartDate: row.intendedStartDate,
      createdAt:         row.createdAt,
    };
  }

  async #getNomination(tenantId: string, nominationId: string): Promise<PgrSupervisorNominationRow> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrSupervisorNominations).where(and(
        eq(pgrSupervisorNominations.id, nominationId as Uuid),
        eq(pgrSupervisorNominations.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('PgrSupervisorNomination', nominationId);
    return row;
  }
}

type PgrSupervisorNominationRow = typeof pgrSupervisorNominations.$inferSelect;

function nominationToDto(row: PgrSupervisorNominationRow): SupervisorNominationDto {
  return {
    nominationId:          row.id,
    supervisionCaseId:     row.supervisionCaseId,
    personId:              row.personId,
    roleDetailCode:        row.roleDetailCode,
    orgOwner:              row.orgOwner,
    externalOrganisation:  row.externalOrganisation,
    contractualStatusCode: row.contractualStatusCode,
    accessLevelCode:       row.accessLevelCode,
    eligibilityCheckedAt:  row.eligibilityCheckedAt,
    nominatedAt:           row.nominatedAt,
  };
}

function assignmentToDto(row: typeof staffAssignments.$inferSelect): StaffAssignmentDto {
  return {
    assignmentId:          row.id,
    enrolmentId:           row.enrolmentId,
    supervisionCaseId:     row.supervisionCaseId,
    personId:              row.personId,
    assignmentTypeCode:    row.assignmentTypeCode,
    roleDetailCode:        row.roleDetailCode,
    orgOwner:              row.orgOwner,
    externalOrganisation:  row.externalOrganisation,
    contractualStatusCode: row.contractualStatusCode,
    accessLevelCode:       row.accessLevelCode,
    validFrom:             row.validFrom,
    validTo:               row.validTo,
  };
}
