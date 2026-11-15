import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  enrolments,
  persons,
  studentEmploymentLinks,
  ukviCasRequests,
  ukviVisaStatuses,
  workLimitRules,
  type Db,
  type StudentEmploymentLink,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import type { SupportService } from './support-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Work-limit rules and their starting values. Institutions must confirm
 * these against their own policy, the student's visa conditions and each
 * funder's terms, and change them (PUT /work-limits/{ruleCode}):
 *
 *   student-visa-term-time — 20 h/week in term time: the usual condition for
 *     a Student-route visa holder studying at degree level (below degree
 *     level it is lower; record that as a lower value if it applies).
 *   studentship — 6 h/week: a common funder guideline for paid work by a
 *     funded research student; funders' terms differ.
 */
export const WORK_LIMIT_DEFAULTS: Readonly<Record<WorkLimitRuleCode, { maxWeeklyHours: number; description: string }>> = {
  'student-visa-term-time': { maxWeeklyHours: 20, description: 'Term-time working limit for Student-route visa holders (degree level)' },
  'studentship': { maxWeeklyHours: 6, description: 'Paid-work guideline for funded research students' },
};

export type WorkLimitRuleCode = 'student-visa-term-time' | 'studentship';

export interface WorkLimitDto {
  ruleCode:       WorkLimitRuleCode;
  maxWeeklyHours: number;
  description:    string;
  isDefault:      boolean;
}

export interface EmploymentLinkInput {
  roleTypeCode:        string;
  startDate:           string;
  endDate?:            string | null;
  weeklyHours:         number;
  moduleOfferingIds?:  string[];
  supervisorAgreedAt?: string | null;
}

export interface EmploymentLinkDto {
  linkId:                string;
  personId:              string;
  hrEmploymentReference: string;
  roleTypeCode:          string;
  startDate:             string;
  endDate:               string | null;
  weeklyHours:           number;
  moduleOfferingIds:     string[];
  supervisorAgreedAt:    Date | null;
  sourceCode:            string;
}

export interface WorkLimitWarning {
  ruleCode: WorkLimitRuleCode | 'supervisor-agreement';
  message:  string;
}

/**
 * The SRS's knowledge of a student's employment by the institution — the HR
 * reference, role, dates, assigned modules and weekly hours, from HR or
 * entered by staff — and the checks only the SRS can make with it: hours
 * against the visa term-time limit (it holds the visa and term dates) and a
 * studentship's limit and supervisor agreement (it holds the award). The
 * checks warn; HR and the sponsor-compliance owner decide. Hours are the
 * institution's employment only.
 */
