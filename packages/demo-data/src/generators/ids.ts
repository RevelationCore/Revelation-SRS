import { createHash } from 'node:crypto';

const NAMESPACE = 'revelation-srs:demo-generators:v1';

/**
 * Derive a stable UUID v5 from a set of string parts.
 *
 * The same namespace + parts always produce the same UUID, enabling
 * deterministic scenario generation without hard-coding thousands of IDs.
 * The resulting UUID is safe to use as both a logical (bitemporal) ID and a
 * physical primary key.
 */
export function deterministicId(...parts: string[]): string {
  const digest = createHash('sha1')
    .update(NAMESPACE)
    .update('\0')
    .update(parts.join('\0'))
    .digest();

  // RFC 4122 § 4.3 — version 5, variant 1 (10xxxxxx)
  digest.writeUInt8((digest.readUInt8(6) & 0x0f) | 0x50, 6);
  digest.writeUInt8((digest.readUInt8(8) & 0x3f) | 0x80, 8);

  return [
    digest.slice(0, 4).toString('hex'),
    digest.slice(4, 6).toString('hex'),
    digest.slice(6, 8).toString('hex'),
    digest.slice(8, 10).toString('hex'),
    digest.slice(10, 16).toString('hex'),
  ].join('-');
}
