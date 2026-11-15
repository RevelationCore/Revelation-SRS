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

/** Apply every core migration in journal order, as `npm run migrate` does. */
async function applyCoreMigrations(db: Db): Promise<void> {
  const journal = JSON.parse(await readFile(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS_DIR)), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) await applyMigration(db, `${tag}.sql`);
}

export async function applyAllMigrations(db: Db): Promise<void> {
  await applyCoreMigrations(db);

  // Wellbeing module schema (separate pgSchema 'wellbeing' in same database)
  await applyMigration(db, '0000_wellbeing_foundations.sql', WELLBEING_MIGRATIONS_DIR);
  await applyMigration(db, '0001_adjustment_production_hardening.sql', WELLBEING_MIGRATIONS_DIR);
}
