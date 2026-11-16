import {
  enrolments,
  modules,
  personIdentities,
  persons,
  programmes,
  recognisedCredits,
  ruleExceptions,
  type Db,
  type RecognisedCredit,
  type RuleException,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { EnrolmentService } from '../enrolment/service.js';
import { ENROLMENT_RULE_FIELDS } from '../rules-engine/engine.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface RecognisedCreditInput {
  recognitionTypeCode: string;
  sourceDescription: string;
  creditValue: number;
  fheqLevel?: number;
  moduleId?: string;
  statusCaseId?: string;
  evidenceRef?: string;
  /** The academic year whose progression it counts towards (e.g. 2026-27); omit to count towards the award only. */
  academicYear?: string;
}

export interface RuleExceptionInput {
  ruleCode: string;
  exceptionTypeCode: string;
  description: string;
  validFrom: string;
  validTo?: string;
  programmeRuleSetId?: string;
  authorityRef?: string;
  /** For a variation: the replacement value, in the rule's own fields (e.g. { maxCredits: 140 }). */
  variationValue?: Record<string, number | null>;
}

/** Who a pending proposal is about: enough for an approver to decide without the full student record. */
export interface PendingSubject {
  personId: string;
  studentNumber: string;
  studentName: string;
  programmeCode: string | null;
  programmeTitle: string | null;
}

export type Decision = { decisionCode: 'approved' | 'rejected'; reason: string };

/**
 * Recognised credit and rule exceptions for one student (BPR-D05). Each is
 * proposed, then approved or rejected by someone other than the proposer.
 * Only approved, in-force records count.
 */
