#!/usr/bin/env node
// The backlog (docs/product/backlog.csv) is the single list of outstanding
// work. This check keeps it filterable and in step with the documents that
// describe the work in detail:
//   - columns and classification values are from the agreed lists, so
//     filters in Excel stay clean;
//   - IDs are unique and every source document exists;
//   - every item in the enterprise readiness plan has a row;
//   - every open question in a business-process page has a row, and a row
//     still citing a question the page has since closed must be closed or
//     have that reference removed.
// See docs/product/backlog.md for what each column means.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseCsv } from './lib/backlog-csv.mjs';

const root = new URL('..', import.meta.url).pathname;
const BACKLOG = 'docs/product/backlog.csv';
const READINESS = 'docs/product/enterprise-readiness-audit.md';
const BP_DIR = 'docs/business-processes';

const HEADER = ['ID', 'Title', 'Detail', 'Type', 'Area', 'Quality', 'Root cause', 'Pattern', 'Priority', 'Size', 'Status', 'Owner', 'Waiting on', 'Milestone', 'Source', 'Source ref', 'Added', 'Updated'];
export const ALLOWED = {
  Type: ['Defect', 'Feature', 'Improvement', 'Integration', 'Tech debt', 'Test', 'Docs', 'Operations', 'Decision', 'Question', 'Review'],
  Area: [
    'Platform', 'Tenancy & data', 'Auth & access', 'Workflow', 'Integrations', 'Infrastructure',
    'Admissions', 'CAS & sponsor', 'Registration & status', 'Curriculum', 'Module selection', 'Engagement',
    'Adjustments & EC', 'Wellbeing', 'Assessment', 'Exam boards', 'Progression & awards', 'PGR', 'Regulatory',
    'Identity & rights', 'Communications', 'Reporting', 'Globalisation', 'Admin & portal UI', 'Accessibility',
    'Demo & migration', 'Testing', 'Documentation',
  ],
  Quality: ['Security', 'Availability', 'Performance', 'Scalability', 'Maintainability', 'Extensibility', 'Accessibility', 'Usability', 'Compliance', 'Functionality'],
  'Root cause': ['Missing pattern', 'Principle not enforced', 'Planned scope', 'External', 'Not assessed'],
  Priority: ['P0', 'P1', 'P2', 'P3', 'Triage'],
  Size: ['S', 'M', 'L', 'XL', '?'],
  Status: ['Open', 'In progress', 'Blocked', 'Awaiting decision', 'Awaiting review', 'Done', "Won't do"],
  Owner: ['Engineering', 'Architecture', 'Product', 'Institution', 'SME', 'DPO'],
};
const CLOSED = new Set(['Done', "Won't do"]);
// ISO dates; Excel may re-save them as day/month/year, which is accepted.
const DATE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/;

const errors = [];
const [header, ...records] = parseCsv(readFileSync(join(root, BACKLOG), 'utf8'));
if (header.join('|') !== HEADER.join('|')) {
  errors.push(`header must be exactly: ${HEADER.join(',')}`);
}
const items = records.map((cells, i) => {
  if (cells.length !== HEADER.length) errors.push(`line ${i + 2}: ${cells.length} columns, expected ${HEADER.length}`);
  return Object.fromEntries(HEADER.map((h, j) => [h, (cells[j] ?? '').trim()]));
});

