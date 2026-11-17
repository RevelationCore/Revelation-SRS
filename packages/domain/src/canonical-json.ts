/**
 * RFC 8785 JSON Canonicalization Scheme (Phase 5 D-36): object keys sorted
 * recursively by UTF-16 code units, ECMAScript number and string
 * serialisation, no whitespace. Refuses values JSON cannot represent
 * exactly (undefined, NaN, Infinity, functions, symbols, bigints) and
 * objects that are not plain (Dates must be ISO strings first).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Cannot canonicalise the number ${String(value)}`);
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`Cannot canonicalise a ${(value).constructor?.name ?? 'non-plain'} object; convert it first`);
      }
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [k, v] of entries) if (v === undefined) throw new TypeError(`Cannot canonicalise undefined at key '${k}'`);
      // Default string comparison is by UTF-16 code unit, as RFC 8785 section 3.2.3 requires.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalise a value of type ${typeof value}`);
  }
}

/** The pack hash definition (Phase 5 D-36), versioned so it can change without invalidating recorded hashes. */
export const EXAM_BOARD_PACK_HASH_SCHEMA = 'revelation.exam-board-pack.v1';

export interface ExamBoardPackHashInput {
  tenantId: string;
  examBoardId: string;
  dataPackId: string;
  packVersion: number;
  sourceTransactionTime: Date | string;
  ruleManifestRef: string | null;
  candidates: Array<{ enrolmentId: string; personId: string; profileData: unknown }>;
}

/**
 * The canonical text a data pack's SHA-256 hash is taken over. Each
 * profile goes through a JSON round trip first, so a hash recomputed from
 * the stored jsonb gives the same value as one computed at generation;
 * candidates are ordered by enrolment, then by their canonical profile.
 */
export function examBoardPackCanonical(input: ExamBoardPackHashInput): string {
  const candidates = input.candidates.map((c) => {
    const profileData = JSON.parse(JSON.stringify(c.profileData)) as unknown;
    return { enrolmentId: c.enrolmentId, personId: c.personId, profileData, key: canonicalJson(profileData) };
  }).sort((a, b) => (a.enrolmentId < b.enrolmentId ? -1 : a.enrolmentId > b.enrolmentId ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return canonicalJson({
    schema: EXAM_BOARD_PACK_HASH_SCHEMA,
    tenantId: input.tenantId,
    examBoardId: input.examBoardId,
    dataPackId: input.dataPackId,
    packVersion: input.packVersion,
    sourceTransactionTime: new Date(input.sourceTransactionTime).toISOString(),
    ruleManifestRef: input.ruleManifestRef,
    candidates: candidates.map(({ key: _key, ...c }) => c),
  });
}
