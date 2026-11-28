import { createHash, createPublicKey, randomUUID } from 'node:crypto';

import { importPKCS8, SignJWT } from 'jose';

/**
 * Client authentication to Keycloak for a service's client-credentials
 * clients (ADR-029, RFC 9700 §2.5): outside development and test, a
 * service signs a short-lived assertion (`private_key_jwt`) with a private
 * key Keycloak never holds. Client secrets are for development only.
 */

export interface ClientAssertionInput {
  clientId: string;
  /** The realm issuer URL (Keycloak also accepts the token endpoint). */
  audience: string;
  /** PKCS#8 PEM of the RSA private key. */
  privateKeyPem: string;
  /**
   * Optional override for the assertion's kid. By default it is the key id
   * Keycloak gives a registered certificate's public key (keycloakKeyId), so
   * the two always agree.
   */
  keyId?: string | undefined;
}

/**
 * The key id Keycloak gives the public key of a certificate registered on a
 * client-jwt client: base64url(SHA-256(DER SubjectPublicKeyInfo)), as its
 * KeyUtils.createKeyId does. Keycloak looks the assertion's kid up by it,
 * so a configured label (or an RFC 7638 thumbprint) is refused.
 */
export function keycloakKeyId(privateKeyPem: string): string {
  const spki = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64url');
}

/** A signed client assertion: iss = sub = client ID, aud = the realm, a random jti, valid for 60 s. */
export async function createClientAssertion(input: ClientAssertionInput): Promise<string> {
  const key = await importPKCS8(input.privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: input.keyId ?? keycloakKeyId(input.privateKeyPem) })
    .setIssuer(input.clientId)
    .setSubject(input.clientId)
    .setAudience(input.audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(key);
}
