/**
 * SITS-style synthetic mapping template.
 *
 * IP CONSTRAINT NOTICE
 * ════════════════════
 * This template is a SYNTHETIC EXAMPLE only. Field names and conventions are
 * derived from publicly available documentation — specifically the HESA Student
 * Record data items (published at https://www.hesa.ac.uk/collection/c24051) and
 * publicly available Tribal SITS integration guides. No proprietary schema
 * structures, undocumented field names, or vendor-confidential information are
 * reproduced here.
 *
 * This template demonstrates the MAPPING PATTERN and is NOT a certified
 * production connector for SITS:Vision or any other Tribal Group product.
 * Institutions must validate field mappings against their own SITS
 * configuration before using this template in a live migration.
 *
 * See docs/migration-runbook.md § IP Constraint and Disclaimer.
 */

import type {
  ImportPayload,
  ImportPerson,
  ImportAddress,
  ImportEnrolment,
  ImportProgramme,
  ImportModule,
  ImportModuleOffering,
  ImportModuleRegistration,
  ImportMark,
  ImportAward,
} from '../contracts/index.js';

// ── SITS-style source types ────────────────────────────────────────────────
// These interfaces represent a synthetic SITS-style export format.
// Actual SITS field names vary by client configuration; treat these as
// illustrative rather than authoritative.

export interface SitsStudentRecord {
  STU_CODE:    string;   // student number (institution-assigned)
  STU_SURN:    string;   // legal family/surname
  STU_FNAM:    string;   // legal first name
  STU_PNAM?:   string;   // preferred name
  STU_DOB?:    string;   // date of birth YYYY-MM-DD
  STU_SEX?:    string;   // 'M' | 'F' | 'X'
  STU_NATI?:   string;   // ISO nationality code
  STU_DOMI?:   string;   // domicile country code
  STU_EMAI?:   string;   // personal email
  STU_EMLI?:   string;   // institutional email
  STU_TEL1?:   string;   // mobile telephone
  STU_HESA?:   string;   // HESA Person Identifier
  addresses?:  SitsAddress[];
  courses?:    SitsCoursejoin[];
}

export interface SitsAddress {
  ADD_TYPE:  string;   // 'H' (home) | 'T' (term) | 'C' (correspondence)
  ADD_LIN1:  string;
  ADD_LIN2?: string;
  ADD_CITY?: string;
  ADD_PCOD?: string;
  ADD_COUN?: string;   // ISO country code
}

export interface SitsCoursejoin {
  SCJ_CODE:   string;   // course join identifier (enrolment ID)
  SCJ_SRS?:   string;   // programme/course reference (links to SitsProgVers.SPR_CODE)
  SCJ_STA1:   string;   // enrolment status code
  SCJ_AYOE:   string;   // academic year of entry e.g. '2024/25'
  SCJ_BEGC:   string;   // start date YYYY-MM-DD
  SCJ_ENDD?:  string;   // expected end date
  SCJ_ACTE?:  string;   // actual end date
  SCJ_MODE?:  string;   // mode of study: 'FT' | 'PT' | 'DL' | 'SW'
  SCJ_FUND?:  string;   // funding source code
  SCJ_SLCR?:  string;   // SLC reference
  results?:   SitsModuleResult[];
}

export interface SitsProgVers {
  SPR_CODE:   string;   // programme/course code
  SPR_TITL:   string;   // programme title
  SPR_QTYP?:  string;   // qualification type code
  SPR_FLVL?:  number;   // FHEQ level
  SPR_CRED?:  number;   // total credit value
  SPR_DURY?:  number;   // duration in years
  SPR_MODE?:  string;   // mode 'FT' | 'PT'
  SPR_SCHO?:  string;   // owning school
}

export interface SitsModuleVers {
  MAV_MCODE:  string;   // module code
  MAV_TITL:   string;   // module title
  MAV_CRED?:  number;   // credit value
  MAV_FLVL?:  number;   // FHEQ level
  MAV_YEAR:   string;   // academic year e.g. '2024/25'
  MAV_PERD?:  string;   // period code
  MAV_MODE?:  string;   // delivery mode
  MAV_CAPA?:  number;   // capacity
}

export interface SitsModuleResult {
  SMR_MCODE:  string;   // module code
  SMR_YEAR:   string;   // academic year
  SMR_PERD?:  string;   // period
  SMR_PERC?:  number;   // percentage mark 0–100
  SMR_CTYP?:  string;   // component type
  SMR_SDAT?:  string;   // submission date ISO
  SMR_SRCE?:  string;   // source system
  SMR_SREF?:  string;   // source reference
}

export interface SitsExport {
  exportedAt:  string;
  students:    SitsStudentRecord[];
  programmes?: SitsProgVers[];
  modules?:    SitsModuleVers[];
}

// ── Status code mappings ───────────────────────────────────────────────────
// These represent common SITS status conventions — institutional configurations vary.

const SITS_STATUS_MAP: Record<string, string> = {
  'A':  'enrolled',
  'T':  'intermitting',
  'S':  'suspended',
  'W':  'withdrawn',
  'G':  'graduated',
  'P':  'prospective',
  'FE': 'enrolled',
  'FT': 'enrolled',
};

const SITS_MODE_MAP: Record<string, string> = {
  'FT': 'full-time',
  'PT': 'part-time',
  'DL': 'distance',
  'SW': 'sandwich',
};

const SITS_ADDR_TYPE_MAP: Record<string, string> = {
  'H': 'home',
  'T': 'term',
  'C': 'correspondence',
};

// ── Academic year normalisation ────────────────────────────────────────────
// SITS uses '2024/25' format; SRS uses '2024-25'.
function normYear(raw: string): string {
  return raw.replace('/', '-');
}

