/**
 * SRS value-set lookup client.
 *
 * Core SRS is the sole owner of tenant-configurable value sets (see
 * docs — "all dropdown fields must be backed by the value-set system").
 * Rather than replicate that schema and its seed data into this module,
 * the attendance module reads it via the existing public read endpoint:
 *
 *   GET /api/v1/fields/:entity/:field/value-set?activeAt=
 *
 * Results are cached in memory per (tenantId, entity, field) for a short
 * TTL, since value sets change rarely relative to request volume.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface ValueSetMember {
  code: string;
}

interface CacheEntry {
  members:   Set<string> | null; // null = no value set registered (non-constraining)
  expiresAt: number;
}

export interface ValueSetClient {
  /**
   * Returns true if the code is active and known for the field, false if it
   * is known but not valid, or null if no value set is registered for the
   * field (non-constraining) — mirrors ValueSetService.validateFieldValue
   * in apps/api/src/platform/value-sets/service.ts.
   */
  validateFieldValue(
    entityName: string,
    fieldName:  string,
    value:      string,
    tenantId:   string,
    authToken:  string,
    asAt?:      Date,
  ): Promise<boolean | null>;
}

export class SrsValueSetHttpClient implements ValueSetClient {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly srsApiUrl: string) {}

  async validateFieldValue(
    entityName: string,
    fieldName:  string,
    value:      string,
    tenantId:   string,
    authToken:  string,
    asAt?:      Date,
  ): Promise<boolean | null> {
    const key = `${tenantId}:${entityName}:${fieldName}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.members === null ? null : cached.members.has(value);
    }

    const url = new URL(`${this.srsApiUrl}/api/v1/fields/${entityName}/${fieldName}/value-set`);
    if (asAt) url.searchParams.set('activeAt', asAt.toISOString());

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${authToken}` },
    });

    if (res.status === 404) {
      this.cache.set(key, { members: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!res.ok) {
      throw new Error(`SRS value-set lookup failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { members: ValueSetMember[] };
    const members = new Set(data.members.map((m) => m.code));
    this.cache.set(key, { members, expiresAt: Date.now() + CACHE_TTL_MS });
    return members.has(value);
  }
}

// ── Stub for development and tests ────────────────────────────────────────────

export class SrsValueSetStubClient implements ValueSetClient {
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateFieldValue(): Promise<boolean | null> {
    return true;
  }
}
