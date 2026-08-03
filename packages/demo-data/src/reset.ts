import { createDb, type Db } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';

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
import { load as pgrLifecycleLoad }           from './scenarios/pgr-lifecycle.js';

const SCENARIO_LOADERS: Record<string, (db: Db, tenantId: string, phase: string, opts: { dryRun?: boolean }) => Promise<void>> = {
  'ci-golden':            ciGoldenLoad,
  'curriculum-baseline':  curriculumBaselineLoad,
  'applicant-pipeline':   applicantPipelineLoad,
  'enrolment-induction':  enrolmentInductionLoad,
  'module-selection':     moduleSelectionLoad,
  'assessment-marks':     assessmentMarksLoad,
  'exam-board':           examBoardLoad,
  'institution-year':    institutionYearLoad,
  'pgr-lifecycle':        pgrLifecycleLoad,
};

async function wipeTenantScenarioData(db: Db, tenantId: string): Promise<void> {
  // Delete in dependency order (children before parents).
  // Reference data (programmes, modules, value_sets, etc.) is intentionally preserved.

  // Wellbeing schema — only delete if the schema exists
  const [wellbeingSchemaRow] = await db.execute(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wellbeing' LIMIT 1`,
  );
  if (wellbeingSchemaRow) {
    await db.execute(sql`DELETE FROM wellbeing.ec_determination       WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.ec_evidence_review     WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.ec_claim               WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.adjustment_panel_decision WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.adjustment_assessment  WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.adjustment_case        WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.dsa_entitlement        WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.disability_support_case WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.intervention_plan      WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.mental_health_case     WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.early_warning_alert    WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.srs_context_projection WHERE tenant_id = ${tenantId}`);
    await db.execute(sql`DELETE FROM wellbeing.wellbeing_case         WHERE tenant_id = ${tenantId}`);
  }

  // Public schema — leaf tables first
  await db.execute(sql`DELETE FROM post_ratification_amendment WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM post_ratification_case      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exceptional_circumstances_board_visibility WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exceptional_circumstances   WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM misconduct_penalty_effect   WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM misconduct_outcome          WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM misconduct_case_reference   WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM mark                        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM module_result               WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM assessment_submission        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_entry                  WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_timetable_receipt      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM assessment_component        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM reasonable_adjustment       WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM disability_declaration      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM external_examiner_signoff   WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_board_member_attendance WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_board_candidate_profile WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM award                       WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM progression_decision        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_board_data_pack        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM exam_board                  WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM module_registration         WHERE tenant_id = ${tenantId}`);

  // HESA child tables have no tenant_id — delete via correlated subquery through hesa_student_return.
  // Must come BEFORE integration_exchange, which hesa_validation_report optionally references.
  await db.execute(sql`
    DELETE FROM hesa_validation_issue
    WHERE hesa_validation_report_id IN (
      SELECT id FROM hesa_validation_report
      WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
    )
  `);
  await db.execute(sql`
    DELETE FROM hesa_validation_report
    WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
  `);
  await db.execute(sql`
    DELETE FROM hesa_identifier_assignment
    WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
  `);
  await db.execute(sql`
    DELETE FROM hesa_submission
    WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
  `);
  await db.execute(sql`
    DELETE FROM hesa_student_return_record
    WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
  `);
  await db.execute(sql`DELETE FROM hesa_student_return         WHERE tenant_id = ${tenantId}`);

  await db.execute(sql`DELETE FROM integration_exchange        WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM integration_registration    WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM reenrolment_confirmation    WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM enrolment_status_transition WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM enrolment_downstream_trigger WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM fee_liability               WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM slc_notification           WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM student_regulatory_profile  WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ukvi_attendance_report      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ukvi_cas_request            WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ukvi_compliance_alert       WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ukvi_visa_status            WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ofs_extract                 WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM ucas_application            WHERE tenant_id = ${tenantId}`);
  // foi_extract has a logical FK to foi_request — delete child before parent
  await db.execute(sql`DELETE FROM foi_extract                 WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM foi_request                 WHERE tenant_id = ${tenantId}`);

  // PGR (BP-03-007–BP-06-006) — leaf tables first; several hard-reference
  // person(id), so this entire block must precede the person delete below.
  await db.execute(sql`DELETE FROM thesis_correction_requirement WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM examiner_report               WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM final_thesis_deposit          WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_examination_outcome       WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM viva_event                    WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM examiner_appointment          WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM thesis_submission             WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_completion_case           WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_examination_case          WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM research_milestone            WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_review_member              WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_progress_review            WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM staff_assignment               WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_supervisor_nomination      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM pgr_supervision_case           WHERE tenant_id = ${tenantId}`);
  // Shared business-case primitive (BPR-D01–D19) — safe to wipe per tenant;
  // no PGR table (or any other current demo scenario) hard-references these.
  await db.execute(sql`DELETE FROM case_evidence_reference       WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM case_decision                 WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM business_case                 WHERE tenant_id = ${tenantId}`);

  await db.execute(sql`DELETE FROM enrolment                   WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM identity_verification_check WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM person_identity             WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM student_address             WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM student_contact_method      WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM notification                WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM communication_dispatch_log  WHERE tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM person                      WHERE tenant_id = ${tenantId}`);
}

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

  const loadOpts: { dryRun?: boolean; force?: boolean } = opts.dryRun === true
    ? { dryRun: true }
    : { force: true };

  if (!opts.dryRun) {
    await wipeTenantScenarioData(db, opts.tenantId);
  }

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
