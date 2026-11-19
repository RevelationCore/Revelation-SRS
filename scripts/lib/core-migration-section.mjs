import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Returns the SQL that came from one original core migration, wherever a
 * re-squash has put it. Squashed files head each original with
 * "-- Originally NNNN_name.sql"; a file that has not been squashed is returned
 * whole. Returns null when no core migration holds it.
 */
export function readCoreMigrationSection(root, originalTag) {
  const dir = resolve(root, 'packages/db/migrations');
  const journal = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8'));
  for (const { tag } of journal.entries) {
    const sql = readFileSync(resolve(dir, `${tag}.sql`), 'utf8');
    if (tag === originalTag) return sql;
    const marker = `-- Originally ${originalTag}.sql`;
    const start = sql.indexOf(marker);
    if (start === -1) continue;
    const next = sql.indexOf('\n-- Originally ', start + marker.length);
    return sql.slice(start, next === -1 ? undefined : next);
  }
  return null;
}
