import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb } from './pool.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = createDb(connectionString);

await migrate(db, { migrationsFolder: './migrations' });

console.log('Migrations applied successfully');
process.exit(0);
