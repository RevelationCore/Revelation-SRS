import { and, asc, eq } from 'drizzle-orm';
import {
  enrolments,
  persons,
  supportAwards,
  supportInstalments,
  type Db,
  type SupportAward,
  type SupportInstalment,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { DeliveryService } from '../delivery/delivery-service.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const PAYROLL_FLOW = 'F-SIS-PAY-01';
/** Teaching pay is employment, owned by HR and payroll — never student support. */
const NOT_SUPPORT_PAYMENT_TYPES = new Set(['gta-pay']);

export interface CreateAwardInput {
  enrolmentId:    string;
  awardTypeCode:  string;
  awardReference: string;
  funder:         string;
  startDate:      string;
  endDate?:       string;
}

export interface AddInstalmentInput {
  paymentTypeCode: string;
  amountMinorUnits:     number;
  periodStart:     string;
  periodEnd:       string;
  dueDate:         string;
}

export interface SupportAwardDto {
  awardId:        string;
  personId:       string;
  enrolmentId:    string;
  awardTypeCode:  string;
  awardReference: string;
  funder:         string;
  startDate:      string;
  endDate:        string | null;
  statusCode:     string;
  createdBy:      string;
  approvedBy:     string | null;
  approvedAt:     Date | null;
  instalments:    SupportInstalmentDto[];
}

export interface SupportInstalmentDto {
  instalmentId:     string;
  awardId:          string;
  paymentTypeCode:  string;
  currencyCode:     string;
  amountMinorUnits:      number;
  periodStart:      string;
  periodEnd:        string;
  dueDate:          string;
  statusCode:       string;
  approvedBy:       string | null;
  approvedAt:       Date | null;
  paymentReference: string | null;
  paidOn:           string | null;
  paidAmountMinorUnits:  number | null;
  rejectionReason:  string | null;
  createdBy:        string;
}

export interface PaymentConfirmation {
  instructionId:    string;
  paymentReference: string;
  paymentStatus:    'paid' | 'rejected';
  amountPence?:     number;
  paidOn?:          string;
  rejectionReason?: string;
}

/**
 * Student support schedules (AJ-32). Staff record an award and its
 * instalments; the award owner approves them — never the person who recorded
 * them — and each approved instalment is sent to payroll as an F-SIS-PAY-01
 * instruction whose operation id is the instalment id, so any retry reuses
 * the same operation. An instalment becomes 'paid' only when payroll's
 * confirmation arrives (F-PAY-SIS-01): payroll accepting an instruction is
 * not evidence the student was paid.
 */
export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly delivery: DeliveryService,
  ) {}

  async createAward(tenantId: string, personId: string, input: CreateAwardInput, actorId: string): Promise<SupportAwardDto> {
    await this.#checkCode(tenantId, 'support_award', 'award_type_code', input.awardTypeCode, 'awardTypeCode');
    if (input.endDate && input.endDate < input.startDate) {
      throw new ValidationError('endDate must not be before startDate', [{ field: 'endDate', message: 'Must not be before startDate' }]);
    }
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [enrolment] = await tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.id, input.enrolmentId as Uuid), eq(enrolments.personId, personId as Uuid), eq(enrolments.tenantId, tenantId as Uuid),
      )).limit(1);
      if (!enrolment) throw new NotFoundError('Enrolment', input.enrolmentId);
    });
    const inserted = await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(supportAwards).values({
        tenantId: tenantId as Uuid,
        personId: personId as Uuid,
        enrolmentId: input.enrolmentId as Uuid,
        awardTypeCode: input.awardTypeCode,
        awardReference: input.awardReference.trim(),
        funder: input.funder.trim(),
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        statusCode: 'draft',
        createdBy: actorId,
      }).onConflictDoNothing().returning(),
    );
    if (!inserted[0]) throw new ConflictError(`An award with reference '${input.awardReference}' already exists`);
    return this.getAward(tenantId, inserted[0].id);
  }

  async approveAward(tenantId: string, awardId: string, actorId: string): Promise<SupportAwardDto> {
    const award = await this.#award(tenantId, awardId);
    if (award.statusCode === 'approved') return this.getAward(tenantId, awardId);
    if (award.statusCode !== 'draft') throw new ConflictError(`This award is ${award.statusCode}`);
    if (award.createdBy === actorId) {
      throw new ConflictError('The person who recorded an award cannot also approve it');
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(supportAwards).set({ statusCode: 'approved', approvedBy: actorId, approvedAt: now, updatedAt: now })
        .where(and(eq(supportAwards.id, awardId as Uuid), eq(supportAwards.statusCode, 'draft'))),
    );
    return this.getAward(tenantId, awardId);
  }

  async addInstalment(tenantId: string, awardId: string, input: AddInstalmentInput, actorId: string): Promise<SupportInstalmentDto> {
    const award = await this.#award(tenantId, awardId);
    if (award.statusCode === 'ended') throw new ConflictError('This award has ended');
    if (NOT_SUPPORT_PAYMENT_TYPES.has(input.paymentTypeCode)) {
      throw new ValidationError('Teaching pay is employment, paid by HR and payroll, not student support', [
        { field: 'paymentTypeCode', message: 'Not a student support payment' },
      ]);
    }
    await this.#checkCode(tenantId, 'support_instalment', 'payment_type_code', input.paymentTypeCode, 'paymentTypeCode');
    if (!Number.isInteger(input.amountMinorUnits) || input.amountMinorUnits <= 0) {
      throw new ValidationError('amountMinorUnits must be a positive whole number of pence', [{ field: 'amountMinorUnits', message: 'Must be greater than 0' }]);
    }
    if (input.periodEnd < input.periodStart) {
      throw new ValidationError('periodEnd must not be before periodStart', [{ field: 'periodEnd', message: 'Must not be before periodStart' }]);
    }
    if (input.periodStart < award.startDate || (award.endDate && input.periodEnd > award.endDate)) {
      throw new ValidationError('The instalment period must fall within the award', [{ field: 'periodStart', message: 'Outside the award dates' }]);
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(supportInstalments).values({
        tenantId: tenantId as Uuid,
        awardId: awardId as Uuid,
        paymentTypeCode: input.paymentTypeCode,
        amountMinorUnits: input.amountMinorUnits,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        dueDate: input.dueDate,
        statusCode: 'planned',
        createdBy: actorId,
      }).returning(),
    );
    return instalmentDto(row!);
  }

  /**
   * Approve an instalment and send payroll the instruction. Repeat-safe: an
   * approved instalment is not sent twice (the delivery item's key is the
   * instalment id).
   */
  async approveInstalment(tenantId: string, instalmentId: string, actorId: string): Promise<SupportInstalmentDto> {
    const instalment = await this.#instalment(tenantId, instalmentId);
    const award = await this.#award(tenantId, instalment.awardId);
    if (instalment.statusCode !== 'planned' && instalment.statusCode !== 'approved') {
      throw new ConflictError(`This instalment is ${instalment.statusCode}`);
    }
    if (instalment.statusCode === 'planned') {
      if (award.statusCode !== 'approved') throw new ConflictError('The award must be approved before its instalments');
      if (instalment.createdBy === actorId) {
        throw new ConflictError('The person who recorded an instalment cannot also approve it');
      }
      const now = clockNow();
      await withTenantContext(this.db, tenantId, (tx) =>
        tx.update(supportInstalments).set({ statusCode: 'approved', approvedBy: actorId, approvedAt: now, updatedAt: now })
          .where(and(eq(supportInstalments.id, instalmentId as Uuid), eq(supportInstalments.statusCode, 'planned'))),
      );
    }

    const [person] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ studentNumber: persons.studentNumber }).from(persons)
        .where(and(eq(persons.id, award.personId), eq(persons.tenantId, tenantId as Uuid))).limit(1),
    );
    await this.delivery.request(tenantId, {
      flowCode: PAYROLL_FLOW,
      subjectType: 'support_instalment',
      subjectId: instalmentId,
      personId: award.personId,
      idempotencyKey: `support-instalment:${instalmentId}`,
      payload: {
        operationId: instalmentId,
        personId: award.personId,
        studentNumber: person?.studentNumber ?? null,
        awardReference: award.awardReference,
        awardTypeCode: award.awardTypeCode,
        funder: award.funder,
        paymentTypeCode: instalment.paymentTypeCode,
        currencyCode: instalment.currencyCode,
        amountMinorUnits: instalment.amountMinorUnits,
        periodStart: instalment.periodStart,
        periodEnd: instalment.periodEnd,
        dueDate: instalment.dueDate,
      },
      summary: `Pay ${instalment.paymentTypeCode} ${pence(instalment.amountMinorUnits)} (award ${award.awardReference}) due ${instalment.dueDate} — operation ${instalmentId}`,
    });
    return instalmentDto(await this.#instalment(tenantId, instalmentId));
  }

  async cancelInstalment(tenantId: string, instalmentId: string): Promise<SupportInstalmentDto> {
    const instalment = await this.#instalment(tenantId, instalmentId);
    if (instalment.statusCode !== 'planned') {
      throw new ConflictError('Only a planned instalment can be cancelled; once approved, payroll owns any recovery');
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(supportInstalments).set({ statusCode: 'cancelled', updatedAt: now }).where(eq(supportInstalments.id, instalmentId as Uuid)),
    );
    return instalmentDto(await this.#instalment(tenantId, instalmentId));
  }

  /**
   * Payroll's outcome for an instruction (from an F-PAY-SIS-01 report that
   * names it). Returns false when the report names no instalment of this
   * person, so it stays an unmatched record for staff to look at.
   */
  async reconcilePayment(tenantId: string, personId: string, confirmation: PaymentConfirmation): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ instalment: supportInstalments, personId: supportAwards.personId })
        .from(supportInstalments)
        .innerJoin(supportAwards, eq(supportAwards.id, supportInstalments.awardId))
        .where(and(eq(supportInstalments.id, confirmation.instructionId as Uuid), eq(supportInstalments.tenantId, tenantId as Uuid)))
        .limit(1),
    );
    const match = rows[0];
    if (!match || match.personId !== personId) return false;
    if (match.instalment.statusCode !== 'approved' && match.instalment.statusCode !== 'rejected' && match.instalment.statusCode !== 'paid') return false;

    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(supportInstalments).set(confirmation.paymentStatus === 'paid'
        ? {
            statusCode: 'paid',
            paymentReference: confirmation.paymentReference,
            paidOn: confirmation.paidOn ?? null,
            paidAmountMinorUnits: confirmation.amountPence ?? null,
            rejectionReason: null,
            updatedAt: now,
          }
        : {
            statusCode: 'rejected',
            paymentReference: confirmation.paymentReference,
            rejectionReason: confirmation.rejectionReason ?? 'Rejected by payroll',
            updatedAt: now,
          })
        .where(eq(supportInstalments.id, confirmation.instructionId as Uuid)),
    );
    // Payroll evidently received the instruction.
    await this.delivery.completeForSubject(tenantId, PAYROLL_FLOW, confirmation.instructionId);
    return true;
  }

  async listForPerson(tenantId: string, personId: string): Promise<SupportAwardDto[]> {
    const awards = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(supportAwards)
        .where(and(eq(supportAwards.personId, personId as Uuid), eq(supportAwards.tenantId, tenantId as Uuid)))
        .orderBy(asc(supportAwards.startDate)),
    );
    return Promise.all(awards.map((a) => this.#withInstalments(tenantId, a)));
  }

  async getAward(tenantId: string, awardId: string): Promise<SupportAwardDto> {
    return this.#withInstalments(tenantId, await this.#award(tenantId, awardId));
  }

  /** Approved studentships in force on `on` (for work-limit checks). */
  async hasActiveStudentship(tenantId: string, personId: string, on: string): Promise<boolean> {
    return (await this.listForPerson(tenantId, personId)).some((a) =>
      a.awardTypeCode === 'studentship' && a.statusCode === 'approved' && a.startDate <= on && (a.endDate === null || a.endDate >= on));
  }

  async #withInstalments(tenantId: string, award: SupportAward): Promise<SupportAwardDto> {
    const instalments = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(supportInstalments).where(eq(supportInstalments.awardId, award.id)).orderBy(asc(supportInstalments.dueDate)),
    );
    return {
      awardId: award.id,
      personId: award.personId,
      enrolmentId: award.enrolmentId,
      awardTypeCode: award.awardTypeCode,
      awardReference: award.awardReference,
      funder: award.funder,
      startDate: award.startDate,
      endDate: award.endDate,
      statusCode: award.statusCode,
      createdBy: award.createdBy,
      approvedBy: award.approvedBy,
      approvedAt: award.approvedAt,
      instalments: instalments.map(instalmentDto),
    };
  }

  async #award(tenantId: string, awardId: string): Promise<SupportAward> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(supportAwards).where(and(eq(supportAwards.id, awardId as Uuid), eq(supportAwards.tenantId, tenantId as Uuid))).limit(1),
    );
    if (!row) throw new NotFoundError('SupportAward', awardId);
    return row;
  }

  async #instalment(tenantId: string, instalmentId: string): Promise<SupportInstalment> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(supportInstalments).where(and(eq(supportInstalments.id, instalmentId as Uuid), eq(supportInstalments.tenantId, tenantId as Uuid))).limit(1),
    );
    if (!row) throw new NotFoundError('SupportInstalment', instalmentId);
    return row;
  }

  async #checkCode(tenantId: string, entity: string, field: string, value: string, name: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field: name, message: 'Value is not active in the configured value set' }]);
    }
  }
}

function pence(p: number): string {
  return `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function instalmentDto(row: SupportInstalment): SupportInstalmentDto {
  return {
    instalmentId: row.id,
    awardId: row.awardId,
    paymentTypeCode: row.paymentTypeCode,
    currencyCode: row.currencyCode,
    amountMinorUnits: row.amountMinorUnits,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDate: row.dueDate,
    statusCode: row.statusCode,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    paymentReference: row.paymentReference,
    paidOn: row.paidOn,
    paidAmountMinorUnits: row.paidAmountMinorUnits,
    rejectionReason: row.rejectionReason,
    createdBy: row.createdBy,
  };
}
