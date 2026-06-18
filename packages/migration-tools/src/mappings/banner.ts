/**
 * Banner-style synthetic mapping template.
 *
 * IP CONSTRAINT NOTICE
 * ════════════════════
 * This template is a SYNTHETIC EXAMPLE only. Field names and table conventions
 * are derived from publicly available Ellucian Banner documentation — specifically
 * the Ellucian Banner Student System Integration API Guide (publicly available)
 * and the Banner Technical Reference for the GENERAL module. No proprietary
 * schema structures, undocumented Banner internals, or vendor-confidential
 * information are reproduced here.
 *
 * This template demonstrates the MAPPING PATTERN and is NOT a certified
 * production connector for Ellucian Banner or any other Ellucian product.
 * Institutions must validate field mappings against their own Banner
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
} from '../contracts/index.js';

// ── Banner-style source types ──────────────────────────────────────────────
// These interfaces represent a synthetic Banner-style export format.
// Banner uses a PIDM (Person Identifier Master) as the internal person key.

export interface BannerPersonRecord {
  spriden_pidm:       number;   // PIDM — Banner's internal person identifier
  spriden_id:         string;   // institution-assigned student ID
  spriden_last_name:  string;
  spriden_first_name: string;
  spriden_mi?:        string;   // middle initial / middle name
  spbpers_birth_date?: string;  // YYYY-MM-DD
  spbpers_sex?:        string;  // 'M' | 'F'
  spbpers_natn_code?:  string;  // nationality code
  spbpers_pref_first_name?: string;  // preferred first name
  goremal_email_address?: string;    // institutional email
  personal_email?:    string;
  personal_phone?:    string;
  goradid_additional_id?: string;    // HESA Person Identifier or other external ID
  addresses?:         BannerAddress[];
  student_records?:   BannerStudentRecord[];
}

export interface BannerAddress {
  spraddr_atyp_code:  string;   // address type: 'MA' (mailing) | 'PR' (permanent) | 'BU' (billing)
  spraddr_street_line1: string;
  spraddr_street_line2?: string;
  spraddr_city?:      string;
  spraddr_zip?:       string;
  spraddr_natn_code?: string;
}

export interface BannerStudentRecord {
  sgbstdn_term_code_eff:  string;   // effective term code e.g. '202410'
  sgbstdn_levl_code:      string;   // level: 'UG' | 'PG' | 'FE'
  sgbstdn_styp_code?:     string;   // student type: 'F' (first-time) | 'T' (transfer) | 'R' (returning)
  sgbstdn_prog_code?:     string;   // programme code
  sgbstdn_clas_code?:     string;   // year-of-study class
  sgbstdn_resd_code?:     string;   // residency code
  sgbstdn_blck_code?:     string;   // block indicator (full-time/part-time)
  enrolment_status?:      string;   // derived status
  start_date?:            string;   // ISO date
  expected_grad_date?:    string;   // ISO date
  actual_end_date?:       string;   // ISO date
  funding_source?:        string;
  slc_ref?:               string;
  registrations?:         BannerCourseRegistration[];
}

export interface BannerProgramRecord {
  smrprle_program:        string;   // programme code
  smrprle_program_desc:   string;
  smrprle_levl_code?:     string;
  smrprle_cipc_code?:     string;
  duration_years?:        number;
  credit_hours?:          number;
  owning_college?:        string;
}

export interface BannerCourseRecord {
  ssbsect_crn:            string;   // course reference number
  ssbsect_subj_code:      string;   // subject code
  ssbsect_crse_numb:      string;   // course number
  scbcrse_title:          string;   // course title
  scbcrse_credit_hr_high?: number;
  ssbsect_term_code:      string;   // term code
  ssbsect_ssts_code?:     string;   // section status
  ssbsect_schd_code?:     string;   // schedule type (delivery mode)
  ssbsect_max_enrl?:      number;   // max enrolment
}

export interface BannerCourseRegistration {
  sfrstcr_crn:             string;   // links to BannerCourseRecord.ssbsect_crn
  sfrstcr_term_code:       string;
  sfrstcr_rsts_code:       string;   // registration status: 'RE' | 'DD' | 'WW'
  sfrstcr_reg_date?:       string;   // ISO date
  shrtran_grde_code_final?: string;  // final grade code
  shrtran_credit_hours?:    number;
  mark_percentage?:         number;  // derived 0–100 mark
  mark_submitted_at?:       string;  // ISO datetime
}

export interface BannerExport {
  exportedAt:   string;
  persons:      BannerPersonRecord[];
  programmes?:  BannerProgramRecord[];
  courses?:     BannerCourseRecord[];
}

// ── Status code mappings ───────────────────────────────────────────────────

const BANNER_RSTS_MAP: Record<string, string> = {
  'RE': 'registered',
  'DD': 'withdrawn',
  'WW': 'withdrawn',
  'AU': 'registered',
};

const BANNER_ADDR_TYPE_MAP: Record<string, string> = {
  'MA': 'home',
  'PR': 'home',
  'BU': 'correspondence',
  'TE': 'term',
};

const BANNER_BLCK_MAP: Record<string, string> = {
  'F': 'full-time',
  'P': 'part-time',
  'H': 'part-time',
  'D': 'distance',
};

// ── Term code to academic year ─────────────────────────────────────────────
// Banner uses 6-digit term codes: YYYYTT where TT is 10=autumn, 20=spring, 30=summer.
// Maps to SRS academic year format 'YYYY-YY'.
function termCodeToAcademicYear(termCode: string): string {
  const year = parseInt(termCode.slice(0, 4), 10);
  const term = parseInt(termCode.slice(4), 10);
  if (term >= 10 && term < 20) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

function termCodeToAcademicPeriodCode(termCode: string): string {
  const term = parseInt(termCode.slice(4), 10);
  const year = termCodeToAcademicYear(termCode);
  if (term === 10) return `${year}:sem1`;
  if (term === 20) return `${year}:sem2`;
  return `${year}:year`;
}

// ── Mapper ────────────────────────────────────────────────────────────────

export function mapBannerToImportPayload(source: BannerExport): ImportPayload {
  const persons: ImportPerson[] = source.persons.map((p): ImportPerson => ({
    externalId:        String(p.spriden_pidm),
    studentNumber:     p.spriden_id,
    hesaId:            p.goradid_additional_id,
    legalFirstName:    p.spriden_first_name,
    legalFamilyName:   p.spriden_last_name,
    preferredName:     p.spbpers_pref_first_name,
    dateOfBirth:       p.spbpers_birth_date,
    genderCode:        p.spbpers_sex,
    nationalityCode:   p.spbpers_natn_code,
    emailInstitutional: p.goremal_email_address,
    emailPersonal:     p.personal_email,
    phoneMobile:       p.personal_phone,
    addresses:         p.addresses?.map((a): ImportAddress => ({
      addressTypeCode: BANNER_ADDR_TYPE_MAP[a.spraddr_atyp_code] ?? 'home',
      line1:           a.spraddr_street_line1,
      line2:           a.spraddr_street_line2,
      city:            a.spraddr_city,
      postcode:        a.spraddr_zip,
      countryCode:     a.spraddr_natn_code,
    })),
  }));

  const programmes: ImportProgramme[] = (source.programmes ?? []).map((p): ImportProgramme => ({
    externalId:   p.smrprle_program,
    code:         p.smrprle_program,
    title:        p.smrprle_program_desc,
    fheqLevel:    p.smrprle_levl_code === 'PG' ? 7 : 6,
    creditTotal:  p.credit_hours,
    durationYears: p.duration_years,
    owningSchool: p.owning_college,
  }));

  // Derive modules from course records
  const modules: ImportModule[] = [];
  const moduleMap = new Map<string, boolean>();
  for (const c of source.courses ?? []) {
    const modCode = `${c.ssbsect_subj_code}${c.ssbsect_crse_numb}`;
    if (!moduleMap.has(modCode)) {
      moduleMap.set(modCode, true);
      modules.push({
        externalId:  modCode,
        code:        modCode,
        title:       c.scbcrse_title,
        creditValue: c.scbcrse_credit_hr_high,
      });
    }
  }

  // Module offerings — one per (CRN, term)
  const moduleOfferings: ImportModuleOffering[] = (source.courses ?? []).map((c): ImportModuleOffering => ({
    externalId:         c.ssbsect_crn,
    moduleExternalId:   `${c.ssbsect_subj_code}${c.ssbsect_crse_numb}`,
    academicPeriodCode: termCodeToAcademicPeriodCode(c.ssbsect_term_code),
    deliveryModeCode:   c.ssbsect_schd_code === 'OL' ? 'online' : undefined,
    capacity:           c.ssbsect_max_enrl,
  }));

  const enrolments: ImportEnrolment[] = [];
  const moduleRegistrations: ImportModuleRegistration[] = [];
  const marks: ImportMark[] = [];

  for (const person of source.persons) {
    for (const sr of person.student_records ?? []) {
      const enrolmentExternalId = `${person.spriden_pidm}::${sr.sgbstdn_term_code_eff}`;

      enrolments.push({
        externalId:          enrolmentExternalId,
        personExternalId:    String(person.spriden_pidm),
        programmeExternalId: sr.sgbstdn_prog_code,
        statusCode:          sr.enrolment_status ?? 'enrolled',
        modeOfStudyCode:     sr.sgbstdn_blck_code !== undefined
          ? (BANNER_BLCK_MAP[sr.sgbstdn_blck_code] ?? 'full-time')
          : 'full-time',
        academicYearOfEntry: termCodeToAcademicYear(sr.sgbstdn_term_code_eff),
        startDate:           sr.start_date ?? `${sr.sgbstdn_term_code_eff.slice(0, 4)}-09-01`,
        expectedEndDate:     sr.expected_grad_date,
        actualEndDate:       sr.actual_end_date,
        fundingSourceCode:   sr.funding_source,
        slcReference:        sr.slc_ref,
      });

      for (const reg of sr.registrations ?? []) {
        const regId = `${person.spriden_pidm}::${reg.sfrstcr_crn}::${reg.sfrstcr_term_code}`;
        moduleRegistrations.push({
          externalId:               regId,
          personExternalId:         String(person.spriden_pidm),
          enrolmentExternalId,
          moduleOfferingExternalId: reg.sfrstcr_crn,
          statusCode:               BANNER_RSTS_MAP[reg.sfrstcr_rsts_code] ?? 'registered',
          registrationDate:         reg.sfrstcr_reg_date
            ?? `${reg.sfrstcr_term_code.slice(0, 4)}-09-01`,
        });

        if (reg.mark_percentage !== undefined) {
          marks.push({
            moduleRegistrationExternalId: regId,
            componentTypeCode:            'exam',
            rawMark:                      reg.mark_percentage,
            submittedAt:                  reg.mark_submitted_at ?? new Date().toISOString(),
            sourceSystem:                 'banner',
            sourceReference:              reg.sfrstcr_crn,
          });
        }
      }
    }
  }

  return {
    meta: {
      sourceSystem: 'banner-synthetic',
      exportedAt:   source.exportedAt,
      description:  'Banner-style synthetic import — see IP constraint notice in banner.ts',
    },
    persons,
    programmes,
    modules,
    moduleOfferings,
    enrolments,
    moduleRegistrations,
    marks,
  };
}
