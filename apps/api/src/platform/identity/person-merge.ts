import { randomUUID } from 'node:crypto';

import { identityMergeMoves, PERSON_REFERENCES, type TenantScopedDb } from '@revelation-srs/db';
import type { PersonReference } from '@revelation-srs/domain';
import { sql } from 'drizzle-orm';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** Which fact a merge keeps for a one-per-person table (ADR-031 item 5). */
const FACT_CLASS_BY_TABLE: Record<string, string> = {
  person_identity: 'person-identity',
  student_regulatory_profile: 'regulatory-profile',
};

export interface MergeMoveInput {
  tenantId: string;
  mergeId: string;
  survivorPersonId: string;
  mergedPersonId: string;
  /** For each one-per-person fact class: whose current version the survivor keeps. Default 'survivor'. */
  factChoices: Record<string, 'survivor' | 'merged'>;
  now: Date;
}

/** Rows moved, per table, for the audit summary. */
export type MergeMoveCounts = Record<string, number>;

/**
 * Applies ADR-031 item 5 inside the merge decision's transaction: for every
 * column in PERSON_REFERENCES that references the merged person, the
 * survivor takes current ownership and each move is recorded, so an unmerge
 * can reverse exactly what was done. History is left in place.
 *
 * - versioned-move: each current version is closed (recorded_until = now)
 *   and an identical version written for the survivor, with the same valid
 *   period: a transaction-time correction. As-recorded history before the
 *   merge still shows the merged person.
 * - survivor-chooses: the merged person's current version is closed and not
 *   moved; if the proposal chose it, the survivor's current version is closed
 *   and a copy of the merged person's values written for the survivor.
 * - ledgered-move: the column is updated to the survivor.
 * - history-in-place and identity-infra: nothing.
 */
export async function moveToSurvivor(tx: TenantScopedDb, input: MergeMoveInput): Promise<MergeMoveCounts> {
  const counts: MergeMoveCounts = {};
  const record = async (ref: PersonReference, moves: Array<{ rowKey: string; closedVersionId?: string | null; newVersionId?: string | null }>) => {
    if (moves.length === 0) return;
    counts[`${ref.table}.${ref.column}`] = moves.length;
    await tx.insert(identityMergeMoves).values(moves.map((m) => ({
      id: randomUUID(), tenantId: input.tenantId as Uuid, mergeId: input.mergeId as Uuid,
      tableName: ref.table, columnName: ref.column, rowKey: m.rowKey, mode: ref.mode,
      fromPersonId: input.mergedPersonId as Uuid, toPersonId: input.survivorPersonId as Uuid,
      closedVersionId: (m.closedVersionId ?? null) as Uuid | null, newVersionId: (m.newVersionId ?? null) as Uuid | null,
    })));
  };

  for (const ref of PERSON_REFERENCES) {
    if (ref.mode === 'history-in-place' || ref.mode === 'identity-infra') continue;
    const table = sql.identifier(ref.table);
    const column = sql.identifier(ref.column);
    const subject = ref.subjectType ? sql` AND subject_type = ${ref.subjectType}` : sql``;

    if (ref.mode === 'ledgered-move') {
      const rows = await tx.execute(sql`UPDATE ${table} SET ${column} = ${input.survivorPersonId}::uuid
        WHERE tenant_id = ${input.tenantId}::uuid AND ${column} = ${input.mergedPersonId}::uuid${subject}
        RETURNING id::text AS key`) as unknown as Array<{ key: string }>;
      await record(ref, rows.map((r) => ({ rowKey: r.key })));
      continue;
    }

    const current = (personId: string) => tx.execute(sql`SELECT version_id::text AS version_id, id::text AS id FROM ${table}
      WHERE tenant_id = ${input.tenantId}::uuid AND ${column} = ${personId}::uuid AND recorded_until IS NULL${subject}
      FOR UPDATE`) as unknown as Promise<Array<{ version_id: string; id: string }>>;
    const columns = await copyableColumns(tx, ref.table);

    if (ref.mode === 'versioned-move') {
      const moves = [];
      for (const row of await current(input.mergedPersonId)) {
        const newVersionId = await copyVersion(tx, ref, columns, row.version_id, input.survivorPersonId, input.now);
        moves.push({ rowKey: row.id, closedVersionId: row.version_id, newVersionId });
      }
      await record(ref, moves);
      continue;
    }

    // survivor-chooses
    const choice = input.factChoices[FACT_CLASS_BY_TABLE[ref.table] ?? ''] ?? 'survivor';
    const mergedRows = await current(input.mergedPersonId);
    const moves = [];
    if (choice === 'merged' && mergedRows.length > 0) {
      for (const row of await current(input.survivorPersonId)) {
        await tx.execute(sql`UPDATE ${table} SET recorded_until = ${input.now} WHERE version_id = ${row.version_id}::uuid`);
        // Unmerge restores the survivor's own version from closedVersionId.
        moves.push({ rowKey: row.id, closedVersionId: row.version_id, newVersionId: null });
      }
      for (const row of mergedRows) {
        const newVersionId = await copyVersion(tx, ref, columns, row.version_id, input.survivorPersonId, input.now, randomUUID());
        moves.push({ rowKey: row.id, closedVersionId: row.version_id, newVersionId });
      }
    } else {
      for (const row of mergedRows) {
        await tx.execute(sql`UPDATE ${table} SET recorded_until = ${input.now} WHERE version_id = ${row.version_id}::uuid`);
        moves.push({ rowKey: row.id, closedVersionId: row.version_id, newVersionId: null });
      }
    }
    await record(ref, moves);
  }
  return counts;
}

