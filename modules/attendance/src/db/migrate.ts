import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createAttendanceDb } from './client.js';

// Migrations run as the schema owner; services connect as a login role that
// inherits srs_app. MIGRATION_DATABASE_URL names the owner connection.
const connectionString = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');

const db = createAttendanceDb(connectionString);
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../..', 'migrations');

// Own migrations table: the core set shares the default one, and drizzle
// skips any migration older than the newest recorded there, so sharing it
// meant this module's migrations were skipped once core had run.
await migrate(db, { migrationsFolder, migrationsTable: '__drizzle_migrations_attendance' });

console.warn('Attendance migrations applied successfully');
process.exit(0);
