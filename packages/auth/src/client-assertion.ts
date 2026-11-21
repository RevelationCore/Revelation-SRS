import { randomUUID } from 'node:crypto';

import { importPKCS8, SignJWT } from 'jose';

/**
 * Client authentication to Keycloak for a service's client-credentials
 * clients (ADR-029, RFC 9700 §2.5): outside development and test, a
 * service signs a short-lived assertion (`private_key_jwt`) with a private
 * key Keycloak never holds. Client secrets are for development only.
 */

/** Published development secret for the wellbeing service's demo-tenant client; refused outside development and test. */
export const DEFAULT_DEV_WELLBEING_CLIENT_SECRET = 'dev-wellbeing-service-secret';

export interface ClientAssertionInput {
  clientId: string;
  /** The realm issuer URL (Keycloak also accepts the token endpoint). */
  audience: string;
  /** PKCS#8 PEM of the RSA private key. */
  privateKeyPem: string;
  keyId: string;
}

/** A signed client assertion: iss = sub = client ID, aud = the realm, a random jti, valid for 60 s. */
export async function createClientAssertion(input: ClientAssertionInput): Promise<string> {
  const key = await importPKCS8(input.privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: input.keyId })
    .setIssuer(input.clientId)
    .setSubject(input.clientId)
    .setAudience(input.audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(key);
}
