import { nkeyAuthenticator, type ConnectionOptions } from 'nats';

/**
 * Connection options for the event bus (BL-337). The deployed NATS server
 * admits only the SRS account's nkey user, so every service authenticates
 * with the user seed OpenBao injects as NATS_NKEY_SEED. Development NATS
 * (infra/compose) runs without auth, so there no seed is needed.
 *
 * A copy of packages/auth/src/nats.ts: the connector does not depend on
 * @revelation-srs/auth. Services call this rather than building connect()
 * options themselves (enforced by lint), so none can forget the credentials.
 */
export function natsConnectOptions(servers: string, env: NodeJS.ProcessEnv = process.env): ConnectionOptions {
  const seed = env['NATS_NKEY_SEED']?.trim();
  return { servers, ...(seed ? { authenticator: nkeyAuthenticator(new TextEncoder().encode(seed)) } : {}) };
}

/**
 * Refuses, outside development and test, to start without a NATS user seed:
 * the server would refuse the connection and events would never flow. A
 * static check — NATS is not contacted, so its outage cannot crash-loop a pod.
 */
export function assertNatsCredentials(service: string, nodeEnv: string, env: NodeJS.ProcessEnv = process.env): void {
  if (nodeEnv === 'development' || nodeEnv === 'test') return;
  const seed = env['NATS_NKEY_SEED']?.trim();
  if (!seed) throw new Error(`Refusing to start ${service} in '${nodeEnv}': NATS_NKEY_SEED is not set (the event bus requires nkey authentication)`);
  if (!seed.startsWith('SU')) throw new Error(`Refusing to start ${service} in '${nodeEnv}': NATS_NKEY_SEED is not an nkey user seed (it starts SU)`);
}