export class AcademicExceptionService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly enrolments: EnrolmentService,
  ) {}

  // ── Recognised credit ──────────────────────────────────────────────────────

  async proposeCredit(tenantId: string, enrolmentId: string, input: RecognisedCreditInput, actorId: string): Promise<RecognisedCredit> {
    await this.#requireEnrolment(tenantId, enrolmentId);
    await this.#code(tenantId, 'recognised_credit', 'recognition_type_code', input.recognitionTypeCode);
    if (!Number.isInteger(input.creditValue) || input.creditValue <= 0) throw new ValidationError('Credit must be a positive whole number');
    if (input.recognitionTypeCode === 'exemption' && !input.moduleId) throw new ValidationError('An exemption must name the module it exempts');
    if (input.academicYear && !/^\d{4}-\d{2}$/.test(input.academicYear)) throw new ValidationError('academicYear must look like 2026-27');
    if (input.moduleId) {
      const found = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: modules.id }).from(modules)
        .where(and(eq(modules.id, input.moduleId as Uuid), eq(modules.tenantId, tenantId as Uuid), isNull(modules.recordedUntil))).limit(1));
      if (!found[0]) throw new NotFoundError('Module', input.moduleId);
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(recognisedCredits).values({
      tenantId: tenantId as Uuid, enrolmentId: enrolmentId as Uuid, recognitionTypeCode: input.recognitionTypeCode,
      sourceDescription: input.sourceDescription, creditValue: input.creditValue, fheqLevel: input.fheqLevel ?? null,
      moduleId: (input.moduleId ?? null) as Uuid | null, statusCaseId: (input.statusCaseId ?? null) as Uuid | null,
      evidenceRef: input.evidenceRef ?? null, academicYear: input.academicYear ?? null, createdBy: actorId,
    }).returning());
    return row!;
  }

  /** Approved recognised credit counting towards one academic year's progression. */
  async approvedCreditForYear(tenantId: string, enrolmentId: string, academicYear: string): Promise<RecognisedCredit[]> {
    return approvedCreditForYearFor(this.db, tenantId, enrolmentId, academicYear);
  }

  /** Modules the student is exempt from (approved exemptions), for one academic year or year-independent. */
  async approvedExemptions(tenantId: string, enrolmentId: string, academicYear?: string): Promise<Array<{ moduleId: string; creditValue: number; recognisedCreditId: string }>> {
    return approvedExemptionsFor(this.db, tenantId, enrolmentId, academicYear ?? null);
  }

  async decideCredit(tenantId: string, creditId: string, decision: Decision, actorId: string): Promise<RecognisedCredit> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(recognisedCredits)
      .where(and(eq(recognisedCredits.id, creditId as Uuid), eq(recognisedCredits.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('RecognisedCredit', creditId);
    this.#assertDecidable(row.statusCode, row.createdBy, actorId);
    const [updated] = await withTenantContext(this.db, tenantId, (tx) => tx.update(recognisedCredits).set({
      statusCode: decision.decisionCode, decidedBy: actorId, decidedAt: clockNow(), decisionReason: decision.reason,
    }).where(eq(recognisedCredits.id, row.id)).returning());
    return updated!;
  }

  async listCredits(tenantId: string, enrolmentId: string): Promise<{ credits: RecognisedCredit[]; approvedCreditTotal: number }> {
    const credits = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(recognisedCredits)
      .where(and(eq(recognisedCredits.tenantId, tenantId as Uuid), eq(recognisedCredits.enrolmentId, enrolmentId as Uuid)))
      .orderBy(desc(recognisedCredits.createdAt)));
    const approvedCreditTotal = credits.filter((c) => c.statusCode === 'approved').reduce((sum, c) => sum + c.creditValue, 0);
    return { credits, approvedCreditTotal };
  }

  // ── Rule exceptions ────────────────────────────────────────────────────────

  async proposeException(tenantId: string, enrolmentId: string, input: RuleExceptionInput, actorId: string): Promise<RuleException> {
    await this.#requireEnrolment(tenantId, enrolmentId);
    await this.#code(tenantId, 'rule_exception', 'exception_type_code', input.exceptionTypeCode);
    if (input.validTo && input.validTo <= input.validFrom) throw new ValidationError('An exception must end after it starts');
    // Only rules evaluated for an individual student can be excepted, so an
    // approved exception always has an effect (see RulesEngine.resolveForEnrolment).
    const fields = (ENROLMENT_RULE_FIELDS as Record<string, readonly string[]>)[input.ruleCode];
    if (!fields) {
      throw new ValidationError(`Rule '${input.ruleCode}' cannot be excepted for one student; use one of ${Object.keys(ENROLMENT_RULE_FIELDS).join(', ')}`);
    }
    if (input.exceptionTypeCode === 'waiver' && input.variationValue) throw new ValidationError('A waiver removes the rule; it takes no value');
    if (input.exceptionTypeCode === 'variation') {
      const value = input.variationValue ?? {};
      const keys = Object.keys(value);
      if (keys.length === 0) throw new ValidationError(`A variation of ${input.ruleCode} needs a value: ${fields.join(' and/or ')}`);
      const unknown = keys.filter((k) => !fields.includes(k));
      if (unknown.length > 0) throw new ValidationError(`${unknown.join(', ')} is not a field of ${input.ruleCode} (expected ${fields.join(', ')})`);
      if (keys.some((k) => value[k] !== null && (typeof value[k] !== 'number' || value[k] < 0))) {
        throw new ValidationError('Variation values must be non-negative numbers (or null to remove a bound)');
      }
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(ruleExceptions).values({
      tenantId: tenantId as Uuid, enrolmentId: enrolmentId as Uuid, ruleCode: input.ruleCode,
      exceptionTypeCode: input.exceptionTypeCode, description: input.description, validFrom: input.validFrom,
      validTo: input.validTo ?? null, programmeRuleSetId: (input.programmeRuleSetId ?? null) as Uuid | null,
      authorityRef: input.authorityRef ?? null, createdBy: actorId,
      variationValue: input.exceptionTypeCode === 'variation' ? (input.variationValue ?? null) : null,
    }).returning());
    return row!;
  }

  async decideException(tenantId: string, exceptionId: string, decision: Decision, actorId: string): Promise<RuleException> {
    const row = await this.#exception(tenantId, exceptionId);
    this.#assertDecidable(row.statusCode, row.createdBy, actorId);
    const [updated] = await withTenantContext(this.db, tenantId, (tx) => tx.update(ruleExceptions).set({
      statusCode: decision.decisionCode, decidedBy: actorId, decidedAt: clockNow(), decisionReason: decision.reason,
    }).where(eq(ruleExceptions.id, row.id)).returning());
    return updated!;
  }

  /** Ends an approved exception; its history is kept. */
  async revokeException(tenantId: string, exceptionId: string, reason: string, actorId: string): Promise<RuleException> {
    const row = await this.#exception(tenantId, exceptionId);
    if (row.statusCode !== 'approved') throw new ConflictError(`Only an approved exception can be revoked; this one is ${row.statusCode}`);
    const [updated] = await withTenantContext(this.db, tenantId, (tx) => tx.update(ruleExceptions).set({
      statusCode: 'revoked', decisionReason: `${row.decisionReason ?? ''}${row.decisionReason ? '; ' : ''}Revoked: ${reason}`,
      decidedBy: actorId, decidedAt: clockNow(),
    }).where(eq(ruleExceptions.id, row.id)).returning());
    return updated!;
  }

  async listExceptions(tenantId: string, enrolmentId: string): Promise<RuleException[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(ruleExceptions)
      .where(and(eq(ruleExceptions.tenantId, tenantId as Uuid), eq(ruleExceptions.enrolmentId, enrolmentId as Uuid)))
      .orderBy(desc(ruleExceptions.createdAt)));
  }

  /**
   * Every proposal awaiting a decision, across the tenant, oldest first: the
   * approver's worklist. Each carries the student's name, number and
   * programme, so an approver need not hold student-record access.
   */
  async pendingApprovals(tenantId: string): Promise<{
    credits: Array<RecognisedCredit & { subject: PendingSubject }>;
    exceptions: Array<RuleException & { subject: PendingSubject }>;
  }> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const credits = await tx.select().from(recognisedCredits).where(and(
        eq(recognisedCredits.tenantId, tenantId as Uuid), eq(recognisedCredits.statusCode, 'proposed'),
      )).orderBy(asc(recognisedCredits.createdAt));
      const exceptions = await tx.select().from(ruleExceptions).where(and(
        eq(ruleExceptions.tenantId, tenantId as Uuid), eq(ruleExceptions.statusCode, 'proposed'),
      )).orderBy(asc(ruleExceptions.createdAt));

      const enrolmentIds = [...new Set([...credits, ...exceptions].map((r) => r.enrolmentId))];
      const subjects = new Map<string, PendingSubject>();
      for (const enrolmentId of enrolmentIds) {
        const [row] = await tx.select({
          personId: persons.id, studentNumber: persons.studentNumber,
          firstName: personIdentities.legalFirstName, familyName: personIdentities.legalFamilyName,
          programmeCode: programmes.code, programmeTitle: programmes.title,
        }).from(enrolments)
          .innerJoin(persons, eq(persons.id, enrolments.personId))
          .leftJoin(personIdentities, and(eq(personIdentities.personId, persons.id), isNull(personIdentities.recordedUntil), isNull(personIdentities.validTo)))
          .leftJoin(programmes, and(eq(programmes.id, enrolments.programmeId), isNull(programmes.recordedUntil), isNull(programmes.validTo)))
          .where(and(eq(enrolments.id, enrolmentId), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil)))
          .limit(1);
        if (row) {
          subjects.set(enrolmentId, {
            personId: row.personId, studentNumber: row.studentNumber,
            studentName: row.firstName ? `${row.firstName} ${row.familyName ?? ''}`.trim() : row.studentNumber,
            programmeCode: row.programmeCode ?? null, programmeTitle: row.programmeTitle ?? null,
          });
        }
      }
      const unknown = (enrolmentId: string): PendingSubject => ({ personId: '', studentNumber: '', studentName: `Enrolment ${enrolmentId}`, programmeCode: null, programmeTitle: null });
      return {
        credits: credits.map((c) => ({ ...c, subject: subjects.get(c.enrolmentId) ?? unknown(c.enrolmentId) })),
        exceptions: exceptions.map((x) => ({ ...x, subject: subjects.get(x.enrolmentId) ?? unknown(x.enrolmentId) })),
      };
    });
  }

  /** Approved exceptions in force on a date, e.g. for the rules engine. */
  async inForceExceptions(tenantId: string, enrolmentId: string, onDate: string): Promise<RuleException[]> {
    return (await this.listExceptions(tenantId, enrolmentId))
      .filter((e) => e.statusCode === 'approved' && e.validFrom <= onDate && (!e.validTo || e.validTo > onDate));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  #assertDecidable(statusCode: string, createdBy: string, actorId: string): void {
    if (statusCode !== 'proposed') throw new ConflictError(`This record is already ${statusCode}`);
    if (createdBy === actorId) throw new ConflictError('The person who proposed this cannot decide it');
  }

  async #exception(tenantId: string, id: string): Promise<RuleException> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(ruleExceptions)
      .where(and(eq(ruleExceptions.id, id as Uuid), eq(ruleExceptions.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('RuleException', id);
    return row;
  }

  async #requireEnrolment(tenantId: string, enrolmentId: string): Promise<void> {
    if (!(await this.enrolments.getEnrolment(enrolmentId, tenantId))) throw new NotFoundError('Enrolment', enrolmentId);
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}

// ── Read helpers for rule consumers (no service dependency needed) ───────────

/** Approved module exemptions for an enrolment, for one academic year or year-independent ones. */
export async function approvedExemptionsFor(
  db: Db, tenantId: string, enrolmentId: string, academicYear: string | null,
): Promise<Array<{ moduleId: string; creditValue: number; recognisedCreditId: string }>> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.select().from(recognisedCredits).where(and(
    eq(recognisedCredits.tenantId, tenantId as Uuid),
    eq(recognisedCredits.enrolmentId, enrolmentId as Uuid),
    eq(recognisedCredits.statusCode, 'approved'),
    eq(recognisedCredits.recognitionTypeCode, 'exemption'),
  )));
  return rows
    .filter((c) => c.moduleId && (c.academicYear === null || academicYear === null || c.academicYear === academicYear))
    .map((c) => ({ moduleId: c.moduleId!, creditValue: c.creditValue, recognisedCreditId: c.id }));
}

/** Approved recognised credit counting towards one academic year's progression. */
export async function approvedCreditForYearFor(db: Db, tenantId: string, enrolmentId: string, academicYear: string): Promise<RecognisedCredit[]> {
  return withTenantContext(db, tenantId, (tx) => tx.select().from(recognisedCredits).where(and(
    eq(recognisedCredits.tenantId, tenantId as Uuid),
    eq(recognisedCredits.enrolmentId, enrolmentId as Uuid),
    eq(recognisedCredits.statusCode, 'approved'),
    eq(recognisedCredits.academicYear, academicYear),
  )));
}
