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
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  for (const p of payload.persons) {
    try {
      const personId = idMap.resolve(`person::${p.externalId}`);

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

      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}

// ── Phase 2: catalogue ────────────────────────────────────────────────────

export async function importCatalogue(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  for (const prog of payload.programmes ?? []) {
    try {
      const progId = idMap.resolve(`programme::${prog.externalId}`);
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
      loaded++;
    } catch {
      failed++;
    }
  }

  for (const mod of payload.modules ?? []) {
    try {
      const modId = idMap.resolve(`module::${mod.externalId}`);
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
      loaded++;
    } catch {
      failed++;
    }
  }

  const periodCache = new Map<string, string>();

  for (const off of payload.moduleOfferings ?? []) {
    try {
      const modId = idMap.get(`module::${off.moduleExternalId}`);
      if (modId === undefined) { failed++; continue; }

      const periodCode = off.academicPeriodCode;
      let periodId = periodCache.get(`${tenantId}::${periodCode}`);

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
        periodCache.set(`${tenantId}::${periodCode}`, periodId);
      }

      const offeringId = idMap.resolve(`offering::${off.externalId}`);
      await db.insert(moduleOfferings).values({
        id:               offeringId,
        tenantId,
        moduleId:         modId,
        academicPeriodId: periodId,
        deliveryModeCode: off.deliveryModeCode ?? null,
        capacity:         off.capacity ?? null,
      });
      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}

// ── Phase 3: enrolments ───────────────────────────────────────────────────

export async function importEnrolments(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  for (const enr of payload.enrolments ?? []) {
    try {
      const personId = idMap.get(`person::${enr.personExternalId}`);
      if (personId === undefined) { failed++; continue; }

      const programmeId = enr.programmeExternalId !== undefined
        ? (idMap.get(`programme::${enr.programmeExternalId}`) ?? null)
        : null;

      const enrolmentId = idMap.resolve(`enrolment::${enr.externalId}`);

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
      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}

// ── Phase 4: registrations ────────────────────────────────────────────────

export async function importRegistrations(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  for (const reg of payload.moduleRegistrations ?? []) {
    try {
      const enrolmentId = idMap.get(`enrolment::${reg.enrolmentExternalId}`);
      const offeringId  = idMap.get(`offering::${reg.moduleOfferingExternalId}`);
      if (enrolmentId === undefined || offeringId === undefined) { failed++; continue; }

      const regId = idMap.resolve(`reg::${reg.externalId}`);

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
      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}

// ── Phase 5: assessment ───────────────────────────────────────────────────

export async function importAssessment(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  const componentCache = new Map<string, string>();

  async function getOrCreateComponent(offeringId: string, componentTypeCode: string): Promise<string> {
    const cacheKey = `${offeringId}::${componentTypeCode}`;
    const cached = componentCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const componentId = randomUUID();
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
    componentCache.set(cacheKey, componentId);
    return componentId;
  }

  for (const mark of payload.marks ?? []) {
    try {
      const regId = idMap.get(`reg::${mark.moduleRegistrationExternalId}`);
      if (regId === undefined) { failed++; continue; }

      const reg = payload.moduleRegistrations?.find(r => r.externalId === mark.moduleRegistrationExternalId);
      const offeringId = reg !== undefined ? idMap.get(`offering::${reg.moduleOfferingExternalId}`) : undefined;
      if (offeringId === undefined) { failed++; continue; }

      const componentId = await getOrCreateComponent(offeringId, mark.componentTypeCode);
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
      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}

// ── Phase 6: adjustments ─────────────────────────────────────────────────

export async function importAdjustments(
  db: Db,
  tenantId: string,
  payload: ImportPayload,
  idMap: IdMap,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0;
  let failed = 0;
  const now = new Date();

  for (const adj of payload.adjustments ?? []) {
    try {
      const personId    = idMap.get(`person::${adj.personExternalId}`);
      const enrolmentId = idMap.get(`enrolment::${adj.enrolmentExternalId}`);
      if (personId === undefined || enrolmentId === undefined) { failed++; continue; }

      await db.insert(reasonableAdjustments).values({
        versionId:          randomUUID(),
        id:                 randomUUID(),
        tenantId,
        personId,
        enrolmentId,
        adjustmentTypeCode: adj.adjustmentTypeCode,
        scopeCode:          adj.scopeCode,
        notes:              adj.notes ?? null,
        actorId:            IMPORT_ACTOR,
        validFrom:          new Date(adj.validFrom),
        validTo:            adj.validTo ? new Date(adj.validTo) : null,
        recordedAt:         now,
        recordedUntil:      null,
      });
      loaded++;
    } catch {
      failed++;
    }
  }

  for (const ec of payload.exceptionalCircumstances ?? []) {
    try {
      const personId    = idMap.get(`person::${ec.personExternalId}`);
      const enrolmentId = idMap.get(`enrolment::${ec.enrolmentExternalId}`);
      if (personId === undefined || enrolmentId === undefined) { failed++; continue; }

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
      loaded++;
    } catch {
      failed++;
    }
  }

  return { loaded, failed };
}
