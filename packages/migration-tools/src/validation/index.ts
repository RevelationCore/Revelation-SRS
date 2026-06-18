import type { ImportPayload } from '../contracts/payload.js';
import type { ValidationIssue, ValidationReport, RecordCounts, IssueSeverity } from './types.js';

// ── Known valid value sets ────────────────────────────────────────────────
// These are the standard codes the SRS accepts. Unknown codes produce a warning
// rather than an error — institutions may extend these via the value-set admin.

const KNOWN_STATUSES    = new Set(['enrolled', 'intermitting', 'suspended', 'withdrawn', 'graduated', 'prospective', 'pending']);
const KNOWN_MODES       = new Set(['full-time', 'part-time', 'distance', 'sandwich']);
const KNOWN_ADDR_TYPES  = new Set(['home', 'term', 'correspondence']);
const KNOWN_ADJ_TYPES   = new Set(['extra-time', 'separate-room', 'deadline-extension', 'reader', 'scribe', 'rest-breaks']);
const KNOWN_ADJ_SCOPES  = new Set(['all', 'exam', 'coursework', 'attendance']);
const KNOWN_COMP_TYPES  = new Set(['exam', 'coursework', 'practical', 'portfolio', 'presentation']);
const KNOWN_REG_STATUSES = new Set(['registered', 'withdrawn', 'completed']);

// ── HESA ethnicity codes that are special-category ────────────────────────
// Any non-null ethnicityCode is special-category personal data.

function issue(
  severity: IssueSeverity,
  code: ValidationIssue['code'],
  entity: string,
  message: string,
  opts?: { externalId?: string; field?: string },
): ValidationIssue {
  return { code, severity, entity, message, ...opts };
}