export class EmploymentService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly support: SupportService,
  ) {}

  async upsertLink(
    tenantId: string,
    personId: string,
    hrEmploymentReference: string,
    input: EmploymentLinkInput,
    source: 'connector' | 'person',
    actorId: string,
  ): Promise<{ link: EmploymentLinkDto; warnings: WorkLimitWarning[] }> {
    if ((await this.valueSets.validateFieldValue('student_employment_link', 'role_type_code', input.roleTypeCode, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${input.roleTypeCode}' for student_employment_link.role_type_code`, [
        { field: 'roleTypeCode', message: 'Value is not active in the configured value set' },
      ]);
    }
    if (!(input.weeklyHours >= 0 && input.weeklyHours <= 168)) {
      throw new ValidationError('weeklyHours must be between 0 and 168', [{ field: 'weeklyHours', message: 'Must be between 0 and 168' }]);
    }
    if (input.endDate && input.endDate < input.startDate) {
      throw new ValidationError('endDate must not be before startDate', [{ field: 'endDate', message: 'Must not be before startDate' }]);
    }
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [p] = await tx.select({ id: persons.id }).from(persons)
        .where(and(eq(persons.id, personId as Uuid), eq(persons.tenantId, tenantId as Uuid))).limit(1);
      if (!p) throw new NotFoundError('Person', personId);
    });

    const now = clockNow();
    const values = {
      tenantId: tenantId as Uuid,
      personId: personId as Uuid,
      hrEmploymentReference,
      roleTypeCode: input.roleTypeCode,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      weeklyHours: input.weeklyHours.toFixed(2),
      moduleOfferingIds: input.moduleOfferingIds ?? [],
      supervisorAgreedAt: input.supervisorAgreedAt ? new Date(input.supervisorAgreedAt) : null,
      sourceCode: source,
      updatedBy: actorId,
      updatedAt: now,
    };
    await withTenantContext(this.db, tenantId, async (tx) => {
      const [existing] = await tx.select({ personId: studentEmploymentLinks.personId }).from(studentEmploymentLinks)
        .where(and(eq(studentEmploymentLinks.tenantId, tenantId as Uuid), eq(studentEmploymentLinks.hrEmploymentReference, hrEmploymentReference)))
        .limit(1);
      if (existing && existing.personId !== personId) {
        throw new ValidationError(`HR reference ${hrEmploymentReference} is linked to a different person`);
      }
      await tx.insert(studentEmploymentLinks).values(values).onConflictDoUpdate({
        target: [studentEmploymentLinks.tenantId, studentEmploymentLinks.hrEmploymentReference],
        set: {
          roleTypeCode: values.roleTypeCode, startDate: values.startDate, endDate: values.endDate,
          weeklyHours: values.weeklyHours, moduleOfferingIds: values.moduleOfferingIds,
          supervisorAgreedAt: values.supervisorAgreedAt, sourceCode: values.sourceCode,
          updatedBy: values.updatedBy, updatedAt: values.updatedAt,
        },
      });
    });
    const links = await this.listLinks(tenantId, personId);
    return { link: links.find((l) => l.hrEmploymentReference === hrEmploymentReference)!, warnings: await this.warnings(tenantId, personId) };
  }

  async listLinks(tenantId: string, personId: string): Promise<EmploymentLinkDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(studentEmploymentLinks)
        .where(and(eq(studentEmploymentLinks.tenantId, tenantId as Uuid), eq(studentEmploymentLinks.personId, personId as Uuid)))
        .orderBy(studentEmploymentLinks.startDate),
    );
    return rows.map(linkDto);
  }

  /** Links in force today (for study-status changes). */
  async activeLinks(tenantId: string, personId: string, on: string = today()): Promise<EmploymentLinkDto[]> {
    return (await this.listLinks(tenantId, personId)).filter((l) => l.startDate <= on && (l.endDate === null || l.endDate >= on));
  }

  async warnings(tenantId: string, personId: string, on: string = today()): Promise<WorkLimitWarning[]> {
    const links = await this.listLinks(tenantId, personId);
    const current = links.filter((l) => l.endDate === null || l.endDate >= on);
    if (current.length === 0) return [];
    const limits = await this.listLimits(tenantId);
    const limit = (code: WorkLimitRuleCode) => limits.find((l) => l.ruleCode === code)!.maxWeeklyHours;
    const warnings: WorkLimitWarning[] = [];

    if (await this.#isVisaSponsored(tenantId, personId)) {
      const max = limit('student-visa-term-time');
      for (const term of await this.#termsOverlapping(tenantId, current)) {
        const hours = sum(current.filter((l) => overlaps(l, term.startDate, term.endDate)).map((l) => l.weeklyHours));
        if (hours > max) {
          warnings.push({
            ruleCode: 'student-visa-term-time',
            message: `In ${term.label} (term time) university employment totals ${hours} h/week, over the ${max} h/week visa term-time limit`,
          });
        }
      }
    }

    if (await this.support.hasActiveStudentship(tenantId, personId, on)) {
      const max = limit('studentship');
      const inForce = current.filter((l) => l.startDate <= on);
      const hours = sum(inForce.map((l) => l.weeklyHours));
      if (hours > max) {
        warnings.push({ ruleCode: 'studentship', message: `University employment totals ${hours} h/week, over the ${max} h/week studentship limit` });
      }
      for (const l of current.filter((x) => x.supervisorAgreedAt === null)) {
        warnings.push({ ruleCode: 'supervisor-agreement', message: `No supervisor agreement recorded for ${l.hrEmploymentReference} (${l.roleTypeCode}); the studentship requires it` });
      }
    }
    return warnings;
  }

  async listLimits(tenantId: string): Promise<WorkLimitDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(workLimitRules).where(eq(workLimitRules.tenantId, tenantId as Uuid)),
    );
    return (Object.keys(WORK_LIMIT_DEFAULTS) as WorkLimitRuleCode[]).map((ruleCode) => {
      const row = rows.find((r) => r.ruleCode === ruleCode);
      return row
        ? { ruleCode, maxWeeklyHours: Number(row.maxWeeklyHours), description: row.description ?? WORK_LIMIT_DEFAULTS[ruleCode].description, isDefault: false }
        : { ruleCode, ...WORK_LIMIT_DEFAULTS[ruleCode], isDefault: true };
    });
  }

  async setLimit(tenantId: string, ruleCode: string, maxWeeklyHours: number, actorId: string): Promise<WorkLimitDto> {
    if (!(ruleCode in WORK_LIMIT_DEFAULTS)) throw new NotFoundError('WorkLimitRule', ruleCode);
    if (!(maxWeeklyHours >= 0 && maxWeeklyHours <= 168)) {
      throw new ValidationError('maxWeeklyHours must be between 0 and 168', [{ field: 'maxWeeklyHours', message: 'Must be between 0 and 168' }]);
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(workLimitRules).values({
        tenantId: tenantId as Uuid, ruleCode, maxWeeklyHours: maxWeeklyHours.toFixed(2),
        description: WORK_LIMIT_DEFAULTS[ruleCode as WorkLimitRuleCode].description, updatedBy: actorId, updatedAt: now,
      }).onConflictDoUpdate({
        target: [workLimitRules.tenantId, workLimitRules.ruleCode],
        set: { maxWeeklyHours: maxWeeklyHours.toFixed(2), updatedBy: actorId, updatedAt: now },
      }),
    );
    return (await this.listLimits(tenantId)).find((l) => l.ruleCode === ruleCode)!;
  }

  /** Sponsored if any of the person's enrolments has a CAS request or a visa status on record. */
  async #isVisaSponsored(tenantId: string, personId: string): Promise<boolean> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const ids = (await tx.select({ id: enrolments.id }).from(enrolments)
        .where(and(eq(enrolments.personId, personId as Uuid), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil))))
        .map((e) => e.id);
      if (ids.length === 0) return false;
      const cas = await tx.select({ id: ukviCasRequests.id }).from(ukviCasRequests)
        .where(and(inArray(ukviCasRequests.enrolmentId, ids), eq(ukviCasRequests.tenantId, tenantId as Uuid), isNull(ukviCasRequests.recordedUntil))).limit(1);
      if (cas.length > 0) return true;
      const visa = await tx.select({ id: ukviVisaStatuses.id }).from(ukviVisaStatuses)
        .where(and(inArray(ukviVisaStatuses.enrolmentId, ids), eq(ukviVisaStatuses.tenantId, tenantId as Uuid), isNull(ukviVisaStatuses.recordedUntil))).limit(1);
      return visa.length > 0;
    });
  }

  /** Academic periods (term time) that overlap any of the links. */
  async #termsOverlapping(tenantId: string, links: EmploymentLinkDto[]): Promise<Array<{ label: string; startDate: string; endDate: string }>> {
    const periods = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ academicYear: academicPeriods.academicYear, periodCode: academicPeriods.periodCode, startDate: academicPeriods.startDate, endDate: academicPeriods.endDate })
        .from(academicPeriods).where(eq(academicPeriods.tenantId, tenantId as Uuid)),
    );
    return periods
      .map((p) => ({ label: `${p.academicYear} ${p.periodCode}`, startDate: String(p.startDate), endDate: String(p.endDate) }))
      .filter((p) => links.some((l) => overlaps(l, p.startDate, p.endDate)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
}

function overlaps(link: { startDate: string; endDate: string | null }, from: string, to: string): boolean {
  return link.startDate <= to && (link.endDate === null || link.endDate >= from);
}

function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function today(): string {
  return clockNow().toISOString().slice(0, 10);
}

function linkDto(row: StudentEmploymentLink): EmploymentLinkDto {
  return {
    linkId: row.id,
    personId: row.personId,
    hrEmploymentReference: row.hrEmploymentReference,
    roleTypeCode: row.roleTypeCode,
    startDate: row.startDate,
    endDate: row.endDate,
    weeklyHours: Number(row.weeklyHours),
    moduleOfferingIds: row.moduleOfferingIds,
    supervisorAgreedAt: row.supervisorAgreedAt,
    sourceCode: row.sourceCode,
  };
}
