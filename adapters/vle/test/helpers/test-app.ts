import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServiceTokenSource } from '@revelation-srs/service-client';
import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { createVleDb, type VleDb } from '../../src/db/client.js';
import { buildStubVleApp } from '../../src/stub-vle/app.js';
import { HttpVleClient } from '../../src/vle-client/client.js';

import {
  StubSrsRegistryClient,
  makeRegistration,
} from './stub-srs-client.js';
import { StubSrsAckServer } from './stub-srs-ack.js';
import { StubSrsMarksServer } from './stub-srs-marks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TestVleApp {
  connector:          FastifyInstance;
  stubVle:            FastifyInstance;
  stubVleBaseUrl:     string;
  stubSrsAck:         StubSrsAckServer;
  stubSrsAckBaseUrl:  string;
  stubSrsMarks:       StubSrsMarksServer;
  stubSrsMarksBaseUrl: string;
  stubSrsClient:      StubSrsRegistryClient;
  db:                 VleDb;
  container:          StartedPostgreSqlContainer;
  tenantId:           string;
  registrationId:     string;
  teardown:           () => Promise<void>;
}

async function applySql(db: VleDb, absolutePath: string): Promise<void> {
  const content = await readFile(absolutePath, 'utf8');
  await db.execute(sql.raw(content));
}

export async function startTestApp(): Promise<TestVleApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('vle_connector_test')
    .start();

  const connectionString = container.getConnectionUri();
  const db               = createVleDb(connectionString);

  const migrationsDir = join(__dirname, '../../migrations');
  const journal = JSON.parse(await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) await applySql(db, join(migrationsDir, `${tag}.sql`));

  const tenantId       = '00000000-0000-0000-0000-000000000001';
  const registrationId = '00000000-0000-0000-0000-000000000099';

  // Stub SRS registry client — pre-seeds a valid enabled simulator registration
  // so the connector's onReady hook succeeds without a live SRS instance.
  const stubSrsClient = new StubSrsRegistryClient();
  stubSrsClient.seed(makeRegistration({ registrationId, endpointUrl: 'http://stub-vle.test' }));

  // Stub VLE must listen on a real TCP port so HttpVleClient can reach it.
  const stubVle = await buildStubVleApp('silent');
  await stubVle.listen({ port: 0, host: '127.0.0.1' });
  const { port: vlePort } = stubVle.server.address() as { port: number };
  const stubVleBaseUrl = `http://127.0.0.1:${vlePort}`;

  // Stub SRS acknowledgement server — records ack calls for assertion in tests.
  const stubSrsAck = new StubSrsAckServer();
  const stubSrsAckBaseUrl = await stubSrsAck.start();

  // Stub SRS marks server — records mark submissions and returns fresh markIds.
  const stubSrsMarks = new StubSrsMarksServer();
  const stubSrsMarksBaseUrl = await stubSrsMarks.start();

  const config: Config = {
    port:                      3002,
    logLevel:                  'silent',
    nodeEnv:                   'test',
    databaseUrl:               connectionString,
    srsApiUrl:                 stubSrsAckBaseUrl,
    natsUrl:                   'nats://localhost:4222',
    tenantId,
    integrationRegistrationId: registrationId,
    srsClient:                 { srsApiUrlSet: true, tokenUrl: undefined, clientAuth: 'client_secret_basic', clientKeyFile: undefined, clientKeyId: undefined, clientSecret: 'test' },
    vleEndpointUrl:            stubVleBaseUrl,
    vlePlatform:               'stub',
    vleApiToken:               undefined,
    moodleStrategy:            'groups',
    consumerEnabled:           false,
    reconcileIntervalMs:       0,
    endpointSafetyClass:       'simulator',
    retryMaxAttempts:          3,
    retryBackoffMs:            50,
  };

  const vleClient = new HttpVleClient(stubVleBaseUrl);
  const connector = await buildApp(config, { registryClient: stubSrsClient, vleClient });

  await connector.ready();

  const teardown = async (): Promise<void> => {
    await connector.close();
    await stubVle.close();
    await stubSrsAck.stop();
    await stubSrsMarks.stop();
    await container.stop();
  };

  return {
    connector,
    stubVle,
    stubVleBaseUrl,
    stubSrsAck,
    stubSrsAckBaseUrl,
    stubSrsMarks,
    stubSrsMarksBaseUrl,
    stubSrsClient,
    db,
    container,
    tenantId,
    registrationId,
    teardown,
  };
}

/** A fixed token for the stub SRS servers, which do not check it (ADR-032 tokens are tested in core). */
export const staticTokens: ServiceTokenSource = {
  getToken: () => Promise.resolve('test-token'),
  invalidate: () => undefined,
};
