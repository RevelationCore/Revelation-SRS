import type { PersonReference } from './person-references.js';

/**
 * The parts of a SQL client this needs, so the domain package stays free of
 * a database dependency: each module passes drizzle's `sql` tag, its
 * transaction's execute, and a savepoint.
 */
export interface MergeSqlKit<Q> {
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Q;
    identifier(name: string): Q;
    join(chunks: Q[], separator: Q): Q;
  };
  execute(query: Q): Promise<unknown>;
  /**
   * Runs fn in a savepoint, with an executor bound to it: a failure inside
   * rolls back only fn. Use the client's own savepoint API (drizzle's nested
   * transaction): postgres.js aborts the whole transaction on any failed
   * query outside one, even if the error is caught.
   */
  savepoint<T>(fn: (execute: (query: Q) => Promise<unknown>) => Promise<T>): Promise<T>;
}

export interface ApplyMergeInput {
  /** The module's Postgres schema, e.g. 'wellbeing'. */
  schema: string;
  registry: readonly PersonReference[];
  tenantId: string;
  mergeId: string;
  survivorPersonId: string;
  mergedPersonId: string;
  now: Date;
}

export interface ApplyMergeResult {
  /** True when this merge had already been applied here: nothing was done. */
  alreadyApplied: boolean;
  /** Rows moved, per table.column. */
  moved: Record<string, number>;
  /**
   * Ledgered columns left on the merged person because the survivor already
   * has the one row the table allows per person (a projection, say). The
   * row stays resolvable through the core redirect.
   */
  kept: string[];
}

const SCHEMA = /^[a-z_]+$/;

/**
 * ADR-031 item 7 (BL-358): a module applies srs.person.merged to its own
 * schema, by the same modes as core (versioned-move and ledgered-move; the
 * modules have no one-per-person facts), records each move in
 * <schema>.person_merge_move, and marks the merge applied in
 * <schema>.person_merge_applied. Idempotent by mergeId. Call it inside the
 * transaction that handles the event.
 */
