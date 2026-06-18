import type { NewAcademicPeriod } from '@revelation-srs/db';

import { deterministicId } from './ids.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Term boundary dates (MM-DD).  UK HE standard 3-term calendar.
 * Override any boundary to substitute a 2-semester or custom calendar.
 */
export interface TermConfig {
  autumnStart: string;
  autumnEnd:   string;
  springStart: string;
  springEnd:   string;
  summerStart: string;
  summerEnd:   string;
}

export const DEFAULT_TERM_CONFIG: TermConfig = {
  autumnStart: '09-23',
  autumnEnd:   '12-20',
  springStart: '01-20',
  springEnd:   '04-11',
  summerStart: '04-28',
  summerEnd:   '06-27',
};

// ─── ID helper ────────────────────────────────────────────────────────────────

/** Stable ID for a given (tenant, academic year, term) combination. */
export function academicPeriodId(
  tenantId: string,
  academicYear: string,
  termCode: string,
): string {
  return deterministicId('academic-period', tenantId, academicYear, termCode);
}

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate the three academic periods (AUTUMN / SPRING / SUMMER) for a single
 * academic year string in `YYYY-YY` format (e.g. '2024-25').
 *
 * The `autumnStart`/`autumnEnd` dates use the _start_ calendar year; all
 * Spring and Summer dates use the _end_ calendar year.
 */
export function generateAcademicYear(
  tenantId: string,
  academicYear: string,
  config: TermConfig = DEFAULT_TERM_CONFIG,
): NewAcademicPeriod[] {
  const startYear = parseInt(academicYear.split('-')[0] ?? '2024', 10);
  const endYear   = startYear + 1;

  return [
    {
      id:             academicPeriodId(tenantId, academicYear, 'AUTUMN'),
      tenantId,
      academicYear,
      periodCode:     'AUTUMN',
      periodTypeCode: 'term',
      startDate:      `${startYear}-${config.autumnStart}`,
      endDate:        `${startYear}-${config.autumnEnd}`,
    },
    {
      id:             academicPeriodId(tenantId, academicYear, 'SPRING'),
      tenantId,
      academicYear,
      periodCode:     'SPRING',
      periodTypeCode: 'term',
      startDate:      `${endYear}-${config.springStart}`,
      endDate:        `${endYear}-${config.springEnd}`,
    },
    {
      id:             academicPeriodId(tenantId, academicYear, 'SUMMER'),
      tenantId,
      academicYear,
      periodCode:     'SUMMER',
      periodTypeCode: 'term',
      startDate:      `${endYear}-${config.summerStart}`,
      endDate:        `${endYear}-${config.summerEnd}`,
    },
  ];
}

/** Generate academic periods across multiple academic years. */
export function generateMultiYearCalendar(
  tenantId: string,
  academicYears: string[],
  config?: TermConfig,
): NewAcademicPeriod[] {
  return academicYears.flatMap(y => generateAcademicYear(tenantId, y, config));
}