// ── Mapper ────────────────────────────────────────────────────────────────

export function mapSitsToImportPayload(source: SitsExport): ImportPayload {
  const persons: ImportPerson[] = source.students.map((stu): ImportPerson => ({
    externalId:         stu.STU_CODE,
    studentNumber:      stu.STU_CODE,
    hesaId:             stu.STU_HESA,
    legalFirstName:     stu.STU_FNAM,
    legalFamilyName:    stu.STU_SURN,
    preferredName:      stu.STU_PNAM,
    dateOfBirth:        stu.STU_DOB,
    genderCode:         stu.STU_SEX,
    nationalityCode:    stu.STU_NATI,
    domicileCode:       stu.STU_DOMI,
    emailPersonal:      stu.STU_EMAI,
    emailInstitutional: stu.STU_EMLI,
    phoneMobile:        stu.STU_TEL1,
    addresses:          stu.addresses?.map((a): ImportAddress => ({
      addressTypeCode: SITS_ADDR_TYPE_MAP[a.ADD_TYPE] ?? 'home',
      line1:           a.ADD_LIN1,
      line2:           a.ADD_LIN2,
      city:            a.ADD_CITY,
      postcode:        a.ADD_PCOD,
      countryCode:     a.ADD_COUN,
    })),
  }));

  const programmes: ImportProgramme[] = (source.programmes ?? []).map((p): ImportProgramme => ({
    externalId:            p.SPR_CODE,
    code:                  p.SPR_CODE,
    title:                 p.SPR_TITL,
    qualificationTypeCode: p.SPR_QTYP,
    fheqLevel:             p.SPR_FLVL,
    creditTotal:           p.SPR_CRED,
    durationYears:         p.SPR_DURY,
    modeOfStudyCode:       p.SPR_MODE !== undefined ? (SITS_MODE_MAP[p.SPR_MODE] ?? p.SPR_MODE) : undefined,
    owningSchool:          p.SPR_SCHO,
  }));

  const modules: ImportModule[] = (source.modules ?? []).map((m): ImportModule => ({
    externalId:  m.MAV_MCODE,
    code:        m.MAV_MCODE,
    title:       m.MAV_TITL,
    creditValue: m.MAV_CRED,
    fheqLevel:   m.MAV_FLVL,
  }));

  // Derive module offerings: one offering per (module code, academic year, period) tuple.
  const offeringMap = new Map<string, ImportModuleOffering>();
  for (const m of source.modules ?? []) {
    const periodCode = m.MAV_PERD ?? 'year';
    const offeringKey = `${m.MAV_MCODE}::${normYear(m.MAV_YEAR)}::${periodCode}`;
    offeringMap.set(offeringKey, {
      externalId:         offeringKey,
      moduleExternalId:   m.MAV_MCODE,
      academicPeriodCode: `${normYear(m.MAV_YEAR)}:${periodCode}`,
      deliveryModeCode:   m.MAV_MODE ?? undefined,
      capacity:           m.MAV_CAPA,
    });
  }

  const enrolments: ImportEnrolment[] = [];
  const moduleRegistrations: ImportModuleRegistration[] = [];
  const marks: ImportMark[] = [];

  for (const stu of source.students) {
    for (const cj of stu.courses ?? []) {
      enrolments.push({
        externalId:           cj.SCJ_CODE,
        personExternalId:     stu.STU_CODE,
        programmeExternalId:  cj.SCJ_SRS,
        statusCode:           SITS_STATUS_MAP[cj.SCJ_STA1] ?? cj.SCJ_STA1,
        modeOfStudyCode:      cj.SCJ_MODE !== undefined
          ? (SITS_MODE_MAP[cj.SCJ_MODE] ?? 'full-time')
          : 'full-time',
        academicYearOfEntry:  normYear(cj.SCJ_AYOE),
        startDate:            cj.SCJ_BEGC,
        expectedEndDate:      cj.SCJ_ENDD,
        actualEndDate:        cj.SCJ_ACTE,
        fundingSourceCode:    cj.SCJ_FUND,
        slcReference:         cj.SCJ_SLCR,
      });

      for (const smr of cj.results ?? []) {
        const periodCode = smr.SMR_PERD ?? 'year';
        const offeringKey = `${smr.SMR_MCODE}::${normYear(smr.SMR_YEAR)}::${periodCode}`;
        const regId = `${cj.SCJ_CODE}::${offeringKey}`;

        if (!moduleRegistrations.find(r => r.externalId === regId)) {
          moduleRegistrations.push({
            externalId:               regId,
            personExternalId:         stu.STU_CODE,
            enrolmentExternalId:      cj.SCJ_CODE,
            moduleOfferingExternalId: offeringKey,
            statusCode:               'registered',
            registrationDate:         cj.SCJ_BEGC,
          });
        }

        if (smr.SMR_PERC !== undefined) {
          marks.push({
            moduleRegistrationExternalId: regId,
            componentTypeCode:            smr.SMR_CTYP ?? 'exam',
            rawMark:                      smr.SMR_PERC,
            submittedAt:                  smr.SMR_SDAT ?? cj.SCJ_BEGC,
            sourceSystem:                 smr.SMR_SRCE,
            sourceReference:              smr.SMR_SREF,
          });
        }
      }
    }
  }

  return {
    meta: {
      sourceSystem: 'sits-synthetic',
      exportedAt:   source.exportedAt,
      description:  'SITS-style synthetic import — see IP constraint notice in sits.ts',
    },
    persons,
    programmes,
    modules,
    moduleOfferings: Array.from(offeringMap.values()),
    enrolments,
    moduleRegistrations,
    marks,
  };
}
