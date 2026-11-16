import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createWellbeingDb } from './client.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = createWellbeingDb(connectionString);
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../..', 'migrations');

// Own migrations table: the core set shares the default one, and drizzle
// skips any migration older than the newest recorded there, so sharing it
// meant this module's migrations were skipped once core had run.
await migrate(db, { migrationsFolder, migrationsTable: '__drizzle_migrations_wellbeing' });

console.warn('Wellbeing migrations applied successfully');
process.exit(0);
