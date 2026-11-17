import { createHash } from 'node:crypto';

import { canonicalJson } from '@revelation-srs/domain';

/** SHA-256 of a value's RFC 8785 canonical JSON, as `sha256:<64 lowercase hex>` (Phase 5 D-36). */
export function canonicalHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

/** SHA-256 of already-canonical text, as `sha256:<hex>`. */
export function sha256Tagged(canonical: string): string {
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
