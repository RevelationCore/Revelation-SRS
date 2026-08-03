import type { ScenarioRegistryEntry } from './types.js';
import { manifest as ciGoldenManifest }             from './scenarios/ci-golden.js';
import { manifest as curriculumBaselineManifest }    from './scenarios/curriculum-baseline.js';
import { manifest as applicantPipelineManifest }     from './scenarios/applicant-pipeline.js';
import { manifest as enrolmentInductionManifest }    from './scenarios/enrolment-induction.js';
import { manifest as moduleSelectionManifest }       from './scenarios/module-selection.js';
import { manifest as assessmentMarksManifest }       from './scenarios/assessment-marks.js';
import { manifest as examBoardManifest }              from './scenarios/exam-board.js';
import { manifest as institutionYearManifest }        from './scenarios/institution-year.js';
import { manifest as pgrLifecycleManifest }           from './scenarios/pgr-lifecycle.js';

export const SCENARIO_REGISTRY: Map<string, ScenarioRegistryEntry> = new Map([
  [
    ciGoldenManifest.slug,
    { manifest: ciGoldenManifest, class: 'ci-only' },
  ],
  [
    curriculumBaselineManifest.slug,
    { manifest: curriculumBaselineManifest, class: 'standard-demo' },
  ],
  [
    applicantPipelineManifest.slug,
    { manifest: applicantPipelineManifest, class: 'standard-demo' },
  ],
  [
    enrolmentInductionManifest.slug,
    { manifest: enrolmentInductionManifest, class: 'standard-demo' },
  ],
  [
    moduleSelectionManifest.slug,
    { manifest: moduleSelectionManifest, class: 'standard-demo' },
  ],
  [
    assessmentMarksManifest.slug,
    { manifest: assessmentMarksManifest, class: 'standard-demo' },
  ],
  [
    examBoardManifest.slug,
    { manifest: examBoardManifest, class: 'standard-demo' },
  ],
  [
    institutionYearManifest.slug,
    { manifest: institutionYearManifest, class: 'performance-hosted' },
  ],
  [
    pgrLifecycleManifest.slug,
    { manifest: pgrLifecycleManifest, class: 'standard-demo' },
  ],
]);

export function getManifest(slug: string): ScenarioRegistryEntry | undefined {
  return SCENARIO_REGISTRY.get(slug);
}

export function listManifests(): ScenarioRegistryEntry[] {
  return Array.from(SCENARIO_REGISTRY.values());
}
