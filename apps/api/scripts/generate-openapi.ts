/**
 * Generates apps/api/openapi/v1.json from the live Fastify app registration.
 *
 * Runs without any external connections — postgres.js and the NATS publisher are
 * both lazy and do not connect until the first query / publish call is made.
 *
 * Usage:  pnpm --filter @revelation-srs/api generate:openapi
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR  = join(__dirname, '..', 'openapi');
const OUTPUT_PATH = join(OUTPUT_DIR, 'v1.json');

const config: Config = {
  port:                      3000,
  logLevel:                  'silent',
  nodeEnv:                   'production',
  databaseUrl:               'postgres://unused/openapi-generation',
  natsUrl:                   'nats://unused:4222',
  temporalAddress:           'unused:7233',
  deploymentEnvironmentCode: 'local',
  releaseVersion:            '1.0.0',
  imageDigest:               undefined,
  migrationVersion:          '0004_business_process_foundations',
  jwtSecret:                 'generation-only',
  keycloakJwksUrl:           undefined,
  corsOrigins:               ['*'],
  otelEndpoint:              undefined,
  otelServiceName:           'srs-api',
};

const app = await buildApp(config);
await app.ready();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
const spec = (app as any).swagger() as unknown;

await app.close();

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify(spec, null, 2) + '\n');

console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
