import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';

const MIGRATIONS_DIR          = new URL('../../../db/migrations/', import.meta.url);
const WELLBEING_MIGRATIONS_DIR = new URL('../../../../modules/wellbeing/migrations/', import.meta.url);

async function applyMigration(db: Db, fileName: string, baseDir: URL = MIGRATIONS_DIR): Promise<void> {
  const sqlText = await readFile(
    fileURLToPath(new URL(fileName, baseDir)),
    'utf8',
  );
  await db.execute(sql.raw(sqlText));
}

export async function applyAllMigrations(db: Db): Promise<void> {
  await applyMigration(db, '0000_platform_foundations.sql');
  await applyMigration(db, '0001_platform_hardening_and_refinements.sql');
  await applyMigration(db, '0002_demo_performance_and_seed_data.sql');
  await applyMigration(db, '0003_engagement_and_attendance.sql');
  await applyMigration(db, '0004_business_process_foundations.sql');
  await applyMigration(db, '0005_module_selection_rules.sql');
  await applyMigration(db, '0006_registration_window.sql');
  await applyMigration(db, '0007_module_registration_change_workflow.sql');
  await applyMigration(db, '0008_slc_submission_approval_workflow.sql');

  // Wellbeing module schema (separate pgSchema 'wellbeing' in same database)
  await applyMigration(db, '0000_wellbeing_foundations.sql', WELLBEING_MIGRATIONS_DIR);
}
