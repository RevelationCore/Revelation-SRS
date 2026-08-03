import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createVleDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const db = createVleDb(databaseUrl);

  const migrationsDir = join(__dirname, '../../migrations');
  const migrationSql  = await readFile(join(migrationsDir, '0000_vle_foundations.sql'), 'utf8');
  await db.execute(sql.raw(migrationSql));

  console.log('VLE connector migration complete');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
