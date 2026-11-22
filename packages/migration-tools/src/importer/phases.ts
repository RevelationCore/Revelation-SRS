import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import {
  persons, personIdentities, studentAddresses,
  programmes, modules, moduleOfferings, academicPeriods,
  enrolments,
  moduleRegistrations,
  assessmentComponents, marks,
  reasonableAdjustments,
  exceptionalCircumstances,
  type Db,
} from '@revelation-srs/db';

import type { ImportPayload } from '../contracts/payload.js';

import type { IdMap } from './id-map.js';
import type { ImportLog } from './import-log.js';

const IMPORT_ACTOR = 'migration-import';

// ── Helper: derive start/end dates for a synthetic academic period ──────────
function periodDates(academicPeriodCode: string): { startDate: string; endDate: string; periodTypeCode: string } {
  const [yearPart, periodPart = 'year'] = academicPeriodCode.split(':');
  const yearStart = parseInt((yearPart ?? '2024-25').slice(0, 4), 10);

  if (periodPart === 'sem1') {
    return { startDate: `${yearStart}-09-01`, endDate: `${yearStart + 1}-01-31`, periodTypeCode: 'semester' };
  }
  if (periodPart === 'sem2') {
    return { startDate: `${yearStart + 1}-02-01`, endDate: `${yearStart + 1}-06-30`, periodTypeCode: 'semester' };
  }
  return { startDate: `${yearStart}-09-01`, endDate: `${yearStart + 1}-06-30`, periodTypeCode: 'year' };
}

// ── Phase 1: identity ──────────────────────────────────────────────────────

export async function importIdentity(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
): Promise<void> {
  const now = new Date();

  for (const p of payload.persons) {
    const personKey = `person::${p.externalId}`;
    const loaded = await log.row(db, 'person', p.externalId, async (db) => {
      const personId = idMap.resolve(personKey);

      await db.insert(persons).values({
        id:              personId,
        tenantId,
        studentNumber:   p.studentNumber ?? p.externalId,
        hesaId:          p.hesaId ?? null,
        personStatusCode: 'active',
        sourceSystem:    payload.meta.sourceSystem,
        sourceReference: p.externalId,
      });

      await db.insert(personIdentities).values({
        versionId:           randomUUID(),
        id:                  randomUUID(),
        tenantId,
        personId,
        legalFirstName:      p.legalFirstName,
        legalFamilyName:     p.legalFamilyName,
        preferredName:       p.preferredName ?? null,
        dateOfBirth:         p.dateOfBirth ?? null,
        genderCode:          p.genderCode ?? null,
        nationalityCode:     p.nationalityCode ?? null,
        domicileCode:        p.domicileCode ?? null,
        ethnicityCode:       p.ethnicityCode ?? null,
        emailInstitutional:  p.emailInstitutional ?? null,
        emailPersonal:       p.emailPersonal ?? null,
        phoneMobile:         p.phoneMobile ?? null,
        communicationLocaleCode: null,
        preferredTimeZone:   null,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });

      for (const addr of p.addresses ?? []) {
        await db.insert(studentAddresses).values({
          versionId:       randomUUID(),
          id:              randomUUID(),
          tenantId,
          personId,
          addressTypeCode: addr.addressTypeCode,
          line1:           addr.line1,
          line2:           addr.line2 ?? null,
          city:            addr.city ?? null,
          postcode:        addr.postcode ?? null,
          countryCode:     addr.countryCode ?? null,
          validFrom:       now,
          validTo:         null,
          recordedAt:      now,
          recordedUntil:   null,
        });
      }
    });
    if (!loaded) idMap.forget(personKey);
  }

}

// ── Phase 2: catalogue ────────────────────────────────────────────────────

