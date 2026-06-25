/**
 * Creates the default development tenant that the Keycloak admin user
 * (`admin / admin`) is pre-configured to belong to.
 *
 * Run after applying migrations:
 *   pnpm --filter @revelation-srs/db seed:dev
 */
import { sql } from 'drizzle-orm';

import { createDb } from './pool.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgresql://srs:srs@localhost:5432/srs';

const db = createDb(connectionString);

try {
  await db.execute(sql`
    INSERT INTO tenant (id, code, name, configuration, active)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'DEV',
      'Development University',
      ${JSON.stringify({
        institutionName:        'Revelation University',
        defaultLocale:          'en-GB',
        defaultTimezone:        'Europe/London',
        defaultCurrencyCode:    'GBP',
        academicYearStartMonth: 9,
        ukprn:                  '10000001',
        hesaSubscriberId:       '0001',
        ucasProviderCode:       'R01',
      })}::jsonb,
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      configuration = EXCLUDED.configuration
      WHERE tenant.configuration = '{}'::jsonb
  `);
  console.log('Development tenant ready  (id: 00000000-0000-0000-0000-000000000001)');
} catch (err) {
  console.error('Seed failed:', err);
  process.exit(1);
}

process.exit(0);
