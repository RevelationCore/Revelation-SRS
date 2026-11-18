#!/usr/bin/env node
// Phase 5 D-45: every "Institution must confirm" item in a gap-closure
// decision record must appear in the SME change review pack, so the pack
// cannot drift from the decisions. An item of "None" needs no row.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const decisionsDir = join(root, 'docs/decisions');
const packPath = join(root, 'docs/business-processes/sme-change-review-phases-1-5.md');
const pack = readFileSync(packPath, 'utf8');
const rows = new Set([...pack.matchAll(/^\| (D-\d+) \|/gm)].map((m) => m[1]));

const missing = [];
for (const file of readdirSync(decisionsDir).filter((f) => /^phase-\d+-gap-closure-decisions\.md$/.test(f)).sort()) {
  const text = readFileSync(join(decisionsDir, file), 'utf8');
  const parts = text.split(/^## (D-\d+): .*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1] ?? '';
    const m = body.match(/\*\*Institution must confirm\.?\*\*\s*([\s\S]+?)(?:\*\*Reversibility|\n\n|$)/);
    if (!m) continue;
    const item = m[1].replace(/\s+/g, ' ').trim();
    if (/^none\b/i.test(item) && !/beyond/i.test(item)) continue;
    if (!rows.has(id)) missing.push(`${file} ${id}: ${item}`);
  }
}

if (missing.length > 0) {
  console.error(`The SME change review pack (${packPath.replace(root, '')}) is missing institution questions:`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`check:review-pack ok: ${rows.size} decisions with institution questions are in the pack`);
