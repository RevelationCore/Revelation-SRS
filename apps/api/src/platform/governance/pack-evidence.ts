import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';
import { examBoardPackCanonical, type ExamBoardPackHashInput } from '@revelation-srs/domain';

import { canonicalHash, sha256Tagged } from '../canonical-hash.js';
import { RULE_TYPE_DOMAIN, type RuleTypeCode, type RuleVersionCitation } from '../rules-engine/engine.js';

/**
 * Exam board pack evidence (Phase 5 D-36): the rule manifest a pack was
 * generated under, and the pack's content hash. Both use RFC 8785
 * canonical JSON and SHA-256, and both are versioned by `schema` so the
 * definition can change without invalidating hashes already recorded.
 */

export const RULE_MANIFEST_SCHEMA = 'revelation.rule-manifest.v1';

/** The rule types whose versions a board pack's manifest lists. */
const MANIFEST_DOMAINS = new Set(['assessment', 'progression', 'award']);
const MANIFEST_RULE_TYPES = (Object.keys(RULE_TYPE_DOMAIN) as RuleTypeCode[]).filter((t) => MANIFEST_DOMAINS.has(RULE_TYPE_DOMAIN[t])).sort();

type Tx = Pick<Db, 'execute'>;

export interface InForceRule {
  programmeId: string | null;
  ruleTypeCode: string;
  ruleKey: string;
  ruleId: string;
  versionId: string;
  value: unknown;
  validFrom: string;
  validTo: string | null;
  source: 'programme' | 'tenant-default';
}

export interface RuleManifestContent {
  schema: string;
  asOf: string;
  programmes: string[];
  inForce: InForceRule[];
  builtInDefaults: Array<{ ruleTypeCode: string; ruleKey: string | null; value: unknown }>;
  exceptions: Array<{ enrolmentId: string; exceptionId: string; ruleCode: string; exceptionTypeCode: string }>;
  cited: Array<{ versionId: string; ruleTypeCode: string }>;
  /** Cited versions that are no longer the version in force at asOf. */
  drift: Array<{ versionId: string; ruleTypeCode: string }>;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

/**
 * Builds a pack's rule manifest: for each programme in the pack and each
 * assessment, progression and award rule type, the version in force at
 * asOf (as known at asOf), the built-in defaults and rule exceptions the
 * pack's calculations used, and any cited version that has drifted.
 */
export async function buildRuleManifest(tx: Tx, tenantId: string, input: {
  asOf: Date; programmeIds: string[]; enrolmentIds: string[]; cited: RuleVersionCitation[];
}): Promise<RuleManifestContent> {
  const programmes = [...new Set(input.programmeIds)].sort();
  const asOf = input.asOf.toISOString();
  const rows = await tx.execute(sql`
    SELECT id, version_id, programme_id, rule_type_code, rule_key, rule_value, valid_from, valid_to
    FROM academic_rule
    WHERE tenant_id = ${tenantId}::uuid
      AND rule_type_code IN (${sql.join(MANIFEST_RULE_TYPES.map((t) => sql`${t}`), sql`, `)})
      AND ${programmes.length > 0 ? sql`(programme_id IS NULL OR programme_id IN (${sql.join(programmes.map((p) => sql`${p}::uuid`), sql`, `)}))` : sql`programme_id IS NULL`}
      AND valid_from <= ${asOf}::timestamptz AND (valid_to IS NULL OR valid_to > ${asOf}::timestamptz)
      AND recorded_at <= ${asOf}::timestamptz AND (recorded_until IS NULL OR recorded_until > ${asOf}::timestamptz)
  `) as unknown as Array<Record<string, unknown>>;

  // Per programme (and for programme-less candidates) a programme rule wins over the tenant default for the same type and key.
  const inForce: InForceRule[] = [];
  for (const programmeId of [null, ...programmes]) {
    const best = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (r['programme_id'] !== null && r['programme_id'] !== programmeId) continue;
      const key = `${String(r['rule_type_code'])}|${String(r['rule_key'])}`;
      const current = best.get(key);
      if (!current || (current['programme_id'] === null && r['programme_id'] !== null)) best.set(key, r);
    }
    for (const r of best.values()) {
      inForce.push({
        programmeId,
        ruleTypeCode: String(r['rule_type_code']),
        ruleKey: String(r['rule_key']),
        ruleId: String(r['id']),
        versionId: String(r['version_id']),
        value: r['rule_value'],
        validFrom: iso(r['valid_from'])!,
        validTo: iso(r['valid_to']),
        source: r['programme_id'] ? 'programme' : 'tenant-default',
      });
    }
  }
  inForce.sort((a, b) => `${a.programmeId ?? ''}|${a.ruleTypeCode}|${a.ruleKey}`.localeCompare(`${b.programmeId ?? ''}|${b.ruleTypeCode}|${b.ruleKey}`));