/**
 * Closes a version and writes its copy for the survivor, with the same valid
 * period. A survivor-chooses copy takes a new logical id, as it becomes a new
 * fact of the survivor's rather than a continuation of the merged one.
 */
async function copyVersion(tx: TenantScopedDb, ref: PersonReference, columns: string[], versionId: string, survivorPersonId: string, now: Date, newLogicalId?: string): Promise<string> {
  const table = sql.identifier(ref.table);
  await tx.execute(sql`UPDATE ${table} SET recorded_until = ${now} WHERE version_id = ${versionId}::uuid`);
  const newVersionId = randomUUID();
  const targets = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
  const values = sql.join(columns.map((c) => {
    if (c === 'version_id') return sql`${newVersionId}::uuid`;
    if (c === ref.column) return sql`${survivorPersonId}::uuid`;
    if (c === 'id' && newLogicalId) return sql`${newLogicalId}::uuid`;
    if (c === 'recorded_at') return sql`${now}`;
    if (c === 'recorded_until') return sql`NULL`;
    return sql.identifier(c);
  }), sql`, `);
  await tx.execute(sql`INSERT INTO ${table} (${targets}) SELECT ${values} FROM ${table} WHERE version_id = ${versionId}::uuid`);
  return newVersionId;
}

const columnCache = new Map<string, string[]>();
async function copyableColumns(tx: TenantScopedDb, table: string): Promise<string[]> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = await tx.execute(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER' AND is_identity = 'NO'
    ORDER BY ordinal_position`) as unknown as Array<{ column_name: string }>;
  const columns = rows.map((r) => r.column_name);
  columnCache.set(table, columns);
  return columns;
}

export interface PostMergeRecord {
  /** `<table>.<column>:<rowKey>`, the key an unmerge proposal allocates by. */
  key: string;
  table: string;
  column: string;
  rowKey: string;
}

/**
 * ADR-031 item 10: records created on (or moved to) the survivor after the
 * merge that the merge did not move, which an unmerge proposal allocates to
 * the survivor or the restored person. A bitemporal row counts when its first
 * version was recorded after the merge; a current-state row when it has a
 * created_at after the merge (tables without one cannot be told apart and
 * stay with the survivor).
 */
export async function postMergeRecords(tx: TenantScopedDb, input: { tenantId: string; mergeId: string; survivorPersonId: string; effectiveAt: Date }): Promise<PostMergeRecord[]> {
  const out: PostMergeRecord[] = [];
  for (const ref of PERSON_REFERENCES) {
    if (ref.mode !== 'versioned-move' && ref.mode !== 'ledgered-move') continue;
    const table = sql.identifier(ref.table);
    const column = sql.identifier(ref.column);
    const subject = ref.subjectType ? sql` AND t.subject_type = ${ref.subjectType}` : sql``;
    const notMoved = sql`t.id::text NOT IN (SELECT row_key FROM identity_merge_move WHERE merge_id = ${input.mergeId}::uuid AND table_name = ${ref.table} AND column_name = ${ref.column})`;
    let rows: Array<{ key: string }>;
    if (ref.mode === 'versioned-move') {
      rows = await tx.execute(sql`SELECT DISTINCT t.id::text AS key FROM ${table} t
        WHERE t.tenant_id = ${input.tenantId}::uuid AND t.${column} = ${input.survivorPersonId}::uuid AND t.recorded_until IS NULL${subject}
          AND ${notMoved}
          AND (SELECT min(f.recorded_at) FROM ${table} f WHERE f.tenant_id = t.tenant_id AND f.id = t.id) > ${input.effectiveAt}`) as unknown as Array<{ key: string }>;
    } else {
      const hasCreatedAt = (await copyableColumns(tx, ref.table)).includes('created_at');
      if (!hasCreatedAt) continue;
      rows = await tx.execute(sql`SELECT t.id::text AS key FROM ${table} t
        WHERE t.tenant_id = ${input.tenantId}::uuid AND t.${column} = ${input.survivorPersonId}::uuid${subject}
          AND ${notMoved} AND t.created_at > ${input.effectiveAt}`) as unknown as Array<{ key: string }>;
    }
    for (const r of rows) out.push({ key: `${ref.table}.${ref.column}:${r.key}`, table: ref.table, column: ref.column, rowKey: r.key });
  }
  return out;
}

export interface ReverseInput {
  tenantId: string;
  mergeId: string;
  survivorPersonId: string;
  restoredPersonId: string;
  /** Post-merge records the decision gives to the restored person. */
  toRestored: PostMergeRecord[];
  now: Date;
}

/**
 * ADR-031 item 10, inside the unmerge decision's transaction: reverses each
 * move the merge recorded, then gives the restored person the post-merge
 * records allocated to them. Rows that have since moved elsewhere are left.
 * - versioned-move: if the row's current version is still the survivor's, a
 *   new version is written back to the restored person.
 * - ledgered-move: the row is set back if it still points at the survivor.
 * - survivor-chooses: the survivor's copy (if any) is closed and each closed
 *   version is restored as current, on the person it belonged to.
 * Returns, per table, the ids reallocated to the restored person.
 */
export async function reverseMoves(tx: TenantScopedDb, input: ReverseInput): Promise<Record<string, string[]>> {
  const moves = await tx.execute(sql`SELECT table_name, column_name, row_key, mode, closed_version_id::text AS closed, new_version_id::text AS created
    FROM identity_merge_move WHERE tenant_id = ${input.tenantId}::uuid AND merge_id = ${input.mergeId}::uuid ORDER BY table_name, mode DESC`) as unknown as Array<{ table_name: string; column_name: string; row_key: string; mode: string; closed: string | null; created: string | null }>;
  const refOf = (table: string, column: string) => PERSON_REFERENCES.find((r) => r.table === table && r.column === column);

  const moveBack = async (ref: PersonReference, rowKey: string) => {
    const table = sql.identifier(ref.table);
    const column = sql.identifier(ref.column);
    if (ref.mode === 'ledgered-move') {
      await tx.execute(sql`UPDATE ${table} SET ${column} = ${input.restoredPersonId}::uuid
        WHERE tenant_id = ${input.tenantId}::uuid AND id::text = ${rowKey} AND ${column} = ${input.survivorPersonId}::uuid`);
      return;
    }
    const [current] = await tx.execute(sql`SELECT version_id::text AS version_id FROM ${table}
      WHERE tenant_id = ${input.tenantId}::uuid AND id::text = ${rowKey} AND recorded_until IS NULL AND ${column} = ${input.survivorPersonId}::uuid FOR UPDATE`) as unknown as Array<{ version_id: string }>;
    if (current) await copyVersion(tx, ref, await copyableColumns(tx, ref.table), current.version_id, input.restoredPersonId, input.now);
  };

  for (const m of moves) {
    const ref = refOf(m.table_name, m.column_name);
    if (!ref) continue;
    if (m.mode === 'survivor-chooses') {
      const table = sql.identifier(ref.table);
      if (m.created) await tx.execute(sql`UPDATE ${table} SET recorded_until = ${input.now} WHERE version_id = ${m.created}::uuid AND recorded_until IS NULL`);
      if (m.closed) {
        const columns = await copyableColumns(tx, ref.table);
        const targets = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
        const values = sql.join(columns.map((c) => {
          if (c === 'version_id') return sql`${randomUUID()}::uuid`;
          if (c === 'recorded_at') return sql`${input.now}`;
          if (c === 'recorded_until') return sql`NULL`;
          return sql.identifier(c);
        }), sql`, `);
        await tx.execute(sql`INSERT INTO ${table} (${targets}) SELECT ${values} FROM ${table} WHERE version_id = ${m.closed}::uuid`);
      }
      continue;
    }
    await moveBack(ref, m.row_key);
  }

  const reallocated: Record<string, string[]> = {};
  for (const r of input.toRestored) {
    const ref = refOf(r.table, r.column);
    if (!ref) continue;
    await moveBack(ref, r.rowKey);
    (reallocated[r.table] ??= []).push(r.rowKey);
  }
  return reallocated;
}
