import type {
  NewAwardingBody,
  NewModule,
  NewModuleOffering,
  NewProgramme,
} from '@revelation-srs/db';

import { academicPeriodId } from './calendar.js';
import { deterministicId } from './ids.js';

// ─── Compact source definitions ───────────────────────────────────────────────

interface ProgrammeDef {
  code:    string;
  title:   string;
  qual:    string;   // qualification code, e.g. 'BSc'
  level:   number;   // FHEQ level (6 = UG honours, 7 = PG)
  years:   number;   // nominal duration
  credits: number;   // total credit award
  school:  string;   // owning school (free text, matches module school)
  mode:    string;   // mode of study
}

export interface ModuleDef {
  code:    string;
  title:   string;
  level:   number;   // FHEQ level
  credits: number;
  school:  string;
  terms:   ReadonlyArray<'AUTUMN' | 'SPRING' | 'SUMMER'>;
}

// ─── Baseline programme catalogue ─────────────────────────────────────────────

export const BASELINE_PROGRAMMES: readonly ProgrammeDef[] = [
  // Undergraduate — Computer Science
  { code: 'BSCS',   title: 'DEMO - BSc Computer Science',           qual: 'BSc',  level: 6, years: 3, credits: 360, school: 'School of Computer Science', mode: 'full-time' },
  { code: 'MENGCS', title: 'DEMO - MEng Computer Science',          qual: 'MEng', level: 7, years: 4, credits: 480, school: 'School of Computer Science', mode: 'full-time' },
  // Undergraduate — Mathematics and Physics
  { code: 'BSMATH', title: 'DEMO - BSc Mathematics',                qual: 'BSc',  level: 6, years: 3, credits: 360, school: 'School of Mathematics',       mode: 'full-time' },
  { code: 'BSPHYS', title: 'DEMO - BSc Physics',                    qual: 'BSc',  level: 6, years: 3, credits: 360, school: 'School of Physics',           mode: 'full-time' },
  // Undergraduate — Arts and Humanities
  { code: 'BAENGL', title: 'DEMO - BA English Literature',          qual: 'BA',   level: 6, years: 3, credits: 360, school: 'School of English',           mode: 'full-time' },
  { code: 'BAHIST', title: 'DEMO - BA History',                     qual: 'BA',   level: 6, years: 3, credits: 360, school: 'School of History',           mode: 'full-time' },
  // Undergraduate — Social Sciences
  { code: 'BSECON', title: 'DEMO - BSc Economics',                  qual: 'BSc',  level: 6, years: 3, credits: 360, school: 'School of Economics',         mode: 'full-time' },
  { code: 'BSPSYC', title: 'DEMO - BSc Psychology',                 qual: 'BSc',  level: 6, years: 3, credits: 360, school: 'School of Psychology',        mode: 'full-time' },
  { code: 'LLBLAW', title: 'DEMO - LLB Law',                        qual: 'LLB',  level: 6, years: 3, credits: 360, school: 'School of Law',               mode: 'full-time' },
  // Postgraduate taught
  { code: 'MSCDS',  title: 'DEMO - MSc Data Science',              qual: 'MSc',  level: 7, years: 1, credits: 180, school: 'School of Computer Science',  mode: 'full-time' },
  { code: 'MSCFIN', title: 'DEMO - MSc Finance',                    qual: 'MSc',  level: 7, years: 1, credits: 180, school: 'School of Economics',         mode: 'full-time' },
];

// ─── Baseline module catalogue ─────────────────────────────────────────────────

