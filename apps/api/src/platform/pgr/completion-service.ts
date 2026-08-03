import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  finalThesisDeposits,
  pgrCompletionCases,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { AwardService } from '../progression/award-service.js';
import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { RegulatoryExchangeService } from '../regulatory/exchange-service.js';

import type { ExaminationService } from './examination-service.js';
import type { SupervisionService } from './supervision-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const COMPLETABLE_OUTCOMES = new Set(['pass', 'pass-minor-corrections', 'pass-major-corrections']);

export interface OpenCompletionCaseInput {
  examinationCaseId: string;
  ownerId:           string;
}

export interface RecordFinalDepositInput {
  depositRef:             string;
  ipDeclarationConfirmed: boolean;
}

export interface ConferResearchAwardInput {
  qualificationCode: string;
  awardDate:         string;
}

export interface CompletionCaseDto {
  completionCaseId:  string;
  businessCaseId:    string;
  enrolmentId:       string;
  examinationCaseId: string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         Date;
}

export interface FinalThesisDepositDto {
  depositId:              string;
  completionCaseId:       string;
  depositRef:             string;
  ipDeclarationConfirmed: boolean;
  confirmedBy:            string;
  confirmedAt:            Date;
}

/**
 * PGR completion and award conferral (BP-06-006, BPR-D14, ADR-023).
 *
 * pgr_completion_case extends the shared business_case primitive and links
 * back to the examination case whose ratified, corrections-complete
 * outcome authorises completion. A missing final deposit holds completion
 * (never proceeds silently); conferral is an explicit, separately
 * authorised step (AwardService.conferResearchAward) rather than an
 * automatic side effect of examination ratification, per BP-06-006.
 * Supervision is closed (end-dated, never deleted) once the award is
 * conferred.
 */
