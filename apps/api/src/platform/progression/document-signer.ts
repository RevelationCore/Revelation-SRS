import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * Signing issued award documents (Phase 3 D-20). A detached ES256 JWS over
 * the facts a document states, so it can be checked offline against the
 * institution's published key. Signing happens only inside document issue:
 * nothing signs arbitrary bytes on request.
 *
 *   local-key        development, test and demo: a PEM from the environment, or
 *                    a key generated when the process starts
 *   openbao-transit  production: a non-exportable key per tenant in OpenBao
 *                    (ADR-010), reached through its transit engine
 */
export interface SignedPayload {
  issueId: string;
  contentHash: string;
  pdfSha256: string;
  verificationCode: string;
}

export interface SignatureResult { keyId: string; algorithm: 'ES256'; jws: string }

export interface DocumentSigner {
  readonly provider: 'local-key' | 'openbao-transit';
  /** The key that signs now, with its public half for the JWKS. */
  activeKey(tenantId: string): Promise<{ keyId: string; publicKeyPem: string }>;
  sign(tenantId: string, payload: SignedPayload): Promise<SignatureResult>;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The bytes signed: a canonical JSON of the payload's fields in a fixed order. */
export function signingInput(header: Record<string, unknown>, payload: SignedPayload): { protectedHeader: string; data: Buffer } {
  const protectedHeader = b64u(JSON.stringify(header));
  const body = b64u(JSON.stringify({ issueId: payload.issueId, contentHash: payload.contentHash, pdfSha256: payload.pdfSha256, verificationCode: payload.verificationCode }));
  return { protectedHeader, data: Buffer.from(`${protectedHeader}.${body}`) };
}

/** A key id that names the key itself: the first 16 hex of the SHA-256 of its public key. */
export function keyIdFor(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** Checks a detached JWS (`header..signature`) against a public key. */
export function verifyDetached(jws: string, payload: SignedPayload, publicKeyPem: string): boolean {
  const [headerPart, , sigPart] = jws.split('.');
  if (!headerPart || !sigPart) return false;
  let header: Record<string, unknown>;
  try { header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return false; }
  if (header['alg'] !== 'ES256') return false;
  const { data } = signingInput(header, payload);
  return cryptoVerify('sha256', data, { key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(sigPart, 'base64url'));
}

export class LocalKeySigner implements DocumentSigner {
  readonly provider = 'local-key' as const;
  readonly #privateKey: KeyObject;
  readonly #publicKeyPem: string;
  readonly #keyId: string;

  constructor(privateKeyPem?: string) {
    if (privateKeyPem) {
      this.#privateKey = createPrivateKey(privateKeyPem);
    } else {
      this.#privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    }
    this.#publicKeyPem = createPublicKey(this.#privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.#keyId = keyIdFor(this.#publicKeyPem);
  }

  activeKey(_tenantId: string): Promise<{ keyId: string; publicKeyPem: string }> {
    return Promise.resolve({ keyId: this.#keyId, publicKeyPem: this.#publicKeyPem });
  }

  sign(_tenantId: string, payload: SignedPayload): Promise<SignatureResult> {
    const header = { alg: 'ES256', kid: this.#keyId, typ: 'srs-document+jws', b64: true };
    const { protectedHeader, data } = signingInput(header, payload);
    const signature = cryptoSign('sha256', data, { key: this.#privateKey, dsaEncoding: 'ieee-p1363' });
    return Promise.resolve({ keyId: this.#keyId, algorithm: 'ES256', jws: `${protectedHeader}..${b64u(signature)}` });
  }
}

/**
 * OpenBao transit (production): the private key never leaves OpenBao. The
 * key is `srs-documents-<tenantId>`, created by the institution as an
 * ecdsa-p256 transit key. Untested here against a live OpenBao.
 */
export class OpenBaoTransitSigner implements DocumentSigner {
  readonly provider = 'openbao-transit' as const;

  constructor(private readonly address: string, private readonly token: string, private readonly mount = 'transit') {}

  async activeKey(tenantId: string): Promise<{ keyId: string; publicKeyPem: string }> {
    const res = await fetch(`${this.address}/v1/${this.mount}/keys/${keyName(tenantId)}`, { headers: { 'X-Vault-Token': this.token } });
    if (!res.ok) throw new Error(`OpenBao key lookup failed (${res.status})`);
    const body = await res.json() as { data: { latest_version: number; keys: Record<string, { public_key: string }> } };
    const pem = body.data.keys[String(body.data.latest_version)]!.public_key;
    return { keyId: keyIdFor(pem), publicKeyPem: pem };
  }

  async sign(tenantId: string, payload: SignedPayload): Promise<SignatureResult> {
    const { keyId } = await this.activeKey(tenantId);
    const header = { alg: 'ES256', kid: keyId, typ: 'srs-document+jws', b64: true };
    const { protectedHeader, data } = signingInput(header, payload);
    const res = await fetch(`${this.address}/v1/${this.mount}/sign/${keyName(tenantId)}/sha2-256`, {
      method: 'POST', headers: { 'X-Vault-Token': this.token, 'content-type': 'application/json' },
      body: JSON.stringify({ input: data.toString('base64'), marshaling_algorithm: 'jws' }),
    });
    if (!res.ok) throw new Error(`OpenBao signing failed (${res.status})`);
    const signed = (await res.json() as { data: { signature: string } }).data.signature; // vault:v1:<base64url>
    return { keyId, algorithm: 'ES256', jws: `${protectedHeader}..${signed.split(':').at(-1)!}` };
  }
}

const keyName = (tenantId: string) => `srs-documents-${tenantId}`;

/** The signer this deployment uses: OpenBao when configured, otherwise a local key. */
export function signerFromEnv(env: NodeJS.ProcessEnv = process.env): DocumentSigner {
  if (env['DOCUMENT_SIGNER'] === 'openbao-transit') {
    if (!env['OPENBAO_ADDR'] || !env['OPENBAO_TOKEN']) throw new Error('DOCUMENT_SIGNER=openbao-transit needs OPENBAO_ADDR and OPENBAO_TOKEN');
    return new OpenBaoTransitSigner(env['OPENBAO_ADDR'], env['OPENBAO_TOKEN'], env['OPENBAO_TRANSIT_MOUNT'] ?? 'transit');
  }
  return new LocalKeySigner(env['DOCUMENT_SIGNING_KEY_PEM'] || undefined);
}