const ids = new Set();
for (const it of items) {
  const where = it.ID || '(no ID)';
  if (!/^BL-\d{3,}$/.test(it.ID)) errors.push(`${where}: ID must look like BL-001`);
  if (ids.has(it.ID)) errors.push(`${where}: duplicate ID`);
  ids.add(it.ID);
  if (it.Pattern && !/^P-\d{2}$/.test(it.Pattern)) errors.push(`${where}: Pattern "${it.Pattern}" must look like P-01`);
  if (['Missing pattern', 'Principle not enforced'].includes(it['Root cause']) && !it.Pattern) {
    errors.push(`${where}: Root cause "${it['Root cause']}" needs the Pattern that should have caught it`);
  }
  for (const col of ['Title', 'Type', 'Area', 'Quality', 'Root cause', 'Priority', 'Size', 'Status', 'Owner', 'Source', 'Added', 'Updated']) {
    if (!it[col]) errors.push(`${where}: ${col} is empty`);
  }
  for (const [col, values] of Object.entries(ALLOWED)) {
    if (it[col] && !values.includes(it[col])) errors.push(`${where}: ${col} "${it[col]}" is not one of: ${values.join(', ')}`);
  }
  for (const col of ['Added', 'Updated']) {
    if (it[col] && !DATE.test(it[col])) errors.push(`${where}: ${col} "${it[col]}" is not a date (YYYY-MM-DD)`);
  }
  if (it.Source && !existsSync(join(root, it.Source.split('#')[0]))) errors.push(`${where}: source ${it.Source} does not exist`);
}

const refsOf = (it) => it['Source ref'].split(';').map((r) => r.trim()).filter(Boolean);
const rowsByRef = new Map();
for (const it of items) for (const ref of refsOf(it)) rowsByRef.set(ref, [...(rowsByRef.get(ref) ?? []), it]);

// Every readiness plan item has a row.
const plan = readFileSync(join(root, READINESS), 'utf8');
const planItems = [...plan.matchAll(/^\| (\d\.\d+) [^|]+\| (?:SEC|AVL|SCL|PERF|MNT|EXT)/gm)].map((m) => m[1]);
for (const id of planItems) {
  if (!rowsByRef.has(`Readiness ${id}`)) errors.push(`readiness plan item ${id} has no backlog row (Source ref "Readiness ${id}")`);
}

// Business-process open questions, both ways.
const questionStatus = new Map();
for (const dir of readdirSync(join(root, BP_DIR)).filter((d) => /^\d{2}-/.test(d))) {
  for (const file of readdirSync(join(root, BP_DIR, dir)).filter((f) => /^bp-\d{2}-\d{3}.*\.md$/.test(f))) {
    const bp = file.slice(0, 9).toUpperCase();
    const text = readFileSync(join(root, BP_DIR, dir, file), 'utf8');
    for (const m of text.matchAll(/^\| (OQ-\d+) \| .+? \| .+? \| (.+?) \|$/gm)) {
      questionStatus.set(`${bp} ${m[1]}`, /^Open\b/.test(m[2]) ? 'open' : 'closed');
    }
  }
}
let openQuestions = 0;
for (const [ref, status] of questionStatus) {
  if (status !== 'open') continue;
  openQuestions++;
  const rows = rowsByRef.get(ref) ?? [];
  if (!rows.length) errors.push(`${ref} is open on its page but has no backlog row (add it to Source ref)`);
  else if (rows.every((r) => CLOSED.has(r.Status))) errors.push(`${ref} is open on its page but its backlog row ${rows.map((r) => r.ID).join(', ')} is closed`);
}
for (const it of items) {
  if (CLOSED.has(it.Status)) continue;
  for (const ref of refsOf(it)) {
    if (!/^BP-\d{2}-\d{3} OQ-\d+$/.test(ref)) continue;
    const status = questionStatus.get(ref);
    // A row kept open for the unanswered part of a closed question cites it
    // as "BP-xx-yyy OQ-n (remainder)", which this pattern does not match.
    if (!status) errors.push(`${it.ID}: ${ref} does not exist on any process page`);
    else if (status === 'closed') {
      errors.push(refsOf(it).length > 1
        ? `${it.ID}: ${ref} is closed on its page; remove it from Source ref`
        : `${it.ID}: ${ref} is closed on its page; close this row too, or cite "${ref} (remainder)" if part is still open`);
    }
  }
}

if (errors.length) {
  console.error(`check:backlog found ${errors.length} problem(s) in ${BACKLOG}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const open = items.filter((it) => !CLOSED.has(it.Status)).length;
console.log(`check:backlog ok: ${items.length} items (${open} open), all ${planItems.length} readiness items and ${openQuestions} open process questions covered`);
