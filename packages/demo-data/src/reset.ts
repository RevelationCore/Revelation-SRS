import { createDb, type Db } from '@revelation-srs/db';

import { assertResetAllowed, assertSchemaVersion } from './safety.js';
import { getManifest } from './manifest.js';
import { loadScenario } from './load.js';
import { validateScenario } from './validate.js';
import { load as ciGoldenLoad }             from './scenarios/ci-golden.js';
import { load as curriculumBaselineLoad }    from './scenarios/curriculum-baseline.js';
import { load as applicantPipelineLoad }     from './scenarios/applicant-pipeline.js';
import { load as enrolmentInductionLoad }    from './scenarios/enrolment-induction.js';
import { load as moduleSelectionLoad }       from './scenarios/module-selection.js';
import { load as assessmentMarksLoad }       from './scenarios/assessment-marks.js';
import { load as examBoardLoad }              from './scenarios/exam-board.js';
import { load as institutionYearLoad }        from './scenarios/institution-year.js';

const SCENARIO_LOADERS: Record<string, (db: Db, tenantId: string, phase: string, opts: { dryRun?: boolean }) => Promise<void>> = {
  'ci-golden':            ciGoldenLoad,
  'curriculum-baseline':  curriculumBaselineLoad,
  'applicant-pipeline':   applicantPipelineLoad,
  'enrolment-induction':  enrolmentInductionLoad,
  'module-selection':     moduleSelectionLoad,
  'assessment-marks':     assessmentMarksLoad,
  'exam-board':           examBoardLoad,
  'institution-year':    institutionYearLoad,
};

export async function resetScenario(opts: {
  databaseUrl: string;
  tenantId:    string;
  scenarioSlug: string;
  dryRun?:     boolean;
}): Promise<void> {
  const db = createDb(opts.databaseUrl);

  await assertResetAllowed(db, opts.tenantId);

  const entry = getManifest(opts.scenarioSlug);
  if (!entry) {
    throw new Error(
      `Unknown scenario slug: "${opts.scenarioSlug}". ` +
      'Run pnpm demo:list to see available scenarios.',
    );
  }

  await assertSchemaVersion(db, entry.manifest.schemaVersion);

  const loader = SCENARIO_LOADERS[opts.scenarioSlug];
  if (!loader) {
    throw new Error(`No loader registered for scenario "${opts.scenarioSlug}".`);
  }

  console.log(
    opts.dryRun
      ? `\nDry run for scenario: ${entry.manifest.name}`
      : `\nResetting to scenario: ${entry.manifest.name}`,
  );

  const loadOpts: { dryRun?: boolean } = opts.dryRun === true ? { dryRun: true } : {};
  await loadScenario(db, opts.tenantId, entry.manifest, loader, loadOpts);

  if (!opts.dryRun) {
    const result = await validateScenario(db, opts.tenantId, entry.manifest);
    if (result.failed > 0) {
      throw new Error(
        `Post-load validation failed: ${result.failed} issue(s) — ${result.issues.join('; ')}`,
      );
    }
  }
}
