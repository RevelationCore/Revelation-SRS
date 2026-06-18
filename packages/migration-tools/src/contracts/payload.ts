/**
 * Top-level import payload — the full migration bundle passed to the importer.
 *
 * All arrays are optional; omitting an array skips that phase entirely.
 * The import is phase-ordered: identity → catalogue → enrolments →
 * registrations → assessment → adjustments.
 */

import type { ImportPerson, ImportAddress } from './identity.js';
import type { ImportEnrolment } from './enrolment.js';
import type { ImportProgramme, ImportModule, ImportModuleOffering } from './catalogue.js';
import type { ImportModuleRegistration, ImportMark } from './registration.js';
import type { ImportAward } from './award.js';
import type { ImportAdjustment, ImportExceptionalCircumstance } from './adjustment.js';

export type {
  ImportPerson, ImportAddress,
  ImportEnrolment,
  ImportProgramme, ImportModule, ImportModuleOffering,
  ImportModuleRegistration, ImportMark,
  ImportAward,
  ImportAdjustment, ImportExceptionalCircumstance,
};

export interface ImportPayload {
  /** Metadata about the import batch — used in the validation report. */
  meta: {
    sourceSystem:  string;   // e.g. 'sits-synthetic' | 'banner-synthetic' | 'manual'
    exportedAt?:   string;   // ISO datetime the source system exported this data
    description?:  string;
  };

  // ── Phase 1: Identity ──────────────────────────────────────────────────────
  persons:               ImportPerson[];

  // ── Phase 2: Catalogue ────────────────────────────────────────────────────
  programmes?:           ImportProgramme[];
  modules?:              ImportModule[];
  moduleOfferings?:      ImportModuleOffering[];

  // ── Phase 3: Enrolments ───────────────────────────────────────────────────
  enrolments?:           ImportEnrolment[];

  // ── Phase 4: Registrations ────────────────────────────────────────────────
  moduleRegistrations?:  ImportModuleRegistration[];

  // ── Phase 5: Assessment ───────────────────────────────────────────────────
  marks?:                ImportMark[];
  awards?:               ImportAward[];

  // ── Phase 6: Adjustments ─────────────────────────────────────────────────
  adjustments?:          ImportAdjustment[];
  exceptionalCircumstances?: ImportExceptionalCircumstance[];
}
