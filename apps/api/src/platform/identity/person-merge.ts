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