export async function applyPersonMerge<Q>(kit: MergeSqlKit<Q>, input: ApplyMergeInput): Promise<ApplyMergeResult> {
  if (!SCHEMA.test(input.schema)) throw new Error(`Unexpected schema ${input.schema}`);
  const { sql } = kit;
  const table = (name: string) => sql`${sql.identifier(input.schema)}.${sql.identifier(name)}`;
  const rows = async <T>(q: Q) => (await kit.execute(q)) as T[];

  const applied = await rows<{ merge_id: string }>(sql`INSERT INTO ${table('person_merge_applied')} (tenant_id, merge_id, applied_at)
    VALUES (${input.tenantId}::uuid, ${input.mergeId}::uuid, ${input.now}) ON CONFLICT (tenant_id, merge_id) DO NOTHING RETURNING merge_id::text`);
  if (applied.length === 0) return { alreadyApplied: true, moved: {}, kept: [] };

  const moved: Record<string, number> = {};
  const kept: string[] = [];
  const record = async (ref: PersonReference, moves: Array<{ rowKey: string; closedVersionId?: string; newVersionId?: string }>) => {
    if (moves.length === 0) return;
    moved[`${ref.table}.${ref.column}`] = moves.length;
    for (const m of moves) {
      await kit.execute(sql`INSERT INTO ${table('person_merge_move')}
        (tenant_id, merge_id, table_name, column_name, row_key, mode, from_person_id, to_person_id, closed_version_id, new_version_id)
        VALUES (${input.tenantId}::uuid, ${input.mergeId}::uuid, ${ref.table}, ${ref.column}, ${m.rowKey}, ${ref.mode},
          ${input.mergedPersonId}::uuid, ${input.survivorPersonId}::uuid, ${m.closedVersionId ?? null}::uuid, ${m.newVersionId ?? null}::uuid)`);
    }
  };

  for (const ref of input.registry) {
    const column = sql.identifier(ref.column);
    if (ref.mode === 'ledgered-move') {
      // The row key is the primary key (columns joined by '|'), so unmerge can find the row again.
      const pk = (await rows<{ column_name: string }>(sql`SELECT a.attname AS column_name
        FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary AND i.indrelid = ${`${input.schema}.${ref.table}`}::regclass ORDER BY array_position(i.indkey, a.attnum)`)).map((c) => c.column_name);
      if (pk.length === 0) throw new Error(`${input.schema}.${ref.table} has no primary key to record moves by`);
      const key = sql.join(pk.map((c) => sql`${sql.identifier(c)}::text`), sql` || '|' || `);
      try {
        const updated = await kit.savepoint(async (execute) => (await execute(sql`UPDATE ${table(ref.table)} SET ${column} = ${input.survivorPersonId}::uuid
          WHERE tenant_id = ${input.tenantId}::uuid AND ${column} = ${input.mergedPersonId}::uuid RETURNING ${key} AS key`)) as Array<{ key: string }>);
        await record(ref, updated.map((u) => ({ rowKey: u.key })));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        kept.push(`${ref.table}.${ref.column}`);
      }
      continue;
    }
    if (ref.mode !== 'versioned-move') continue;

    const columns = (await rows<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${input.schema} AND table_name = ${ref.table} AND is_generated = 'NEVER' AND is_identity = 'NO'
      ORDER BY ordinal_position`)).map((c) => c.column_name);
    const current = await rows<{ version_id: string; id: string }>(sql`SELECT version_id::text, id::text FROM ${table(ref.table)}
      WHERE tenant_id = ${input.tenantId}::uuid AND ${column} = ${input.mergedPersonId}::uuid AND recorded_until IS NULL FOR UPDATE`);
    const moves = [];
    for (const row of current) {
      const newVersionId = await newUuid(kit);
      await kit.execute(sql`UPDATE ${table(ref.table)} SET recorded_until = ${input.now} WHERE version_id = ${row.version_id}::uuid`);
      const targets = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
      const values = sql.join(columns.map((c) => {
        if (c === 'version_id') return sql`${newVersionId}::uuid`;
        if (c === ref.column) return sql`${input.survivorPersonId}::uuid`;
        if (c === 'recorded_at') return sql`${input.now}`;
        if (c === 'recorded_until') return sql`NULL`;
        return sql.identifier(c);
      }), sql`, `);
      await kit.execute(sql`INSERT INTO ${table(ref.table)} (${targets}) SELECT ${values} FROM ${table(ref.table)} WHERE version_id = ${row.version_id}::uuid`);
      moves.push({ rowKey: row.id, closedVersionId: row.version_id, newVersionId });
    }
    await record(ref, moves);
  }
  return { alreadyApplied: false, moved, kept: kept.sort() };
}

async function newUuid<Q>(kit: MergeSqlKit<Q>): Promise<string> {
  const [row] = (await kit.execute(kit.sql`SELECT gen_random_uuid()::text AS id`)) as Array<{ id: string }>;
  return row!.id;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface ReverseMergeInput {
  schema: string;
  registry: readonly PersonReference[];
  tenantId: string;
  mergeId: string;
  survivorPersonId: string;
  restoredPersonId: string;
  /** From srs.person.unmerged: core ids the decision gave to the restored person, per core table. */
  reallocatedToRestored: Record<string, string[]>;
  now: Date;
}

export interface ReverseMergeResult {
  /** True when this merge was never applied here, or was already reversed: nothing was done. */
  skipped: boolean;
  reversed: number;
  /** Rows of post-merge enrolments given to the restored person. */
  reallocated: number;
}

/**
 * ADR-031 item 10 (BL-359): a module reverses srs.person.merged when the
 * merge is undone. Each recorded move is set back if the row still belongs
 * to the survivor (versioned rows get a new version, ledgered rows are
 * updated). Rows the module holds for enrolments the decision gave to the
 * restored person (reallocatedToRestored.enrolment) follow them. Idempotent:
 * person_merge_applied.unmerged_at marks it done.
 */
export async function reversePersonMerge<Q>(kit: MergeSqlKit<Q>, input: ReverseMergeInput): Promise<ReverseMergeResult> {
  if (!SCHEMA.test(input.schema)) throw new Error(`Unexpected schema ${input.schema}`);
  const { sql } = kit;
  const table = (name: string) => sql`${sql.identifier(input.schema)}.${sql.identifier(name)}`;
  const rows = async <T>(q: Q) => (await kit.execute(q)) as T[];

  const marked = await rows<{ merge_id: string }>(sql`UPDATE ${table('person_merge_applied')} SET unmerged_at = ${input.now}
    WHERE tenant_id = ${input.tenantId}::uuid AND merge_id = ${input.mergeId}::uuid AND unmerged_at IS NULL RETURNING merge_id::text`);
  if (marked.length === 0) return { skipped: true, reversed: 0, reallocated: 0 };

  const refOf = (t: string, c: string) => input.registry.find((r) => r.table === t && r.column === c);
  const moves = await rows<{ table_name: string; column_name: string; row_key: string }>(sql`SELECT table_name, column_name, row_key
    FROM ${table('person_merge_move')} WHERE tenant_id = ${input.tenantId}::uuid AND merge_id = ${input.mergeId}::uuid`);
  let reversed = 0;
  for (const m of moves) {
    const ref = refOf(m.table_name, m.column_name);
    if (!ref) continue;
    if (ref.mode === 'ledgered-move') {
      const key = sql.join((await primaryKey(kit, input.schema, ref.table)).map((c) => sql`${sql.identifier(c)}::text`), sql` || '|' || `);
      reversed += (await rows(sql`UPDATE ${table(ref.table)} SET ${sql.identifier(ref.column)} = ${input.restoredPersonId}::uuid
        WHERE tenant_id = ${input.tenantId}::uuid AND ${key} = ${m.row_key} AND ${sql.identifier(ref.column)} = ${input.survivorPersonId}::uuid RETURNING 1`)).length;
    } else if (ref.mode === 'versioned-move') {
      reversed += await moveCurrentVersions(kit, input, ref, sql`id::text = ${m.row_key}`, input.survivorPersonId, input.restoredPersonId);
    }
  }

  let reallocated = 0;
  const enrolments = input.reallocatedToRestored['enrolment'] ?? [];
  if (enrolments.length > 0) {
    const list = sql.join(enrolments.map((e) => sql`${e}::uuid`), sql`, `);
    for (const ref of input.registry) {
      if (ref.mode !== 'ledgered-move' && ref.mode !== 'versioned-move') continue;
      const columns = await columnsOf(kit, input.schema, ref.table);
      if (!columns.includes('enrolment_id')) continue;
      if (ref.mode === 'ledgered-move') {
        reallocated += (await rows(sql`UPDATE ${table(ref.table)} SET ${sql.identifier(ref.column)} = ${input.restoredPersonId}::uuid
          WHERE tenant_id = ${input.tenantId}::uuid AND enrolment_id IN (${list}) AND ${sql.identifier(ref.column)} = ${input.survivorPersonId}::uuid RETURNING 1`)).length;
      } else {
        reallocated += await moveCurrentVersions(kit, input, ref, sql`enrolment_id IN (${list})`, input.survivorPersonId, input.restoredPersonId);
      }
    }
  }
  return { skipped: false, reversed, reallocated };
}

/** Closes each matching current version owned by `from` and writes the same version for `to`. */
async function moveCurrentVersions<Q>(kit: MergeSqlKit<Q>, input: { schema: string; tenantId: string; now: Date }, ref: PersonReference, where: Q, from: string, to: string): Promise<number> {
  const { sql } = kit;
  const table = sql`${sql.identifier(input.schema)}.${sql.identifier(ref.table)}`;
  const column = sql.identifier(ref.column);
  const columns = await columnsOf(kit, input.schema, ref.table);
  const current = (await kit.execute(sql`SELECT version_id::text FROM ${table}
    WHERE tenant_id = ${input.tenantId}::uuid AND ${column} = ${from}::uuid AND recorded_until IS NULL AND ${where} FOR UPDATE`)) as Array<{ version_id: string }>;
  for (const row of current) {
    const newVersionId = await newUuid(kit);
    await kit.execute(sql`UPDATE ${table} SET recorded_until = ${input.now} WHERE version_id = ${row.version_id}::uuid`);
    const targets = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
    const values = sql.join(columns.map((c) => {
      if (c === 'version_id') return sql`${newVersionId}::uuid`;
      if (c === ref.column) return sql`${to}::uuid`;
      if (c === 'recorded_at') return sql`${input.now}`;
      if (c === 'recorded_until') return sql`NULL`;
      return sql.identifier(c);
    }), sql`, `);
    await kit.execute(sql`INSERT INTO ${table} (${targets}) SELECT ${values} FROM ${table} WHERE version_id = ${row.version_id}::uuid`);
  }
  return current.length;
}

async function columnsOf<Q>(kit: MergeSqlKit<Q>, schema: string, table: string): Promise<string[]> {
  const rows = (await kit.execute(kit.sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table} AND is_generated = 'NEVER' AND is_identity = 'NO' ORDER BY ordinal_position`)) as Array<{ column_name: string }>;
  return rows.map((r) => r.column_name);
}

async function primaryKey<Q>(kit: MergeSqlKit<Q>, schema: string, table: string): Promise<string[]> {
  const rows = (await kit.execute(kit.sql`SELECT a.attname AS column_name
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary AND i.indrelid = ${`${schema}.${table}`}::regclass ORDER BY array_position(i.indkey, a.attnum)`)) as Array<{ column_name: string }>;
  if (rows.length === 0) throw new Error(`${schema}.${table} has no primary key`);
  return rows.map((r) => r.column_name);
}
