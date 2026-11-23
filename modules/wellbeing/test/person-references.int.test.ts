/** ADR-031 Guard (BL-354): every person column in the wellbeing schema is classified for merges. */
import { personColumnsQuery, personReferenceProblems, type SchemaPersonColumn } from '@revelation-srs/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WELLBEING_PERSON_REFERENCES } from '../src/person-references.js';

import { startTestApp } from './helpers/test-db.js';

let ctx: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => { ctx = await startTestApp(); }, 120_000);
afterAll(async () => { await ctx?.teardown(); });

describe('WELLBEING_PERSON_REFERENCES', () => {
  it('classifies every person column in the wellbeing schema, each once, with a mode that fits the table', async () => {
    const columns = (await ctx.db.execute(sql.raw(personColumnsQuery('wellbeing')))) as unknown as SchemaPersonColumn[];
    expect(columns.length).toBeGreaterThan(0);
    expect(personReferenceProblems(columns, WELLBEING_PERSON_REFERENCES)).toEqual([]);
  });
});