export class CompletionService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly examinationService: ExaminationService,
    private readonly supervisionService: SupervisionService,
    private readonly awardService: AwardService,
    private readonly exchanges: RegulatoryExchangeService,
  ) {}

  async openCompletionCase(tenantId: string, input: OpenCompletionCaseInput, actorId: string): Promise<string> {
    const examinationCase = await this.examinationService.getExaminationCase(tenantId, input.examinationCaseId);
    if (!COMPLETABLE_OUTCOMES.has(examinationCase.statusCode)) {
      throw new ValidationError(
        `Examination case '${input.examinationCaseId}' does not have a completable ratified outcome (status is '${examinationCase.statusCode}')`,
      );
    }

    const outcome = await this.examinationService.getLatestOutcome(tenantId, input.examinationCaseId);
    if (!outcome) throw new NotFoundError('PgrExaminationOutcome', input.examinationCaseId);
    if (outcome.outcomeCode !== 'pass') {
      const requirements = await this.examinationService.listCorrectionRequirements(tenantId, outcome.outcomeId);
      if (requirements.length === 0 || requirements.some((r) => !r.completedAt)) {
        throw new ValidationError('All required corrections must be completed before completion can be opened');
      }
    }

    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment',
      subjectId:   examinationCase.enrolmentId,
      processId:   'BP-06-006',
      statusCode:  'open',
      ownerId:     input.ownerId,
    }, actorId);

    const completionCaseId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrCompletionCases).values({
        id:                completionCaseId,
        tenantId:          tenantId as Uuid,
        businessCaseId:    businessCaseId as Uuid,
        enrolmentId:       examinationCase.enrolmentId as Uuid,
        examinationCaseId: input.examinationCaseId as Uuid,
        createdAt:         clockNow(),
      });
    });
    return completionCaseId;
  }

  async recordFinalDeposit(tenantId: string, completionCaseId: string, input: RecordFinalDepositInput, actorId: string): Promise<string> {
    if (!input.ipDeclarationConfirmed) {
      throw new ValidationError('Intellectual-property declarations must be confirmed before deposit is recorded');
    }
    await this.#getCase(tenantId, completionCaseId);

    const depositId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(finalThesisDeposits).values({
        id:                     depositId,
        tenantId:               tenantId as Uuid,
        completionCaseId:       completionCaseId as Uuid,
        depositRef:             input.depositRef,
        ipDeclarationConfirmed: input.ipDeclarationConfirmed,
        confirmedBy:            actorId,
        confirmedAt:            clockNow(),
      });
    });
    return depositId;
  }

  /** Records research candidature completion. Requires a confirmed final deposit. */
  async recordCompletion(tenantId: string, completionCaseId: string, actorId: string): Promise<void> {
    const completionCase = await this.#getCase(tenantId, completionCaseId);
    if (completionCase.statusCode !== 'open') {
      throw new ValidationError(`Completion case '${completionCaseId}' has already been decided`);
    }

    const deposit = await this.getFinalDeposit(tenantId, completionCaseId);
    if (!deposit) {
      throw new ValidationError('A final thesis deposit must be recorded before completion');
    }

    const now = clockNow();
    await this.businessCases.recordDecision(completionCase.businessCaseId, tenantId, {
      decisionTypeCode: 'completed',
      authorityActorId: actorId,
      effectiveAt:      now,
    });
    await this.businessCases.advanceCaseStatus(completionCase.businessCaseId, tenantId, 'completed', actorId);
  }

  /**
   * Confers the research award through AwardService — the same authority
   * used for taught awards — as an explicit step, never an automatic
   * consequence of completion. Closes supervision and publishes the
   * closed CRIS profile afterwards.
   */
  async conferAward(tenantId: string, completionCaseId: string, input: ConferResearchAwardInput, actorId: string): Promise<string> {
    const completionCase = await this.#getCase(tenantId, completionCaseId);
    if (completionCase.statusCode !== 'completed') {
      throw new ValidationError('An award can only be conferred once completion has been recorded');
    }

    const awardId = await this.awardService.conferResearchAward(completionCase.enrolmentId, tenantId, {
      qualificationCode: input.qualificationCode,
      awardDate:         input.awardDate,
      sourceCaseId:      completionCaseId,
    }, actorId);

    await this.businessCases.advanceCaseStatus(completionCase.businessCaseId, tenantId, 'award-conferred', actorId);

    await this.supervisionService.closeCurrentAssignments(tenantId, completionCase.enrolmentId);

    await this.exchanges.recordExchange(
      tenantId,
      'cris-pgr-profile.v1',
      {
        directionCode:    'outbound',
        exchangeTypeCode: 'pgr-candidature-closed',
        idempotencyKey:   `pgr-candidature-closed:${completionCaseId}`,
        payloadSummary:   { enrolmentId: completionCase.enrolmentId, statusCode: 'closed' },
      },
      actorId,
    );

    return awardId;
  }

  async getCompletionCase(tenantId: string, completionCaseId: string): Promise<CompletionCaseDto> {
    return this.#getCase(tenantId, completionCaseId);
  }

  async getFinalDeposit(tenantId: string, completionCaseId: string): Promise<FinalThesisDepositDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(finalThesisDeposits).where(and(
        eq(finalThesisDeposits.tenantId, tenantId as Uuid),
        eq(finalThesisDeposits.completionCaseId, completionCaseId as Uuid),
      )).limit(1),
    );
    return rows[0] ? depositToDto(rows[0]) : null;
  }

  async #getCase(tenantId: string, completionCaseId: string): Promise<CompletionCaseDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrCompletionCases).where(and(
        eq(pgrCompletionCases.id, completionCaseId as Uuid),
        eq(pgrCompletionCases.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('PgrCompletionCase', completionCaseId);

    const businessCase = await this.businessCases.getCurrentCase(row.businessCaseId, tenantId);
    if (!businessCase) throw new NotFoundError('BusinessCase', row.businessCaseId);

    return {
      completionCaseId:  row.id,
      businessCaseId:    row.businessCaseId,
      enrolmentId:       row.enrolmentId,
      examinationCaseId: row.examinationCaseId,
      statusCode:        businessCase.statusCode,
      ownerId:           businessCase.ownerId,
      createdAt:         row.createdAt,
    };
  }
}

function depositToDto(row: typeof finalThesisDeposits.$inferSelect): FinalThesisDepositDto {
  return {
    depositId:              row.id,
    completionCaseId:       row.completionCaseId,
    depositRef:             row.depositRef,
    ipDeclarationConfirmed: row.ipDeclarationConfirmed,
    confirmedBy:            row.confirmedBy,
    confirmedAt:            row.confirmedAt,
  };
}
