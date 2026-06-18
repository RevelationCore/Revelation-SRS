import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createWellbeingDb } from './client.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = createWellbeingDb(connectionString);
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../..', 'migrations');

await migrate(db, { migrationsFolder });

console.warn('Wellbeing migrations applied successfully');
process.exit(0);
