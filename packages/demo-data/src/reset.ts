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

/**
 * Tenant tables a demo reset keeps: reference data the scenarios build on
 * (catalogue, calendar, rules, value sets), tenant configuration, workflow
 * definitions, demo bookkeeping, and the audit trail. Every other table with
 * a tenant_id is scenario data and is wiped, so a table added later is wiped
 * by default rather than leaking between resets.
 */
export const PRESERVED_TENANT_TABLES: ReadonlyMap<string, string> = new Map([
  // Catalogue and calendar: reference data the scenarios load idempotently.
  ['public.programme', 'catalogue'], ['public.programme_route', 'catalogue'], ['public.programme_rule_set', 'catalogue'],
  ['public.module', 'catalogue'], ['public.module_offering', 'catalogue'], ['public.module_relationship', 'catalogue'],
  ['public.module_group', 'catalogue'], ['public.module_group_member', 'catalogue'], ['public.learning_outcome', 'catalogue'],
  ['public.assessment_pattern', 'catalogue'], ['public.awarding_body', 'catalogue'], ['public.module_subject', 'catalogue'],
  ['public.academic_period', 'calendar'], ['public.module_selection_window', 'calendar'], ['public.reenrolment_period', 'calendar'],
  // Rules, value sets and tenant configuration.
  ['public.academic_rule', 'rules'], ['public.work_limit_rule', 'rules'], ['public.value_set_member', 'value sets'],
  ['public.tenant_currency_config', 'configuration'], ['public.tenant_locale_config', 'configuration'],
  ['public.environment_configuration', 'configuration'], ['public.environment_promotion_record', 'configuration'],
  ['public.feature_flag_assignment', 'configuration'], ['public.feature_flag_evaluation_log', 'configuration'],
  ['public.communication_template', 'configuration'], ['public.delivery_flow_config', 'configuration'],
  ['public.adjustment_target_config', 'configuration'], ['public.retention_schedule', 'configuration'],
  ['attendance.engagement_policy_version', 'configuration'],
  // Workflow definitions and routing (instances and tasks are scenario data).
  ['public.workflow_definition', 'workflow definitions'], ['public.workflow_assignment_rule', 'workflow definitions'],
  ['public.workflow_trigger_rule', 'workflow definitions'],
  // Demo bookkeeping.
  ['public.demo_status', 'demo bookkeeping'], ['public.demo_load_checkpoint', 'demo bookkeeping'],
  // The audit trail outlives resets: a reset is itself an audited event.
  ['public.audit_record', 'audit trail'], ['public.audit_partition_seal', 'audit trail'], ['wellbeing.audit_log', 'audit trail'],
]);

interface TenantTable { name: string; deleteTriggers: string[] }

/**
 * Wipes a demo tenant's scenario data in one transaction: every tenant table
 * except PRESERVED_TENANT_TABLES, children before parents (ordered from the
 * database's foreign keys). Row-level security is satisfied by setting the
 * tenant for the transaction. Append-only guard triggers are suspended only
 * inside the transaction, and only this demo tenant's rows are deleted;
 * assertResetAllowed has already checked the tenant is in demo mode.
 */
export async function wipeTenantScenarioData(db: Db, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    const tables = await tenantTablesToWipe(tx as unknown as Db);

    // HESA child tables have no tenant_id: delete through hesa_student_return first.
    for (const child of ['hesa_validation_issue']) {
      await tx.execute(sql`
        DELETE FROM ${sql.identifier(child)} WHERE hesa_validation_report_id IN (
          SELECT id FROM hesa_validation_report WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId}))
      `);
    }
    for (const child of ['hesa_validation_report', 'hesa_identifier_assignment', 'hesa_submission', 'hesa_student_return_record']) {
      await tx.execute(sql`
        DELETE FROM ${sql.identifier(child)} WHERE hesa_student_return_id IN (SELECT id FROM hesa_student_return WHERE tenant_id = ${tenantId})
      `);
    }

    for (const table of tables) {
      const [schema, name] = table.name.split('.') as [string, string];
      const target = sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
      for (const trigger of table.deleteTriggers) await tx.execute(sql`ALTER TABLE ${target} DISABLE TRIGGER ${sql.identifier(trigger)}`);
      await tx.execute(sql`DELETE FROM ${target} WHERE tenant_id = ${tenantId}`);
      for (const trigger of table.deleteTriggers) await tx.execute(sql`ALTER TABLE ${target} ENABLE TRIGGER ${sql.identifier(trigger)}`);
    }
  });
}

/** Tenant tables outside PRESERVED_TENANT_TABLES, ordered so every child is deleted before its parent. */
export async function tenantTablesToWipe(db: Db): Promise<TenantTable[]> {
  const tableRows = (await db.execute(sql`
    SELECT n.nspname || '.' || c.relname AS name, c.oid::bigint AS oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relname <> 'tenant'
  `)) as unknown as Array<{ name: string; oid: string }>;
  const fkRows = (await db.execute(sql`
    SELECT con.conrelid::bigint AS child, con.confrelid::bigint AS parent
    FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid <> con.confrelid
  `)) as unknown as Array<{ child: string; parent: string }>;
  const triggerRows = (await db.execute(sql`
    SELECT tg.tgrelid::bigint AS oid, tg.tgname AS name
    FROM pg_trigger tg WHERE NOT tg.tgisinternal AND (tg.tgtype & 8) <> 0
  `)) as unknown as Array<{ oid: string; name: string }>;

  const byOid = new Map(tableRows.map((t) => [String(t.oid), t.name]));
  const wiped = new Set(tableRows.map((t) => t.name).filter((n) => !PRESERVED_TENANT_TABLES.has(n)));

  // A preserved table that references a wiped one would block the wipe: fail loudly instead.
  for (const fk of fkRows) {
    const child = byOid.get(String(fk.child));
    const parent = byOid.get(String(fk.parent));
    if (child && parent && PRESERVED_TENANT_TABLES.has(child) && wiped.has(parent)) {
      throw new Error(`Preserved table ${child} references wiped table ${parent}; preserve ${parent} too or stop preserving ${child}`);
    }
  }

  // Children first: repeatedly take tables no remaining table depends on.
  const childrenOf = new Map<string, Set<string>>([...wiped].map((n) => [n, new Set<string>()]));
  for (const fk of fkRows) {
    const child = byOid.get(String(fk.child));
    const parent = byOid.get(String(fk.parent));
    if (child && parent && wiped.has(child) && wiped.has(parent)) {
      childrenOf.get(parent)!.add(child);
    }
  }
  const ordered: string[] = [];
  const remaining = new Set(wiped);
  while (remaining.size > 0) {
    const leaves = [...remaining].filter((n) => [...childrenOf.get(n)!].every((c) => !remaining.has(c))).sort();
    if (leaves.length === 0) throw new Error(`Foreign-key cycle among demo tables: ${[...remaining].sort().join(', ')}`);
    for (const leaf of leaves) { ordered.push(leaf); remaining.delete(leaf); }
  }

  const triggersByName = new Map<string, string[]>();
  for (const t of triggerRows) {
    const name = byOid.get(String(t.oid));
    if (name) triggersByName.set(name, [...(triggersByName.get(name) ?? []), t.name]);
  }
  return ordered.map((name) => ({ name, deleteTriggers: triggersByName.get(name) ?? [] }));
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
