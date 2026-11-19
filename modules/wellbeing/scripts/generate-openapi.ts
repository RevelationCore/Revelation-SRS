/**
 * Writes modules/wellbeing/openapi/v1.json from the route schemas
 * (enterprise readiness plan, item 1.7). Needs no database: the client is
 * lazy and never connects here.
 *
 * Usage:  pnpm --filter @revelation-srs/wellbeing generate:openapi
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi');

const config: Config = {
  port: 0, logLevel: 'silent', nodeEnv: 'test',  // generation only: no tokens are validated
  databaseUrl: 'postgres://unused/openapi-generation', srsApiUrl: 'http://unused',
  natsUrl: 'nats://unused:4222', jwtSecret: 'generation-only', keycloakJwksUrl: undefined, corsOrigins: [],
};

const app = await buildApp(config);
await app.ready();
const spec = app.swagger();
await app.close();

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(join(OUTPUT_DIR, 'v1.json'), JSON.stringify(spec, null, 2) + '\n');
console.warn(`OpenAPI spec written to ${join(OUTPUT_DIR, 'v1.json')}`);
process.exit(0);
