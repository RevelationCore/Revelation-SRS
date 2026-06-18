import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  awards,
  enrolments,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  personIdentities,
  persons,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

// ── HEAR document schema ──────────────────────────────────────────────────────

export interface HearModuleResult {
  moduleCode:    string;
  moduleTitle:   string;
  creditValue:   number;
  academicYear:  string;
  aggregateMark: number;
  resultCode:    string;
}

export interface HearDocument {
  version:      string;
  generatedAt:  string;
  institution:  { tenantId: string };
  student: {
    personId:        string;
    studentNumber:   string;
    legalFirstName:  string;
    legalFamilyName: string;
  };
  award: {
    qualificationCode:  string;
    classificationCode: string;
    awardDate:          string;
    examBoardId:        string;
  };
  moduleResults: HearModuleResult[];
}

export interface HearDto {
  enrolmentId:     string;
  awardId:         string;
  hearGeneratedAt: Date;
  document:        HearDocument;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class HearService {
  constructor(private readonly db: Db) {}

  /**
   * Builds a structured HEAR document and persists it on the award record.
   *
   * Only callable for awarded enrolments. Performs a bitemporal update on the
   * award to store the document and refresh hear_generated_at. The Stage 8
   * stub (hear_generated_at set, hear_document null) is replaced with a full
   * JSONB document on this call.
   */
  async generateHear(enrolmentId: string, tenantId: string, actorId: string): Promise<HearDto> {
    const award = await this.#getCurrentAward(enrolmentId, tenantId);
    if (!award) {
      throw new ValidationError(
        `Enrolment '${enrolmentId}' has no conferred award; HEAR can only be generated for awarded enrolments`,
      );
    }

    const student        = await this.#getStudentIdentity(award.personId, tenantId);
    const ratifiedResults = await this.#getRatifiedModuleResults(enrolmentId, tenantId);
    const now            = clockNow();

    const document: HearDocument = {
      version:     '1.0',
      generatedAt: now.toISOString(),
      institution: { tenantId },
      student: {
        personId:        award.personId,
        studentNumber:   student.studentNumber,
        legalFirstName:  student.legalFirstName,
        legalFamilyName: student.legalFamilyName,
      },
      award: {
        qualificationCode:  award.qualificationCode,
        classificationCode: award.classificationCode,
        awardDate:          award.awardDate,
        examBoardId:        award.examBoardId,
      },
      moduleResults: ratifiedResults,
    };

    // Bitemporally update the award to store the HEAR document
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(awards)
        .set({ recordedUntil: now, validTo: now })
        .where(and(
          eq(awards.id,       award.awardId  as `${string}-${string}-${string}-${string}-${string}`),
          eq(awards.tenantId, tenantId        as `${string}-${string}-${string}-${string}-${string}`),
          isNull(awards.recordedUntil),
        ));

      await tx.insert(awards).values({
        versionId:           randomUUID(),
        id:                  award.awardId  as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:            tenantId        as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:         enrolmentId    as `${string}-${string}-${string}-${string}-${string}`,
        personId:            award.personId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId:         award.examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        qualificationCode:   award.qualificationCode,
        classificationCode:  award.classificationCode,
        awardDate:           award.awardDate,
        hearGeneratedAt:     now,
        certificateIssuedAt: award.certificateIssuedAt,
        hearDocument:        document,
        actorId,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });

    return {
      enrolmentId,
      awardId:         award.awardId,
      hearGeneratedAt: now,
      document,
    };
  }

  /**
   * Returns the current HEAR document for an enrolment.
   * Throws 404 if no award exists, 422 if HEAR has not been generated yet.
   */
  async getHear(enrolmentId: string, tenantId: string): Promise<HearDto> {
    await this.#ensureEnrolmentExists(enrolmentId, tenantId);
    const award = await this.#getCurrentAward(enrolmentId, tenantId);
    if (!award) throw new NotFoundError('Award', enrolmentId);
    if (!award.hearDocument) {
      throw new ValidationError(
        `HEAR has not been generated for enrolment '${enrolmentId}'; call POST /hear first`,
      );
    }
    return {
      enrolmentId,
      awardId:         award.awardId,
      hearGeneratedAt: award.hearGeneratedAt!,
      document:        award.hearDocument as unknown as HearDocument,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #getCurrentAward(enrolmentId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(awards).where(and(
        eq(awards.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(awards.tenantId,    tenantId    as `${string}-${string}-${string}-${string}-${string}`),
        isNull(awards.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      awardId:            row.id,
      personId:           row.personId,
      examBoardId:        row.examBoardId,
      qualificationCode:  row.qualificationCode,
      classificationCode: row.classificationCode,
      awardDate:          row.awardDate,
      hearGeneratedAt:    row.hearGeneratedAt,
      certificateIssuedAt: row.certificateIssuedAt,
      hearDocument:       row.hearDocument,
    };
  }

  async #getStudentIdentity(personId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        studentNumber:   persons.studentNumber,
        legalFirstName:  personIdentities.legalFirstName,
        legalFamilyName: personIdentities.legalFamilyName,
      })
        .from(persons)
        .leftJoin(personIdentities, and(
          eq(personIdentities.personId, persons.id),
          isNull(personIdentities.recordedUntil),
        ))
        .where(and(
          eq(persons.id,       personId as `${string}-${string}-${string}-${string}-${string}`),
          eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ))
        .limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Person', personId);
    return {
      studentNumber:   row.studentNumber,
      legalFirstName:  row.legalFirstName ?? '',
      legalFamilyName: row.legalFamilyName ?? '',
    };
  }

  async #getRatifiedModuleResults(enrolmentId: string, tenantId: string): Promise<HearModuleResult[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        moduleCode:    modules.code,
        moduleTitle:   modules.title,
        creditValue:   modules.creditValue,
        academicYear:  academicPeriods.academicYear,
        aggregateMark: moduleResults.aggregateMark,
        resultCode:    moduleResults.resultCode,
        locked:        moduleResults.locked,
      })
        .from(moduleResults)
        .innerJoin(moduleRegistrations, eq(moduleResults.moduleRegistrationId, moduleRegistrations.id))
        .innerJoin(moduleOfferings,     eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods,     eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .innerJoin(modules,             eq(moduleOfferings.moduleId, modules.id))
        .where(and(
          eq(moduleResults.tenantId,          tenantId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId,    tenantId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId,        tenantId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId,        tenantId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(modules.tenantId,               tenantId    as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleResults.locked,            true),
          isNull(moduleResults.recordedUntil),
          isNull(moduleRegistrations.recordedUntil),
          isNull(modules.recordedUntil),
        )),
    );

    return rows.map((row) => ({
      moduleCode:    row.moduleCode,
      moduleTitle:   row.moduleTitle,
      creditValue:   row.creditValue ?? 0,
      academicYear:  row.academicYear,
      aggregateMark: Number(row.aggregateMark),
      resultCode:    row.resultCode,
    }));
  }

  async #ensureEnrolmentExists(enrolmentId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.id,       enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.tenantId, tenantId    as `${string}-${string}-${string}-${string}-${string}`),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
  }
}
