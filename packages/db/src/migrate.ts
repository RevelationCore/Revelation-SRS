import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb } from './pool.js';

// Migrations run as the schema owner; services connect as a login role that
// inherits srs_app. MIGRATION_DATABASE_URL names the owner connection.
const connectionString = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');

const db = createDb(connectionString);

await migrate(db, { migrationsFolder: './migrations' });

console.warn('Migrations applied successfully');
process.exit(0);