export const BASELINE_MODULES: readonly ModuleDef[] = [
  // Computer Science — Level 4 (Year 1 UG)
  { code: 'CS101', title: 'DEMO - Introduction to Programming',       level: 4, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  { code: 'CS102', title: 'DEMO - Data Structures and Algorithms',    level: 4, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  { code: 'CS103', title: 'DEMO - Computer Systems',                  level: 4, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  { code: 'CS104', title: 'DEMO - Discrete Mathematics',              level: 4, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  // Computer Science — Level 5 (Year 2 UG)
  { code: 'CS201', title: 'DEMO - Software Engineering',              level: 5, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  { code: 'CS202', title: 'DEMO - Database Systems',                  level: 5, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  { code: 'CS203', title: 'DEMO - Networks and Security',             level: 5, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  { code: 'CS204', title: 'DEMO - Operating Systems',                 level: 5, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  // Computer Science — Level 6 (Year 3 UG)
  { code: 'CS301', title: 'DEMO - Machine Learning',                  level: 6, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  { code: 'CS302', title: 'DEMO - Distributed Systems',               level: 6, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  { code: 'CS303', title: 'DEMO - Individual Project',                level: 6, credits: 40, school: 'School of Computer Science', terms: ['AUTUMN', 'SPRING', 'SUMMER'] },
  // Computer Science — Level 7 (PG)
  { code: 'CS701', title: 'DEMO - Advanced Algorithms',               level: 7, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  { code: 'CS702', title: 'DEMO - Big Data and Cloud Computing',      level: 7, credits: 20, school: 'School of Computer Science', terms: ['SPRING'] },
  { code: 'CS703', title: 'DEMO - Research Methods',                  level: 7, credits: 20, school: 'School of Computer Science', terms: ['AUTUMN'] },
  // Mathematics — Level 4-6
  { code: 'MA101', title: 'DEMO - Calculus',                          level: 4, credits: 20, school: 'School of Mathematics',       terms: ['AUTUMN'] },
  { code: 'MA102', title: 'DEMO - Linear Algebra',                    level: 4, credits: 20, school: 'School of Mathematics',       terms: ['SPRING'] },
  { code: 'MA201', title: 'DEMO - Real Analysis',                     level: 5, credits: 20, school: 'School of Mathematics',       terms: ['AUTUMN'] },
  { code: 'MA202', title: 'DEMO - Statistics',                        level: 5, credits: 20, school: 'School of Mathematics',       terms: ['SPRING'] },
  { code: 'MA301', title: 'DEMO - Differential Equations',            level: 6, credits: 20, school: 'School of Mathematics',       terms: ['AUTUMN'] },
  // Physics — Level 4-6
  { code: 'PH101', title: 'DEMO - Classical Mechanics',               level: 4, credits: 20, school: 'School of Physics',           terms: ['AUTUMN'] },
  { code: 'PH102', title: 'DEMO - Electricity and Magnetism',         level: 4, credits: 20, school: 'School of Physics',           terms: ['SPRING'] },
  { code: 'PH201', title: 'DEMO - Quantum Mechanics',                 level: 5, credits: 20, school: 'School of Physics',           terms: ['AUTUMN'] },
  { code: 'PH301', title: 'DEMO - Particle Physics',                  level: 6, credits: 20, school: 'School of Physics',           terms: ['SPRING'] },
  // English — Level 4-6
  { code: 'EN101', title: 'DEMO - Introduction to Literary Studies',  level: 4, credits: 20, school: 'School of English',           terms: ['AUTUMN'] },
  { code: 'EN102', title: 'DEMO - Writing and Rhetoric',              level: 4, credits: 20, school: 'School of English',           terms: ['SPRING'] },
  { code: 'EN201', title: 'DEMO - Victorian Literature',              level: 5, credits: 20, school: 'School of English',           terms: ['SPRING'] },
  { code: 'EN301', title: 'DEMO - Dissertation',                      level: 6, credits: 40, school: 'School of English',           terms: ['AUTUMN', 'SPRING'] },
  // History — Level 4-6
  { code: 'HI101', title: 'DEMO - Introduction to History',          level: 4, credits: 20, school: 'School of History',           terms: ['AUTUMN'] },
  { code: 'HI201', title: 'DEMO - Medieval Europe',                   level: 5, credits: 20, school: 'School of History',           terms: ['AUTUMN'] },
  // Economics — Level 4-6
  { code: 'EC101', title: 'DEMO - Microeconomics',                    level: 4, credits: 20, school: 'School of Economics',         terms: ['AUTUMN'] },
  { code: 'EC102', title: 'DEMO - Macroeconomics',                    level: 4, credits: 20, school: 'School of Economics',         terms: ['SPRING'] },
  { code: 'EC201', title: 'DEMO - Econometrics',                      level: 5, credits: 20, school: 'School of Economics',         terms: ['SPRING'] },
  { code: 'EC301', title: 'DEMO - International Trade',               level: 6, credits: 20, school: 'School of Economics',         terms: ['AUTUMN'] },
  // Psychology — Level 4-6
  { code: 'PS101', title: 'DEMO - Introduction to Psychology',        level: 4, credits: 20, school: 'School of Psychology',        terms: ['AUTUMN'] },
  { code: 'PS201', title: 'DEMO - Cognitive Psychology',              level: 5, credits: 20, school: 'School of Psychology',        terms: ['SPRING'] },
  { code: 'PS301', title: 'DEMO - Clinical Psychology',               level: 6, credits: 20, school: 'School of Psychology',        terms: ['AUTUMN'] },
  // Law — Level 4-6
  { code: 'LW101', title: 'DEMO - English Legal System',              level: 4, credits: 20, school: 'School of Law',               terms: ['AUTUMN'] },
  { code: 'LW102', title: 'DEMO - Contract Law',                      level: 4, credits: 20, school: 'School of Law',               terms: ['SPRING'] },
  { code: 'LW201', title: 'DEMO - Criminal Law',                      level: 5, credits: 20, school: 'School of Law',               terms: ['AUTUMN'] },
  { code: 'LW301', title: 'DEMO - Public Law',                        level: 6, credits: 20, school: 'School of Law',               terms: ['SPRING'] },
];

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function awardingBodyId(tenantId: string): string {
  return deterministicId('awarding-body', tenantId);
}

export function programmeId(tenantId: string, programmeCode: string): string {
  return deterministicId('programme', tenantId, programmeCode);
}

export function moduleId(tenantId: string, moduleCode: string): string {
  return deterministicId('module', tenantId, moduleCode);
}

export function moduleOfferingId(
  tenantId: string,
  moduleCode: string,
  academicYear: string,
  termCode: string,
): string {
  return deterministicId('module-offering', tenantId, moduleCode, academicYear, termCode);
}

// ─── Generator ────────────────────────────────────────────────────────────────

export interface CurriculumData {
  awardingBodies:  NewAwardingBody[];
  programmes:      NewProgramme[];
  modules:         NewModule[];
  moduleOfferings: NewModuleOffering[];
}

/**
 * Generate the full baseline curriculum for the given academic years.
 *
 * All IDs are deterministic: rerunning with the same inputs produces the
 * same UUIDs.  Module offerings are created for each (module, year, term)
 * combination using the academic period IDs from the calendar generator.
 */
export function generateCurriculum(
  tenantId: string,
  academicYears: string[],
  programmeDefs: readonly ProgrammeDef[] = BASELINE_PROGRAMMES,
  moduleDefs:    readonly ModuleDef[]    = BASELINE_MODULES,
): CurriculumData {
  const validFrom = new Date('2020-08-01T00:00:00Z');

  const awardingBodies: NewAwardingBody[] = [
    {
      id:       awardingBodyId(tenantId),
      tenantId,
      code:     'DEMO-UNI',
      name:     'DEMO - Demo University',
      active:   true,
    },
  ];

  const awBodyId = awardingBodyId(tenantId);

  const programmes: NewProgramme[] = programmeDefs.map(p => ({
    id:                   programmeId(tenantId, p.code),
    tenantId,
    validFrom,
    recordedAt:           validFrom,
    code:                 p.code,
    title:                p.title,
    qualificationTypeCode: p.qual,
    fheqLevel:            p.level,
    durationYears:        p.years,
    creditTotal:          p.credits,
    creditFrameworkCode:  'cats',
    modeOfStudyCode:      p.mode,
    owningSchool:         p.school,
    awardingBodyId:       awBodyId,
  }));

  const modules: NewModule[] = moduleDefs.map(m => ({
    id:          moduleId(tenantId, m.code),
    tenantId,
    validFrom,
    recordedAt:  validFrom,
    code:        m.code,
    title:       m.title,
    fheqLevel:   m.level,
    creditValue: m.credits,
  }));

  const moduleOfferings: NewModuleOffering[] = moduleDefs.flatMap(m =>
    academicYears.flatMap(year =>
      m.terms.map(term => ({
        id:               moduleOfferingId(tenantId, m.code, year, term),
        tenantId,
        moduleId:         moduleId(tenantId, m.code),
        academicPeriodId: academicPeriodId(tenantId, year, term),
        deliveryModeCode: 'in-person',
        capacity:         30,
      })),
    ),
  );

  return { awardingBodies, programmes, modules, moduleOfferings };
}
