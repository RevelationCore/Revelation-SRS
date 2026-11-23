import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createVleDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // Migrations run as the schema owner (MIGRATION_DATABASE_URL); the adapter
  // itself connects as a login role that inherits srs_app.
  const databaseUrl = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');
  const db = createVleDb(databaseUrl);

  const migrationsDir = join(__dirname, '../../migrations');
  // Every migration in the journal, in order, so a new file cannot be missed.
  const journal = JSON.parse(await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const file of journal.entries.map((e) => `${e.tag}.sql`)) {
    const migrationSql = await readFile(join(migrationsDir, file), 'utf8');
    await db.execute(sql.raw(migrationSql));
  }

  console.log('VLE connector migration complete');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