export async function importCatalogue(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
): Promise<void> {
  const now = new Date();

  for (const prog of payload.programmes ?? []) {
    const key = `programme::${prog.externalId}`;
    const loaded = await log.row(db, 'programme', prog.externalId, async (db) => {
      const progId = idMap.resolve(key);
      await db.insert(programmes).values({
        versionId:             randomUUID(),
        id:                    progId,
        tenantId,
        code:                  prog.code,
        title:                 prog.title,
        qualificationTypeCode: prog.qualificationTypeCode ?? null,
        fheqLevel:             prog.fheqLevel ?? null,
        creditTotal:           prog.creditTotal ?? null,
        durationYears:         prog.durationYears ?? null,
        modeOfStudyCode:       prog.modeOfStudyCode ?? null,
        owningSchool:          prog.owningSchool ?? null,
        creditFrameworkCode:   prog.creditFrameworkCode ?? null,
        awardingBodyId:        null,
        sourceSystemReference: prog.externalId,
        validFrom:             now,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });
    if (!loaded) idMap.forget(key);
  }

  for (const mod of payload.modules ?? []) {
    const key = `module::${mod.externalId}`;
    const loaded = await log.row(db, 'module', mod.externalId, async (db) => {
      const modId = idMap.resolve(key);
      await db.insert(modules).values({
        versionId:    randomUUID(),
        id:           modId,
        tenantId,
        code:         mod.code,
        title:        mod.title,
        creditValue:  mod.creditValue ?? null,
        fheqLevel:    mod.fheqLevel ?? null,
        validFrom:    now,
        validTo:      null,
        recordedAt:   now,
        recordedUntil: null,
      });
    });
    if (!loaded) idMap.forget(key);
  }

  const periodCache = new Map<string, string>();

  for (const off of payload.moduleOfferings ?? []) {
    const modId = idMap.get(`module::${off.moduleExternalId}`);
    if (modId === undefined) {
      log.unresolved('moduleOffering', off.externalId, `Module offering ${off.externalId} was not loaded because module ${off.moduleExternalId} was not loaded`);
      continue;
    }

    const key = `offering::${off.externalId}`;
    const periodCode = off.academicPeriodCode;
    let periodId = periodCache.get(periodCode);
    const loaded = await log.row(db, 'moduleOffering', off.externalId, async (db) => {

      if (periodId === undefined) {
        const existing = await db.execute<{ id: string }>(
          sql`SELECT id FROM academic_period WHERE tenant_id = ${tenantId} AND academic_year || ':' || lower(period_code) = lower(${periodCode}) LIMIT 1`,
        );
        if (existing.length > 0 && existing[0] !== undefined) {
          periodId = existing[0].id;
        } else {
          periodId = randomUUID();
          const [yearPart, pcode = 'year'] = periodCode.split(':');
          const dates = periodDates(periodCode);
          await db.insert(academicPeriods).values({
            id:             periodId,
            tenantId,
            academicYear:   yearPart ?? periodCode,
            periodCode:     pcode.toUpperCase(),
            periodTypeCode: dates.periodTypeCode,
            startDate:      dates.startDate,
            endDate:        dates.endDate,
          });
        }
      }

      const offeringId = idMap.resolve(key);
      await db.insert(moduleOfferings).values({
        id:               offeringId,
        tenantId,
        moduleId:         modId,
        academicPeriodId: periodId,
        deliveryModeCode: off.deliveryModeCode ?? null,
        capacity:         off.capacity ?? null,
      });
    });
    // The period is cached only once its savepoint has committed.
    if (loaded && periodId !== undefined) periodCache.set(periodCode, periodId);
    if (!loaded) idMap.forget(key);
  }

}

// ── Phase 3: enrolments ───────────────────────────────────────────────────

export async function importEnrolments(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
): Promise<void> {
  const now = new Date();

  for (const enr of payload.enrolments ?? []) {
    const personId = idMap.get(`person::${enr.personExternalId}`);
    if (personId === undefined) {
      log.unresolved('enrolment', enr.externalId, `Enrolment ${enr.externalId} was not loaded because person ${enr.personExternalId} was not loaded`);
      continue;
    }

    const key = `enrolment::${enr.externalId}`;
    const loaded = await log.row(db, 'enrolment', enr.externalId, async (db) => {
      const programmeId = enr.programmeExternalId !== undefined
        ? (idMap.get(`programme::${enr.programmeExternalId}`) ?? null)
        : null;

      const enrolmentId = idMap.resolve(key);

      await db.insert(enrolments).values({
        versionId:           randomUUID(),
        id:                  enrolmentId,
        tenantId,
        personId,
        programmeId,
        statusCode:          enr.statusCode,
        modeOfStudyCode:     enr.modeOfStudyCode,
        attendanceTypeCode:  enr.attendanceTypeCode ?? null,
        academicYearOfEntry: enr.academicYearOfEntry,
        startDate:           enr.startDate,
        expectedEndDate:     enr.expectedEndDate ?? null,
        actualEndDate:       enr.actualEndDate ?? null,
        feeBandCode:         enr.feeBandCode ?? null,
        fundingSourceCode:   enr.fundingSourceCode ?? null,
        slcReference:        enr.slcReference ?? null,
        ucasPersonalId:      enr.ucasPersonalId ?? null,
        validFrom:           new Date(enr.startDate),
        validTo:             enr.actualEndDate ? new Date(enr.actualEndDate) : null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });
    if (!loaded) idMap.forget(key);
  }
}

// ── Phase 4: registrations ────────────────────────────────────────────────

export async function importRegistrations(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
): Promise<void> {
  const now = new Date();

  for (const reg of payload.moduleRegistrations ?? []) {
    const enrolmentId = idMap.get(`enrolment::${reg.enrolmentExternalId}`);
    const offeringId  = idMap.get(`offering::${reg.moduleOfferingExternalId}`);
    if (enrolmentId === undefined || offeringId === undefined) {
      log.unresolved('moduleRegistration', reg.externalId, `Module registration ${reg.externalId} was not loaded because ${
        enrolmentId === undefined ? `enrolment ${reg.enrolmentExternalId}` : `module offering ${reg.moduleOfferingExternalId}`} was not loaded`);
      continue;
    }

    const key = `reg::${reg.externalId}`;
    const loaded = await log.row(db, 'moduleRegistration', reg.externalId, async (db) => {
      const regId = idMap.resolve(key);

      await db.insert(moduleRegistrations).values({
        versionId:        randomUUID(),
        id:               regId,
        tenantId,
        enrolmentId,
        moduleOfferingId: offeringId,
        statusCode:       reg.statusCode,
        registrationDate: reg.registrationDate,
        validFrom:        new Date(reg.registrationDate),
        validTo:          null,
        recordedAt:       now,
        recordedUntil:    null,
      });
    });
    if (!loaded) idMap.forget(key);
  }
}

// ── Phase 5: assessment ───────────────────────────────────────────────────

export async function importAssessment(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
): Promise<void> {
  const now = new Date();

  // A component is cached only once the savepoint that created it has
  // committed, so a mark that fails does not leave later marks pointing at a
  // component that was rolled back.
  const componentCache = new Map<string, string>();

  for (const mark of payload.marks ?? []) {
    const markKey = `${mark.moduleRegistrationExternalId}/${mark.componentTypeCode}`;
    const regId = idMap.get(`reg::${mark.moduleRegistrationExternalId}`);
    const reg = payload.moduleRegistrations?.find(r => r.externalId === mark.moduleRegistrationExternalId);
    const offeringId = reg !== undefined ? idMap.get(`offering::${reg.moduleOfferingExternalId}`) : undefined;
    if (regId === undefined || offeringId === undefined) {
      log.unresolved('mark', markKey, `Mark ${markKey} was not loaded because module registration ${mark.moduleRegistrationExternalId} was not loaded`);
      continue;
    }

    const cacheKey = `${offeringId}::${mark.componentTypeCode}`;
    let componentId = componentCache.get(cacheKey);
    const loaded = await log.row(db, 'mark', markKey, async (db) => {
      if (componentId === undefined) {
        componentId = randomUUID();
        await createComponent(db, componentId, offeringId, mark.componentTypeCode);
      }
      const markDecimal = mark.rawMark.toFixed(2);

      await db.insert(marks).values({
        versionId:             randomUUID(),
        id:                    randomUUID(),
        tenantId,
        moduleRegistrationId:  regId,
        assessmentComponentId: componentId,
        assessmentSubmissionId: null,
        attemptNumber:         1,
        rawMark:               markDecimal,
        adjustedMark:          markDecimal,
        penaltyApplied:        false,
        penaltyPercent:        null,
        locked:                false,
        sourceSystem:          mark.sourceSystem ?? null,
        actorId:               IMPORT_ACTOR,
        validFrom:             new Date(mark.submittedAt),
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });
    if (loaded && componentId !== undefined) componentCache.set(cacheKey, componentId);
  }

  async function createComponent(db: Db, componentId: string, offeringId: string, componentTypeCode: string): Promise<void> {
    await db.insert(assessmentComponents).values({
      id:                componentId,
      tenantId,
      moduleOfferingId:  offeringId,
      componentTypeCode,
      title:             `${componentTypeCode} (imported)`,
      weighting:         100,
      createdAt:         now,
      updatedAt:         now,
    });
  }
}

// ── Phase 6: adjustments ─────────────────────────────────────────────────

/**
 * Adjustments the previous SRS decided are imported as decided (ADR-033 item
 * 7): provenance 'migrated', one batch per run, and the source reference. No
 * distributions are written; a second person releases the batch (BL-379).
 */
export async function importAdjustments(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
  log: ImportLog,
  batchId: string = randomUUID(),
): Promise<{ batchId: string }> {
  const now = new Date();

  for (const adj of payload.adjustments ?? []) {
    const personId    = idMap.get(`person::${adj.personExternalId}`);
    const enrolmentId = idMap.get(`enrolment::${adj.enrolmentExternalId}`);
    if (personId === undefined || enrolmentId === undefined) {
      log.unresolved('adjustment', adj.externalId, `Adjustment ${adj.externalId} was not loaded because ${
        personId === undefined ? `person ${adj.personExternalId}` : `enrolment ${adj.enrolmentExternalId}`} was not loaded`);
      continue;
    }

    await log.row(db, 'adjustment', adj.externalId, async (db) => {
      await db.insert(reasonableAdjustments).values({
        versionId:          randomUUID(),
        id:                 randomUUID(),
        tenantId,
        personId,
        enrolmentId,
        adjustmentTypeCode: adj.adjustmentTypeCode,
        scopeCode:          adj.scopeCode,
        amountValue:        adj.amount ? adj.amount.value.toFixed(2) : null,
        amountUnitCode:     adj.amount?.unitCode ?? null,
        notes:              adj.notes ?? null,
        actorId:            IMPORT_ACTOR,
        provenanceCode:     'migrated',
        migrationBatchId:   batchId,
        migrationSourceReference: `${payload.meta.sourceSystem}:${adj.externalId}`,
        validFrom:          new Date(adj.validFrom),
        validTo:            adj.validTo ? new Date(adj.validTo) : null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });
  }

  for (const ec of payload.exceptionalCircumstances ?? []) {
    const personId    = idMap.get(`person::${ec.personExternalId}`);
    const enrolmentId = idMap.get(`enrolment::${ec.enrolmentExternalId}`);
    if (personId === undefined || enrolmentId === undefined) {
      log.unresolved('exceptionalCircumstance', ec.externalId, `Exceptional circumstance ${ec.externalId} was not loaded because ${
        personId === undefined ? `person ${ec.personExternalId}` : `enrolment ${ec.enrolmentExternalId}`} was not loaded`);
      continue;
    }

    await log.row(db, 'exceptionalCircumstance', ec.externalId, async (db) => {
      const moduleOfferingId = ec.moduleOfferingExternalId !== undefined
        ? (idMap.get(`offering::${ec.moduleOfferingExternalId}`) ?? null)
        : null;

      await db.insert(exceptionalCircumstances).values({
        versionId:         randomUUID(),
        id:                randomUUID(),
        tenantId,
        personId,
        enrolmentId,
        moduleOfferingId,
        outcomeCode:       ec.outcomeCode,
        determinationDate: ec.determinationDate,
        notes:             ec.notes ?? null,
        actorId:           IMPORT_ACTOR,
        validFrom:         now,
        validTo:           null,
        recordedAt:        now,
        recordedUntil:     null,
      });
    });
  }

  return { batchId };
}
