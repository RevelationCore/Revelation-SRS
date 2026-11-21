/**
 * BL-337: the deployed NATS admits only the SRS account's nkey user
 * (infra/k8s/base/nats.yaml), so a service that connects without the seed
 * never publishes or consumes an event. This runs the same server
 * configuration and checks the publisher connects with NATS_NKEY_SEED and is
 * refused without it, and that services refuse to start without a seed
 * outside development and test.
 */
import { assertNatsCredentials, natsConnectOptions } from '@revelation-srs/auth';
import { connect, nkeys } from 'nats';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

// nats re-exports nkeys.js, whose types do not resolve here.
interface NkeyUser { getSeed(): Uint8Array; getPublicKey(): string }
const nk = nkeys as unknown as { createUser(): NkeyUser };
const user = nk.createUser();
const seed = new TextDecoder().decode(user.getSeed());
const publicKey = user.getPublicKey();

let nats: StartedTestContainer;
let url: string;

beforeAll(async () => {
  // The accounts block of infra/k8s/base/nats.yaml, with the public key filled in.
  const conf = `
port: 4222
jetstream { store_dir: /tmp/js }
accounts { SRS { jetstream: enabled, users: [ { nkey: ${publicKey} } ] } }
no_auth_user: ""
`;
  nats = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([{ content: conf, target: '/etc/nats/test.conf' }])
    .withCommand(['-c', '/etc/nats/test.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
    .start();
  url = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
}, 120_000);
afterAll(async () => { await nats?.stop(); });

describe('NATS nkey authentication (BL-337)', () => {
  it('the publisher connects with NATS_NKEY_SEED and creates the stream', async () => {
    const previous = process.env['NATS_NKEY_SEED'];
    process.env['NATS_NKEY_SEED'] = seed;
    try {
      const bus = new IntegrationBusPublisher(url);
      await bus.connect();
      expect(bus.isConnected()).toBe(true);
      await bus.close();
    } finally {
      if (previous === undefined) delete process.env['NATS_NKEY_SEED']; else process.env['NATS_NKEY_SEED'] = previous;
    }
  });

  it('a connection without the seed is refused', async () => {
    await expect(connect(natsConnectOptions(url, {}))).rejects.toThrow(/authorization/i);
  });

  it('a connection with another user\'s seed is refused', async () => {
    const other = new TextDecoder().decode(nk.createUser().getSeed());
    await expect(connect(natsConnectOptions(url, { NATS_NKEY_SEED: other }))).rejects.toThrow(/authorization/i);
  });

  it('services refuse to start without a user seed outside development and test', () => {
    expect(() => assertNatsCredentials('srs-api', 'production', {})).toThrow(/NATS_NKEY_SEED is not set/);
    expect(() => assertNatsCredentials('srs-api', 'staging', { NATS_NKEY_SEED: 'not-a-seed' })).toThrow(/not an nkey user seed/);
    expect(() => assertNatsCredentials('srs-api', 'production', { NATS_NKEY_SEED: seed })).not.toThrow();
    expect(() => assertNatsCredentials('srs-api', 'development', {})).not.toThrow();
  });
});
