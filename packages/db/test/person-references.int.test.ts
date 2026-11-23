/**
 * ADR-031 Guard (BL-354): on a freshly migrated core database, every column
 * that references a person is classified for identity merges, and every
 * statutory identifier column is listed. A new person column fails here until
 * someone decides what a merge does with it.
 */
import { readFile } from 'node:fs/promises';

import { personColumnsQuery, personReferenceProblems, type SchemaPersonColumn } from '@revelation-srs/domain';
import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PERSON_REFERENCES, STATUTORY_IDENTIFIER_LINEAGE, STATUTORY_IDENTIFIERS } from '../src/person-references.js';
import { createDb, type Db } from '../src/pool.js';

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').withEnvironment({ POSTGRES_DB: 'srs_person_refs' }).start();
  db = createDb(container.getConnectionUri());
  const journal = JSON.parse(await readFile(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> };
  for (const { tag } of journal.entries) {
    await db.execute(sql.raw(await readFile(new URL(`../migrations/${tag}.sql`, import.meta.url), 'utf8')));
  }
});

afterAll(async () => { await container?.stop(); });

const schemaColumns = async (): Promise<SchemaPersonColumn[]> =>
  (await db.execute(sql.raw(personColumnsQuery('public')))) as unknown as SchemaPersonColumn[];

describe('PERSON_REFERENCES (ADR-031 item 5)', () => {
  it('classifies every person column in the core schema, each once, with a mode that fits the table', async () => {
    const columns = await schemaColumns();
    expect(columns.length).toBeGreaterThan(40);
    expect(personReferenceProblems(columns, PERSON_REFERENCES)).toEqual([]);
  });

  it('names the subject type of each polymorphic pair', () => {
    const pairs = PERSON_REFERENCES.filter((r) => r.column === 'subject_id');
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter((r) => r.subjectType !== 'person')).toEqual([]);
  });

  it('reports what the guard is for: an unclassified column, a missing one, and a mode on the wrong kind of table', () => {
    const schema: SchemaPersonColumn[] = [
      { table: 'enrolment', column: 'person_id', bitemporal: true },
      { table: 'new_thing', column: 'person_id', bitemporal: false },
      { table: 'fee_liability', column: 'person_id', bitemporal: false },
    ];
    expect(personReferenceProblems(schema, [
      { table: 'enrolment', column: 'person_id', mode: 'ledgered-move' },
      { table: 'fee_liability', column: 'person_id', mode: 'versioned-move' },
      { table: 'gone', column: 'person_id', mode: 'history-in-place' },
    ])).toEqual([
      'enrolment.person_id is ledgered-move, but enrolment is bitemporal: use versioned-move or survivor-chooses',
      'fee_liability.person_id is versioned-move, but fee_liability has no recorded_until',
      'gone.person_id is in the registry but not in the schema',
      'new_thing.person_id references a person but is not in the registry: classify it (ADR-031 item 5)',
    ]);
  });
});

describe('STATUTORY_IDENTIFIERS (ADR-031 item 4)', () => {
  it('lists the four classes, and every listed column exists', async () => {
    expect(Object.keys(STATUTORY_IDENTIFIERS).sort()).toEqual(['husid', 'slc-customer-reference', 'ucas-personal-id', 'uln']);
    const listed = [...Object.values(STATUTORY_IDENTIFIERS).flat(), ...STATUTORY_IDENTIFIER_LINEAGE];
    const rows = (await db.execute(sql`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns WHERE table_schema = 'public'`)) as unknown as Array<{ table: string; column: string }>;
    const exists = new Set(rows.map((r) => `${r.table}.${r.column}`));
    expect(listed.map((c) => `${c.table}.${c.column}`).filter((k) => !exists.has(k))).toEqual([]);
  });

  it('every column that looks like a statutory identifier is listed, as a current value or as lineage', async () => {
    const rows = (await db.execute(sql`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ~ '(husid|hesa_id|ucas_personal|ucas_pid|(^|_)uln($|_)|slc_customer|slc_ref)'`)) as unknown as Array<{ table: string; column: string }>;
    const listed = new Set([...Object.values(STATUTORY_IDENTIFIERS).flat(), ...STATUTORY_IDENTIFIER_LINEAGE].map((c) => `${c.table}.${c.column}`));
    expect(rows.map((r) => `${r.table}.${r.column}`).filter((k) => !listed.has(k)).sort()).toEqual([]);
  });
});
