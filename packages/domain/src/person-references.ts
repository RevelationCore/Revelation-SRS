/**
 * ADR-031 item 5: how an identity merge treats each column that references a
 * person. Core and each module keep a registry of their own columns; a guard
 * test fails when the schema has a person column the registry does not
 * classify, so a new table cannot be silently left behind by a merge.
 */

/**
 * - `versioned-move`: a bitemporal ownership table; the merge closes each
 *   current version and writes the same version for the survivor.
 * - `survivor-chooses`: a one-per-person bitemporal fact; the proposal's
 *   fact choice decides which person's version the survivor keeps.
 * - `ledgered-move`: a non-bitemporal current-state table; rows are updated
 *   to the survivor and each move is recorded, so unmerge can undo it.
 * - `history-in-place`: a record of what happened to whom, or of who acted;
 *   left as it is, and read through the survivor's aliases.
 * - `identity-infra`: the merge machinery itself.
 */
export type PersonReferenceMode =
  | 'versioned-move'
  | 'survivor-chooses'
  | 'ledgered-move'
  | 'history-in-place'
  | 'identity-infra';

export interface PersonReference {
  table: string;
  /** The person column, or the id column of a subject_type/subject_id pair. */
  column: string;
  mode: PersonReferenceMode;
  /** For a polymorphic pair: the subject_type value that means a person. */
  subjectType?: string;
  /** Why this mode, where it is not obvious from the table. */
  note?: string;
}

/** A person column found in the schema, from information_schema. */
export interface SchemaPersonColumn {
  table: string;
  column: string;
  /** The table has recorded_until, so it is bitemporal. */
  bitemporal: boolean;
}

/**
 * The guard: every person column in the schema is classified exactly once,
 * every registry entry names a column that exists, and versioned modes are
 * used only on bitemporal tables (and the move modes only off them).
 */
export function personReferenceProblems(schema: SchemaPersonColumn[], registry: readonly PersonReference[]): string[] {
  const problems: string[] = [];
  const key = (t: string, c: string) => `${t}.${c}`;
  const found = new Map(schema.map((s) => [key(s.table, s.column), s]));
  const seen = new Set<string>();

  for (const entry of registry) {
    const k = key(entry.table, entry.column);
    if (seen.has(k)) problems.push(`${k} is classified more than once`);
    seen.add(k);
    const column = found.get(k);
    if (!column) { problems.push(`${k} is in the registry but not in the schema`); continue; }
    if ((entry.mode === 'versioned-move' || entry.mode === 'survivor-chooses') && !column.bitemporal) {
      problems.push(`${k} is ${entry.mode}, but ${entry.table} has no recorded_until`);
    }
    if (entry.mode === 'ledgered-move' && column.bitemporal) {
      problems.push(`${k} is ledgered-move, but ${entry.table} is bitemporal: use versioned-move or survivor-chooses`);
    }
  }
  for (const s of schema) {
    const k = key(s.table, s.column);
    if (!seen.has(k)) problems.push(`${k} references a person but is not in the registry: classify it (ADR-031 item 5)`);
  }
  return problems.sort();
}

/** SQL that lists a schema's person columns for personReferenceProblems: `%person_id` columns and subject_type/subject_id pairs. */
export function personColumnsQuery(schemaName: string): string {
  if (!/^[a-z_]+$/.test(schemaName)) throw new Error(`Unexpected schema name ${schemaName}`);
  return `
    SELECT c.table_name AS "table", c.column_name AS "column",
           EXISTS (SELECT 1 FROM information_schema.columns r
                   WHERE r.table_schema = c.table_schema AND r.table_name = c.table_name AND r.column_name = 'recorded_until') AS "bitemporal"
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = '${schemaName}'
      AND (c.column_name LIKE '%person\\_id' ESCAPE '\\'
           OR (c.column_name = 'subject_id' AND EXISTS (
                SELECT 1 FROM information_schema.columns s
                WHERE s.table_schema = c.table_schema AND s.table_name = c.table_name AND s.column_name = 'subject_type')))
    ORDER BY 1, 2`;
}
