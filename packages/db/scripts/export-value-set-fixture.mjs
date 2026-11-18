#!/usr/bin/env node
// Writes test/fixtures/value-sets.json: every field's value set, as the API's
// field lookup returns it (platform values, no tenant overrides). Component
// tests serve it by default, so screens show real labels and offer real
// options without each test mocking them.
//
//   DATABASE_URL=postgres://... pnpm fixtures:value-sets
//
// Run against a database with every core migration applied.
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1 });
const rows = await sql`
  SELECT f.entity_name, f.field_name, vs.set_code, vs.display_name,
         m.code, m.display_label, m.description, m.sort_order, m.active_from, m.active_to
  FROM field_value_set f
  JOIN value_set vs ON vs.set_code = f.value_set_code
  JOIN value_set_member m ON m.value_set_id = vs.id AND m.tenant_id IS NULL
  ORDER BY f.entity_name, f.field_name, m.sort_order, m.code`;
await sql.end();

const now = Date.now();
const out = {};
for (const r of rows) {
  const key = `${r.entity_name}/${r.field_name}`;
  out[key] ??= { setCode: r.set_code, displayName: r.display_name, entityName: r.entity_name, fieldName: r.field_name, members: [] };
  const active = (!r.active_from || r.active_from.getTime() <= now) && (!r.active_to || r.active_to.getTime() > now);
  out[key].members.push({
    code: r.code, displayLabel: r.display_label, description: r.description, sortOrder: r.sort_order,
    active, hidden: false, selectable: active,
  });
}
writeFileSync(new URL('../../../test/fixtures/value-sets.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${Object.keys(out).length} field value sets`);