  const exceptionRows = input.enrolmentIds.length === 0 ? [] : await tx.execute(sql`
    SELECT id, enrolment_id, rule_code, exception_type_code FROM rule_exception
    WHERE tenant_id = ${tenantId}::uuid AND status_code = 'approved'
      AND enrolment_id IN (${sql.join(input.enrolmentIds.map((e) => sql`${e}::uuid`), sql`, `)})
      AND valid_from <= ${asOf.slice(0, 10)}::date AND (valid_to IS NULL OR valid_to > ${asOf.slice(0, 10)}::date)
  `) as unknown as Array<Record<string, unknown>>;

  const citedById = new Map<string, { versionId: string; ruleTypeCode: string }>();
  const defaults = new Map<string, { ruleTypeCode: string; ruleKey: string | null; value: unknown }>();
  for (const c of input.cited) {
    if (c.versionId) citedById.set(c.versionId, { versionId: c.versionId, ruleTypeCode: c.ruleTypeCode });
    if (c.source === 'built-in-default') defaults.set(`${c.ruleTypeCode}|${c.ruleKey ?? ''}`, { ruleTypeCode: c.ruleTypeCode, ruleKey: c.ruleKey, value: c.value });
  }
  const inForceIds = new Set(inForce.map((r) => r.versionId));
  const cited = [...citedById.values()].sort((a, b) => a.versionId.localeCompare(b.versionId));

  return {
    schema: RULE_MANIFEST_SCHEMA,
    asOf,
    programmes,
    inForce,
    builtInDefaults: [...defaults.values()].sort((a, b) => `${a.ruleTypeCode}|${a.ruleKey ?? ''}`.localeCompare(`${b.ruleTypeCode}|${b.ruleKey ?? ''}`)),
    exceptions: exceptionRows.map((r) => ({
      enrolmentId: String(r['enrolment_id']), exceptionId: String(r['id']), ruleCode: String(r['rule_code']), exceptionTypeCode: String(r['exception_type_code']),
    })).sort((a, b) => `${a.enrolmentId}|${a.exceptionId}`.localeCompare(`${b.enrolmentId}|${b.exceptionId}`)),
    cited,
    drift: cited.filter((c) => !inForceIds.has(c.versionId)),
  };
}

/** Stores a manifest by its hash (shared by every pack with the same rule basis) and returns the hash. */
export async function storeRuleManifest(tx: Tx, tenantId: string, content: RuleManifestContent): Promise<string> {
  const manifestHash = canonicalHash(content);
  await tx.execute(sql`
    INSERT INTO rule_manifest (tenant_id, manifest_hash, content)
    VALUES (${tenantId}::uuid, ${manifestHash}, ${JSON.stringify(content)}::jsonb)
    ON CONFLICT (tenant_id, manifest_hash) DO NOTHING
  `);
  return manifestHash;
}

export type PackHashInput = ExamBoardPackHashInput;

/** The pack hash (revelation.exam-board-pack.v1; see examBoardPackCanonical). */
export function packHash(input: PackHashInput): string {
  return sha256Tagged(examBoardPackCanonical(input));
}

/** Every rule version a pack's candidate profiles cite (their marks, results and recommendation). */
export function citedInProfiles(profiles: Array<{ profileData: Record<string, unknown> }>): RuleVersionCitation[] {
  const out: RuleVersionCitation[] = [];
  for (const p of profiles) {
    const regs = (p.profileData['moduleRegistrations'] ?? []) as Array<{ moduleResult: { ruleVersions?: RuleVersionCitation[] } | null; marks: Array<{ ruleVersions?: RuleVersionCitation[] }> }>;
    for (const r of regs) {
      out.push(...(r.moduleResult?.ruleVersions ?? []));
      for (const m of r.marks) out.push(...(m.ruleVersions ?? []));
    }
    const rec = p.profileData['preBoardRecommendation'] as { ruleVersions?: RuleVersionCitation[] } | undefined;
    out.push(...(rec?.ruleVersions ?? []));
  }
  return out;
}