export function validatePayload(
  payload: ImportPayload,
  tenantId: string,
  dryRun:   boolean,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const counts: RecordCounts[] = [];

  const personIds = new Set<string>();
  const programmeIds = new Set<string>();
  const moduleIds = new Set<string>();
  const offeringIds = new Set<string>();
  const enrolmentIds = new Set<string>();
  const regIds = new Set<string>();

  // ── Phase 1: persons ──────────────────────────────────────────────────────

  counts.push({ entity: 'person', source: payload.persons.length, loaded: 0, failed: 0 });

  for (const p of payload.persons) {
    if (!p.externalId) {
      issues.push(issue('error', 'MISSING_REQUIRED_FIELD', 'person', 'externalId is required'));
      continue;
    }
    if (personIds.has(p.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'person',
        `Duplicate person externalId: ${p.externalId}`, { externalId: p.externalId }));
    }
    personIds.add(p.externalId);

    if (!p.legalFirstName) {
      issues.push(issue('error', 'MISSING_REQUIRED_FIELD', 'person',
        'legalFirstName is required', { externalId: p.externalId, field: 'legalFirstName' }));
    }
    if (!p.legalFamilyName) {
      issues.push(issue('error', 'MISSING_REQUIRED_FIELD', 'person',
        'legalFamilyName is required', { externalId: p.externalId, field: 'legalFamilyName' }));
    }

    if (p.ethnicityCode !== undefined && p.ethnicityCode !== null) {
      issues.push(issue('warning', 'SPECIAL_CATEGORY_DATA', 'person',
        `Person ${p.externalId} includes ethnicityCode — this is special-category data under UK GDPR Article 9. Confirm lawful basis before importing.`,
        { externalId: p.externalId, field: 'ethnicityCode' }));
    }

    for (const addr of p.addresses ?? []) {
      if (!KNOWN_ADDR_TYPES.has(addr.addressTypeCode)) {
        issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'address',
          `Unknown addressTypeCode '${addr.addressTypeCode}' for person ${p.externalId}`,
          { externalId: p.externalId, field: 'addressTypeCode' }));
      }
    }
  }

  // ── Phase 2: catalogue ────────────────────────────────────────────────────

  counts.push({ entity: 'programme', source: payload.programmes?.length ?? 0, loaded: 0, failed: 0 });
  for (const prog of payload.programmes ?? []) {
    if (programmeIds.has(prog.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'programme',
        `Duplicate programme externalId: ${prog.externalId}`, { externalId: prog.externalId }));
    }
    programmeIds.add(prog.externalId);
    if (!prog.code || !prog.title) {
      issues.push(issue('error', 'MISSING_REQUIRED_FIELD', 'programme',
        'code and title are required', { externalId: prog.externalId }));
    }
    if (prog.fheqLevel !== undefined && (prog.fheqLevel < 4 || prog.fheqLevel > 8)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'programme',
        `fheqLevel ${prog.fheqLevel} is outside the expected range 4–8`,
        { externalId: prog.externalId, field: 'fheqLevel' }));
    }
  }

  counts.push({ entity: 'module', source: payload.modules?.length ?? 0, loaded: 0, failed: 0 });
  for (const mod of payload.modules ?? []) {
    if (moduleIds.has(mod.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'module',
        `Duplicate module externalId: ${mod.externalId}`, { externalId: mod.externalId }));
    }
    moduleIds.add(mod.externalId);
  }

  counts.push({ entity: 'moduleOffering', source: payload.moduleOfferings?.length ?? 0, loaded: 0, failed: 0 });
  for (const off of payload.moduleOfferings ?? []) {
    if (offeringIds.has(off.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'moduleOffering',
        `Duplicate moduleOffering externalId: ${off.externalId}`, { externalId: off.externalId }));
    }
    offeringIds.add(off.externalId);
    if (!moduleIds.has(off.moduleExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'moduleOffering',
        `moduleOffering ${off.externalId} references unknown module ${off.moduleExternalId}`,
        { externalId: off.externalId, field: 'moduleExternalId' }));
    }
  }

  // ── Phase 3: enrolments ───────────────────────────────────────────────────

  counts.push({ entity: 'enrolment', source: payload.enrolments?.length ?? 0, loaded: 0, failed: 0 });
  for (const enr of payload.enrolments ?? []) {
    if (enrolmentIds.has(enr.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'enrolment',
        `Duplicate enrolment externalId: ${enr.externalId}`, { externalId: enr.externalId }));
    }
    enrolmentIds.add(enr.externalId);

    if (!personIds.has(enr.personExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'enrolment',
        `Enrolment ${enr.externalId} references unknown person ${enr.personExternalId}`,
        { externalId: enr.externalId, field: 'personExternalId' }));
    }
    if (enr.programmeExternalId !== undefined && !programmeIds.has(enr.programmeExternalId)) {
      issues.push(issue('warning', 'UNRESOLVED_REFERENCE', 'enrolment',
        `Enrolment ${enr.externalId} references unknown programme ${enr.programmeExternalId}`,
        { externalId: enr.externalId, field: 'programmeExternalId' }));
    }
    if (!KNOWN_STATUSES.has(enr.statusCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'enrolment',
        `Unknown statusCode '${enr.statusCode}' for enrolment ${enr.externalId}`,
        { externalId: enr.externalId, field: 'statusCode' }));
    }
    if (!KNOWN_MODES.has(enr.modeOfStudyCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'enrolment',
        `Unknown modeOfStudyCode '${enr.modeOfStudyCode}' for enrolment ${enr.externalId}`,
        { externalId: enr.externalId, field: 'modeOfStudyCode' }));
    }
    if (!enr.academicYearOfEntry.match(/^\d{4}-\d{2}$/)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'enrolment',
        `academicYearOfEntry '${enr.academicYearOfEntry}' should match YYYY-YY format`,
        { externalId: enr.externalId, field: 'academicYearOfEntry' }));
    }

    // Bitemporal: startDate must precede expectedEndDate / actualEndDate
    if (enr.expectedEndDate && enr.startDate && enr.expectedEndDate <= enr.startDate) {
      issues.push(issue('error', 'BITEMPORAL_INVALID_WINDOW', 'enrolment',
        `Enrolment ${enr.externalId}: expectedEndDate must be after startDate`,
        { externalId: enr.externalId }));
    }
  }

  // ── Phase 4: module registrations ─────────────────────────────────────────

  counts.push({ entity: 'moduleRegistration', source: payload.moduleRegistrations?.length ?? 0, loaded: 0, failed: 0 });
  for (const reg of payload.moduleRegistrations ?? []) {
    if (regIds.has(reg.externalId)) {
      issues.push(issue('error', 'DUPLICATE_EXTERNAL_ID', 'moduleRegistration',
        `Duplicate moduleRegistration externalId: ${reg.externalId}`, { externalId: reg.externalId }));
    }
    regIds.add(reg.externalId);

    if (!personIds.has(reg.personExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'moduleRegistration',
        `Registration ${reg.externalId} references unknown person ${reg.personExternalId}`,
        { externalId: reg.externalId, field: 'personExternalId' }));
    }
    if (!enrolmentIds.has(reg.enrolmentExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'moduleRegistration',
        `Registration ${reg.externalId} references unknown enrolment ${reg.enrolmentExternalId}`,
        { externalId: reg.externalId, field: 'enrolmentExternalId' }));
    }
    if (!offeringIds.has(reg.moduleOfferingExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'moduleRegistration',
        `Registration ${reg.externalId} references unknown moduleOffering ${reg.moduleOfferingExternalId}`,
        { externalId: reg.externalId, field: 'moduleOfferingExternalId' }));
    }
    if (!KNOWN_REG_STATUSES.has(reg.statusCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'moduleRegistration',
        `Unknown statusCode '${reg.statusCode}' for registration ${reg.externalId}`,
        { externalId: reg.externalId, field: 'statusCode' }));
    }
  }

  // ── Phase 5: marks ────────────────────────────────────────────────────────

  counts.push({ entity: 'mark', source: payload.marks?.length ?? 0, loaded: 0, failed: 0 });
  for (const mark of payload.marks ?? []) {
    if (!regIds.has(mark.moduleRegistrationExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'mark',
        `Mark references unknown moduleRegistration ${mark.moduleRegistrationExternalId}`,
        { field: 'moduleRegistrationExternalId' }));
    }
    if (!KNOWN_COMP_TYPES.has(mark.componentTypeCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'mark',
        `Unknown componentTypeCode '${mark.componentTypeCode}'`,
        { field: 'componentTypeCode' }));
    }
    if (mark.rawMark < 0 || mark.rawMark > 100) {
      issues.push(issue('error', 'BITEMPORAL_INVALID_WINDOW', 'mark',
        `rawMark ${mark.rawMark} is outside 0–100`,
        { field: 'rawMark' }));
    }
  }

  // ── Phase 5: awards ───────────────────────────────────────────────────────

  counts.push({ entity: 'award', source: payload.awards?.length ?? 0, loaded: 0, failed: 0 });
  for (const award of payload.awards ?? []) {
    if (!personIds.has(award.personExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'award',
        `Award ${award.externalId} references unknown person ${award.personExternalId}`,
        { externalId: award.externalId }));
    }
    if (!enrolmentIds.has(award.enrolmentExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'award',
        `Award ${award.externalId} references unknown enrolment ${award.enrolmentExternalId}`,
        { externalId: award.externalId }));
    }
  }

  // ── Phase 6: adjustments ─────────────────────────────────────────────────

  counts.push({ entity: 'adjustment', source: payload.adjustments?.length ?? 0, loaded: 0, failed: 0 });
  for (const adj of payload.adjustments ?? []) {
    if (!personIds.has(adj.personExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'adjustment',
        `Adjustment ${adj.externalId} references unknown person ${adj.personExternalId}`,
        { externalId: adj.externalId }));
    }
    if (!enrolmentIds.has(adj.enrolmentExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'adjustment',
        `Adjustment ${adj.externalId} references unknown enrolment ${adj.enrolmentExternalId}`,
        { externalId: adj.externalId }));
    }
    if (!KNOWN_ADJ_TYPES.has(adj.adjustmentTypeCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'adjustment',
        `Unknown adjustmentTypeCode '${adj.adjustmentTypeCode}' for adjustment ${adj.externalId}`,
        { externalId: adj.externalId, field: 'adjustmentTypeCode' }));
    }
    if (!KNOWN_ADJ_SCOPES.has(adj.scopeCode)) {
      issues.push(issue('warning', 'VALUE_SET_MAPPING_FAILURE', 'adjustment',
        `Unknown scopeCode '${adj.scopeCode}' for adjustment ${adj.externalId}`,
        { externalId: adj.externalId, field: 'scopeCode' }));
    }

    // Bitemporal window check
    if (adj.validTo !== undefined && adj.validTo <= adj.validFrom) {
      issues.push(issue('error', 'BITEMPORAL_INVALID_WINDOW', 'adjustment',
        `Adjustment ${adj.externalId}: validTo must be after validFrom`,
        { externalId: adj.externalId }));
    }

    // Adjustments contain disability-related data — special category warning
    issues.push(issue('info', 'SPECIAL_CATEGORY_DATA', 'adjustment',
      `Adjustment ${adj.externalId} may contain disability accommodation data — confirm lawful basis for transfer under UK GDPR Article 9.`,
      { externalId: adj.externalId }));
  }

  counts.push({ entity: 'exceptionalCircumstance', source: payload.exceptionalCircumstances?.length ?? 0, loaded: 0, failed: 0 });
  for (const ec of payload.exceptionalCircumstances ?? []) {
    if (!personIds.has(ec.personExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'exceptionalCircumstance',
        `EC ${ec.externalId} references unknown person ${ec.personExternalId}`,
        { externalId: ec.externalId }));
    }
    if (!enrolmentIds.has(ec.enrolmentExternalId)) {
      issues.push(issue('error', 'UNRESOLVED_REFERENCE', 'exceptionalCircumstance',
        `EC ${ec.externalId} references unknown enrolment ${ec.enrolmentExternalId}`,
        { externalId: ec.externalId }));
    }
    if (ec.moduleOfferingExternalId !== undefined && !offeringIds.has(ec.moduleOfferingExternalId)) {
      issues.push(issue('warning', 'UNRESOLVED_REFERENCE', 'exceptionalCircumstance',
        `EC ${ec.externalId} references unknown moduleOffering ${ec.moduleOfferingExternalId}`,
        { externalId: ec.externalId, field: 'moduleOfferingExternalId' }));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const errorCount   = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount    = issues.filter(i => i.severity === 'info').length;

  return {
    timestamp:    new Date().toISOString(),
    tenantId,
    sourceSystem: payload.meta.sourceSystem,
    dryRun,
    recordCounts: counts,
    issues,
    summary: {
      hasErrors:    errorCount > 0,
      errorCount,
      warningCount,
      infoCount,
    },
  };
}

export function updateCounts(
  report: ValidationReport,
  entity: string,
  loaded: number,
  failed: number,
): void {
  const c = report.recordCounts.find(r => r.entity === entity);
  if (c) {
    c.loaded = loaded;
    c.failed = failed;
  }
}
