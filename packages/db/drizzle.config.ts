import type { Config } from 'drizzle-kit';

export default {
  schema:    './src/schema/index.ts',
  out:       './migrations',
  dialect:   'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://srs:srs@localhost:5432/srs',
  },
  verbose: true,
  strict:  true,
} satisfies Config;
