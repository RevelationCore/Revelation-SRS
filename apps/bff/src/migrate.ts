// Applies the BFF's migrations in journal order (the bff schema and its role).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1 });
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
for (const { tag } of journal.entries) await sql.unsafe(readFileSync(join(dir, `${tag}.sql`), 'utf8'));
await sql.end();
console.error(`bff migrations applied (${journal.entries.length})`);
