import {
  enrolments,
  feeLiabilities,
  tenants,
  valueSetMembers,
  valueSets as valueSetTable,
  type Db,
  type FeeLiability,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { DeliveryService } from '../delivery/delivery-service.js';
import type { EnrolmentService } from '../enrolment/service.js';
import { type EnrolmentSubject, subjectsForEnrolments } from '../enrolment/subjects.js';
import type { RegistrationBlocker, RegistrationBlockerProvider } from '../registration-periods/service.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const FINANCE_LIABILITY_FLOW = 'F-SIS-FIN-01';
export const FEE_STATUS_PROCESS_ID = 'BP-02-004';
export type FinancialStatus = 'pending' | 'arranged' | 'hold' | 'not-required';
export type StatusSource = 'finance' | 'slc' | 'manual';

export interface FinancialRegistrationDto {
  liabilityId: string;
  enrolmentId: string;
  personId: string;
  academicYear: string;
  feeBandCode: string | null;
  feeStatusCode: string | null;
  financialStatusCode: FinancialStatus;
  payerArrangementCode: string | null;
  financeReference: string | null;
  holdReasonCode: string | null;
  statusSourceCode: string | null;
  statusUpdatedBy: string | null;
  statusUpdatedAt: Date | null;
  /** Financially registered: arranged or not required (D-18). */
  financiallyRegistered: boolean;
  subject?: EnrolmentSubject | undefined;
}

export interface FinancialStatusUpdate {
  financialStatusCode: FinancialStatus;
  payerArrangementCode?: string;
  financeReference?: string;
  holdReasonCode?: string;
}

export interface FeeStatusReassessmentDto {
  caseId: string; enrolmentId: string; statusCode: string; proposedFeeStatusCode: string; currentFeeStatusCode: string | null;
  reason: string; proposedBy: string; proposedAt: Date; decision: { outcome: string; decidedBy: string; decidedAt: Date; note: string | null } | null;
  subject?: EnrolmentSubject | undefined;
}

/**
 * Financial registration (Phase 3 D-18; BP-02-004). A year's fee liability
 * carries its own financial status, separate from academic registration:
 * Finance (through F-FIN-SIS-01), an SLC tuition-fee-loan confirmation, or a
 * finance administrator sets it. The SRS owns fee status, so a change after
 * conversion is a reassessment case decided by someone other than the
 * proposer. By default nothing academic is blocked; a tenant may block
 * re-registration on a tuition hold only (never on non-tuition debt).
 */
export class FinancialRegistrationService implements RegistrationBlockerProvider {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly enrolments: EnrolmentService,
    private readonly businessCases: BusinessCaseService,
    private readonly delivery?: DeliveryService,
  ) {}

  async listForEnrolment(tenantId: string, enrolmentId: string): Promise<FinancialRegistrationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(feeLiabilities)
      .where(and(eq(feeLiabilities.tenantId, tenantId as Uuid), eq(feeLiabilities.enrolmentId, enrolmentId as Uuid)))
      .orderBy(asc(feeLiabilities.academicYear)));
    return rows.map(toDto);
  }

  async worklist(tenantId: string, opts: { financialStatusCode?: FinancialStatus; academicYear?: string } = {}): Promise<FinancialRegistrationDto[]> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(feeLiabilities).where(and(
        eq(feeLiabilities.tenantId, tenantId as Uuid),
        ...(opts.financialStatusCode ? [eq(feeLiabilities.financialStatusCode, opts.financialStatusCode)] : [inArray(feeLiabilities.financialStatusCode, ['pending', 'hold'])]),
        ...(opts.academicYear ? [eq(feeLiabilities.academicYear, opts.academicYear)] : []),
      )).orderBy(desc(feeLiabilities.generatedAt)).limit(500);
      const subjects = await subjectsForEnrolments(tx, tenantId, [...new Set(rows.map((r) => r.enrolmentId))]);
      return rows.map((r) => ({ ...toDto(r), subject: subjects.get(r.enrolmentId) }));
    });
  }

  /** Sets a year's financial status, from Finance, SLC or a finance administrator, and sends the snapshot to Finance. */
  async updateStatus(tenantId: string, liabilityId: string, update: FinancialStatusUpdate, actorId: string, source: StatusSource = 'manual'): Promise<FinancialRegistrationDto> {
    const current = await this.#liability(tenantId, liabilityId);
    if (update.financialStatusCode === 'hold') {
      if (!update.holdReasonCode) throw new ValidationError('A hold needs a reason');
      await this.#code(tenantId, 'hold_reason_code', update.holdReasonCode);
    } else if (update.holdReasonCode) {
      throw new ValidationError('Only a hold has a hold reason');
    }
    if (update.payerArrangementCode) await this.#code(tenantId, 'payer_arrangement_code', update.payerArrangementCode);
    const now = clockNow();
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(feeLiabilities).set({
      financialStatusCode: update.financialStatusCode,
      payerArrangementCode: update.payerArrangementCode ?? current.payerArrangementCode,
      financeReference: update.financeReference ?? current.financeReference,
      holdReasonCode: update.financialStatusCode === 'hold' ? update.holdReasonCode! : null,
      statusSourceCode: source, statusUpdatedBy: actorId, statusUpdatedAt: now,
    }).where(eq(feeLiabilities.id, current.liabilityId as Uuid)).returning());
    const dto = toDto(row!);
    await this.#sendSnapshot(tenantId, dto, `fin-status:${dto.liabilityId}:${now.toISOString()}`);
    return dto;
  }

  /** F-FIN-SIS-01: Finance reports a year's arrangement or hold. Identified by enrolment and year. */
  async applyFinanceUpdate(tenantId: string, input: FinancialStatusUpdate & { enrolmentId: string; academicYear: string }, actorId: string): Promise<FinancialRegistrationDto> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(feeLiabilities).where(and(
      eq(feeLiabilities.tenantId, tenantId as Uuid), eq(feeLiabilities.enrolmentId, input.enrolmentId as Uuid), eq(feeLiabilities.academicYear, input.academicYear),
    )).limit(1));
    if (!row) throw new NotFoundError('Fee liability', `${input.enrolmentId} ${input.academicYear}`);
    const { enrolmentId: _e, academicYear: _y, ...update } = input;
    return this.updateStatus(tenantId, row.id, update, actorId, 'finance');
  }

  /** An SLC tuition-fee-loan confirmation for the year counts as arranged (configurable). */
  async applySlcTuitionLoan(tenantId: string, enrolmentId: string, academicYear: string, actorId: string): Promise<FinancialRegistrationDto | null> {
    if (!(await this.#settings(tenantId)).slcCountsAsArranged) return null;
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(feeLiabilities).where(and(
      eq(feeLiabilities.tenantId, tenantId as Uuid), eq(feeLiabilities.enrolmentId, enrolmentId as Uuid), eq(feeLiabilities.academicYear, academicYear),
    )).limit(1));
    if (!row || row.financialStatusCode === 'arranged') return row ? toDto(row) : null;
    return this.updateStatus(tenantId, row.id, { financialStatusCode: 'arranged', payerArrangementCode: 'slc-tuition-loan' }, actorId, 'slc');
  }

  // ── Fee-status reassessment (a governed change of the SRS's own determination) ──

  async proposeFeeStatusChange(tenantId: string, enrolmentId: string, input: { feeStatusCode: string; reason: string }, actorId: string): Promise<FeeStatusReassessmentDto> {
    const enrolment = await this.enrolments.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    if (!(await this.valueSets.validateFieldValue('enrolment', 'fee_status_code', input.feeStatusCode, tenantId))) throw new ValidationError(`Invalid fee status '${input.feeStatusCode}'`);
    if (input.feeStatusCode === enrolment.feeStatusCode) throw new ConflictError('That is already the fee status');
    if (!input.reason.trim()) throw new ValidationError('Give the reason for the reassessment');
    if ((await this.listReassessments(tenantId, { enrolmentId, open: true })).length > 0) throw new ConflictError('A fee-status reassessment is already open for this enrolment');
    const caseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment', subjectId: enrolmentId, processId: FEE_STATUS_PROCESS_ID, statusCode: 'open', ownerId: actorId,
    }, actorId);
    // The proposal is kept as its own record on the case: the proposed status and the reason.
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: 'proposed', authorityActorId: actorId, reasonCode: input.feeStatusCode, reasonText: input.reason.trim(), effectiveAt: clockNow(),
    });
    return (await this.listReassessments(tenantId, { enrolmentId })).find((r) => r.caseId === caseId)!;
  }

  async decideFeeStatusChange(tenantId: string, caseId: string, input: { outcome: 'approved' | 'rejected'; note?: string }, actorId: string): Promise<FeeStatusReassessmentDto> {
    const item = (await this.listReassessments(tenantId)).find((r) => r.caseId === caseId);
    if (!item) throw new NotFoundError('Fee-status reassessment', caseId);
    if (item.statusCode !== 'open') throw new ConflictError('This reassessment has already been decided');
    if (item.proposedBy === actorId) throw new ConflictError('The person who proposed a fee-status change cannot decide it');
    if (input.outcome === 'approved') {
      await this.enrolments.setFeeStatus(tenantId, item.enrolmentId, item.proposedFeeStatusCode, actorId);
    }
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: input.outcome, authorityActorId: actorId, reasonCode: item.proposedFeeStatusCode,
      ...(input.note?.trim() ? { reasonText: input.note.trim() } : {}), effectiveAt: clockNow(),
    });
    await this.businessCases.advanceCaseStatus(caseId, tenantId, input.outcome === 'approved' ? 'decided' : 'closed', actorId);
    return (await this.listReassessments(tenantId)).find((r) => r.caseId === caseId)!;
  }

  async listReassessments(tenantId: string, opts: { enrolmentId?: string; open?: boolean } = {}): Promise<FeeStatusReassessmentDto[]> {
    const { businessCases: bc, caseDecisions: cd } = await import('@revelation-srs/db');
    return withTenantContext(this.db, tenantId, async (tx) => {
      const cases = await tx.select().from(bc).where(and(
        eq(bc.tenantId, tenantId as Uuid), eq(bc.processId, FEE_STATUS_PROCESS_ID), isNull(bc.recordedUntil),
        ...(opts.enrolmentId ? [eq(bc.subjectId, opts.enrolmentId as Uuid)] : []),
        ...(opts.open ? [eq(bc.statusCode, 'open')] : []),
      )).orderBy(asc(bc.validFrom));
      if (cases.length === 0) return [];
      const ids = cases.map((c) => c.id);
      const records = await tx.select().from(cd).where(inArray(cd.businessCaseId, ids));
      const proposals = records.filter((r) => r.decisionTypeCode === 'proposed');
      const decisions = records.filter((r) => r.decisionTypeCode !== 'proposed');
      const current = await tx.select({ id: enrolments.id, feeStatusCode: enrolments.feeStatusCode }).from(enrolments)
        .where(and(inArray(enrolments.id, cases.map((c) => c.subjectId)), isNull(enrolments.recordedUntil)));
      const subjects = await subjectsForEnrolments(tx, tenantId, [...new Set(cases.map((c) => c.subjectId))]);
      return cases.flatMap((c) => {
        const p = proposals.find((x) => x.businessCaseId === c.id);
        if (!p) return [];
        const d = decisions.find((x) => x.businessCaseId === c.id);
        return [{
          caseId: c.id, enrolmentId: c.subjectId, statusCode: c.statusCode,
          proposedFeeStatusCode: p.reasonCode ?? '', currentFeeStatusCode: current.find((e) => e.id === c.subjectId)?.feeStatusCode ?? null,
          reason: p.reasonText ?? '', proposedBy: p.authorityActorId, proposedAt: p.decidedAt,
          decision: d ? { outcome: d.decisionTypeCode, decidedBy: d.authorityActorId, decidedAt: d.decidedAt, note: d.reasonText } : null,
          subject: subjects.get(c.subjectId),
        }];
      });
    });
  }

  /** Registration blocker: only a tuition hold, and only when the tenant chose to block on one (D-18). */
  async blockersFor(tenantId: string, enrolmentId: string, academicYear: string, periodTypeCode: 'annual' | 'initial' = 'annual'): Promise<RegistrationBlocker[]> {
    if (periodTypeCode !== 'annual') return [];
    if ((await this.#settings(tenantId)).holdBlocks !== 'tuition-hold') return [];
    const [previous] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(feeLiabilities).where(and(
      eq(feeLiabilities.tenantId, tenantId as Uuid), eq(feeLiabilities.enrolmentId, enrolmentId as Uuid), eq(feeLiabilities.financialStatusCode, 'hold'),
    )).orderBy(desc(feeLiabilities.academicYear)).limit(1));
    if (!previous?.holdReasonCode || previous.academicYear >= academicYear) return [];
    if (!(await this.#isTuitionHold(tenantId, previous.holdReasonCode))) return [];
    return [{ code: 'tuition-hold', message: `There is a hold on your tuition fees for ${previous.academicYear}. Please contact the finance office.` }];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #liability(tenantId: string, liabilityId: string): Promise<FinancialRegistrationDto> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(feeLiabilities)
      .where(and(eq(feeLiabilities.tenantId, tenantId as Uuid), eq(feeLiabilities.id, liabilityId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('Fee liability', liabilityId);
    return toDto(row);
  }

  async #sendSnapshot(tenantId: string, dto: FinancialRegistrationDto, key: string): Promise<void> {
    await this.delivery?.request(tenantId, {
      flowCode: FINANCE_LIABILITY_FLOW, subjectType: 'fee_liability', subjectId: dto.liabilityId, personId: dto.personId, idempotencyKey: key,
      summary: `${dto.academicYear} liability: financial status ${dto.financialStatusCode}${dto.feeStatusCode ? `, fee status ${dto.feeStatusCode}` : ''}`,
      payload: {
        liabilityId: dto.liabilityId, enrolmentId: dto.enrolmentId, personId: dto.personId, academicYear: dto.academicYear,
        feeBandCode: dto.feeBandCode, feeStatusCode: dto.feeStatusCode, financialStatusCode: dto.financialStatusCode,
        payerArrangementCode: dto.payerArrangementCode, financeReference: dto.financeReference,
      },
    });
  }

  async #isTuitionHold(tenantId: string, code: string): Promise<boolean> {
    // In tenant context, so an institution's own hold reasons are found too.
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ meta: valueSetMembers.sourceMetadata }).from(valueSetMembers)
      .innerJoin(valueSetTable, eq(valueSetTable.id, valueSetMembers.valueSetId))
      .where(and(eq(valueSetTable.setCode, 'financial-hold-reason-code'), eq(valueSetMembers.code, code))).limit(1));
    return (row?.meta as { tuition?: boolean } | null)?.tuition === true;
  }

  async #settings(tenantId: string): Promise<{ holdBlocks: 'none' | 'tuition-hold'; slcCountsAsArranged: boolean }> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const c = row?.configuration ?? {};
    const reg = (c['registration'] ?? {}) as Record<string, unknown>;
    const fin = (c['financialRegistration'] ?? {}) as Record<string, unknown>;
    return { holdBlocks: reg['financialHoldBlocks'] === 'tuition-hold' ? 'tuition-hold' : 'none', slcCountsAsArranged: fin['slcCountsAsArranged'] !== false };
  }

  async #code(tenantId: string, field: string, value: string): Promise<void> {
    if (!(await this.valueSets.validateFieldValue('fee_liability', field, value, tenantId))) throw new ValidationError(`Invalid ${field.replace(/_code$/, '').replace(/_/g, ' ')} '${value}'`);
  }
}

function toDto(r: FeeLiability): FinancialRegistrationDto {
  const status = r.financialStatusCode as FinancialStatus;
  return {
    liabilityId: r.id, enrolmentId: r.enrolmentId, personId: r.personId, academicYear: r.academicYear, feeBandCode: r.feeBandCode,
    feeStatusCode: r.feeStatusCode, financialStatusCode: status, payerArrangementCode: r.payerArrangementCode, financeReference: r.financeReference,
    holdReasonCode: r.holdReasonCode, statusSourceCode: r.statusSourceCode, statusUpdatedBy: r.statusUpdatedBy, statusUpdatedAt: r.statusUpdatedAt,
    financiallyRegistered: status === 'arranged' || status === 'not-required',
  };
}
