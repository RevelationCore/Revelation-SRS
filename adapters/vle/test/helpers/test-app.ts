import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  await applySql(db, join(migrationsDir, '0001_vle_connector_scaffold.sql'));
  await applySql(db, join(migrationsDir, '0002_vle_event_ledger_v2.sql'));
  await applySql(db, join(migrationsDir, '0003_vle_student_enrolment_map.sql'));

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
    serviceAccountToken:       'test-token',
    vleEndpointUrl:            stubVleBaseUrl,
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
