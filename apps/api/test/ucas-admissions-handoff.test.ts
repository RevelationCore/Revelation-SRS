import { describe, expect, it } from 'vitest';

import {
  ADMISSIONS_ENABLED_FLAG_KEY,
  ADMISSIONS_UCAS_ADAPTER_ENABLED_FLAG_KEY,
  shouldStartUcasAdmissionsWorkflow,
} from '../src/platform/regulatory/ucas-service.js';

describe('UCAS admissions handoff migration flag', () => {
  // Stage 7: LEGACY_UCAS_AUTO_ENROLMENT_FLAG_KEY constant removed — the retired
  // flag (admissions.legacy-ucas-auto-enrolment.enabled) lives only in the DB
  // with status='retired'. No runtime code evaluates it; shouldStartUcasAdmissionsWorkflow
  // depends only on admissions.enabled and admissions.ucas-adapter.enabled.

  it('starts UCAS Admissions workflow only when Admissions and the UCAS adapter are enabled', () => {
    expect(ADMISSIONS_ENABLED_FLAG_KEY).toBe('admissions.enabled');
    expect(ADMISSIONS_UCAS_ADAPTER_ENABLED_FLAG_KEY).toBe('admissions.ucas-adapter.enabled');
    expect(shouldStartUcasAdmissionsWorkflow({
      admissionsEnabled: true,
      ucasAdapterEnabled: true,
    })).toBe(true);
  });

  it('prevents disabled Admissions features from bypassing the workflow handoff', () => {
    expect(shouldStartUcasAdmissionsWorkflow({
      admissionsEnabled: false,
      ucasAdapterEnabled: true,
    })).toBe(false);
    expect(shouldStartUcasAdmissionsWorkflow({
      admissionsEnabled: true,
      ucasAdapterEnabled: false,
    })).toBe(false);
  });
});
