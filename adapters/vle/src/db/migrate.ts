import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { loadConfig } from '../config.js';

import { createVleDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const db     = createVleDb(config.databaseUrl);

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
