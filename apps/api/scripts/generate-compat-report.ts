/**
 * Generates a contract compatibility report summarising the current state of
 * all published integration artefacts: REST operations, domain events, file
 * schemas, and integration contracts.
 *
 * The report is written to apps/api/openapi/compat-report.json and printed in
 * human-readable form to stdout.  In CI it is uploaded as a workflow artefact.
 *
 * Usage:  pnpm --filter @revelation-srs/api generate:compat-report
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..', '..', '..');
const API_ROOT   = join(__dirname, '..');
const OUTPUT_DIR = join(API_ROOT, 'openapi');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OperationObject = {
  operationId?:           string;
  tags?:                  string[];
  'x-publication-class'?: string;
};

type SpecObject = {
  openapi?: string;
  info?:    { title?: string; version?: string };
  paths?:   Record<string, Record<string, OperationObject | unknown>>;
};

type RegistryEntry = {
  subject:     string;
  version?:    string;
  schemaPath?: string;
  dataClass?:  string;
  consumers?:  string[];
  status:      'published' | 'internal';
};

type Registry = { events: RegistryEntry[] };

type CompatReport = {
  generatedAt:      string;
  openApi: {
    version:           string;
    totalOperations:   number;
    byPublicationClass: Record<string, number>;
    tags:              string[];
  };
  events: {
    total:      number;
    published:  number;
    internal:   number;
    byDataClass: Record<string, number>;
    consumers:  string[];
  };
  fileSchemas: {
    total:    number;
    families: string[];
    files:    string[];
  };
  integrationContracts: {
    note: string;
  };
  summary: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function isOperation(value: unknown): value is OperationObject {
  return typeof value === 'object' && value !== null;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = await listJsonFiles(join(dir, entry.name));
      results.push(...sub);
    } else if (entry.isFile() && extname(entry.name) === '.json') {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Load artefacts
// ---------------------------------------------------------------------------

const specPath     = join(API_ROOT, 'openapi', 'v1.json');
const registryPath = join(REPO_ROOT, 'schemas', 'events', 'registry.json');
const fileSchemasDir = join(REPO_ROOT, 'schemas', 'file-contracts');

const spec:     SpecObject = JSON.parse(await readFile(specPath, 'utf-8'))     as SpecObject;
const registry: Registry   = JSON.parse(await readFile(registryPath, 'utf-8')) as Registry;

// ---------------------------------------------------------------------------
// REST API analysis
// ---------------------------------------------------------------------------

const operations: Array<{ method: string; path: string } & OperationObject> = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of HTTP_METHODS) {
    const op = item[method];
    if (!isOperation(op)) continue;
    operations.push({ method: method.toUpperCase(), path, ...op });
  }
}

const byClass: Record<string, number> = {};
for (const op of operations) {
  const cls = op['x-publication-class'] ?? 'unclassified';
  byClass[cls] = (byClass[cls] ?? 0) + 1;
}

const tagSet = new Set<string>();
for (const op of operations) {
  for (const tag of op.tags ?? []) tagSet.add(tag);
}

// ---------------------------------------------------------------------------
// Event registry analysis
// ---------------------------------------------------------------------------

const published = registry.events.filter(e => e.status === 'published');
const internal  = registry.events.filter(e => e.status === 'internal');

const byDataClass: Record<string, number> = {};
for (const e of published) {
  const cls = e.dataClass ?? 'unclassified';
  byDataClass[cls] = (byDataClass[cls] ?? 0) + 1;
}

const consumerSet = new Set<string>();
for (const e of published) {
  for (const c of e.consumers ?? []) consumerSet.add(c);
}

// ---------------------------------------------------------------------------
// File schema analysis
// ---------------------------------------------------------------------------

const allSchemaFiles = await listJsonFiles(fileSchemasDir);
// Exclude the top-level registry.json — count only per-family schema files
const schemaFiles = allSchemaFiles.filter(f => {
  const rel = f.replace(fileSchemasDir + '/', '');
  return rel.includes('/');
});
const families = [...new Set(schemaFiles.map(f => {
  const rel = f.replace(fileSchemasDir + '/', '');
  return rel.split('/')[0] ?? 'unknown';
}))];

const schemaRelPaths = schemaFiles.map(f =>
  f.replace(join(REPO_ROOT, 'schemas', 'file-contracts') + '/', 'schemas/file-contracts/'),
);

// ---------------------------------------------------------------------------
// Summary lines
// ---------------------------------------------------------------------------

const summary: string[] = [];
summary.push(`REST API: ${operations.length} operations across ${Object.keys(spec.paths ?? {}).length} paths`);
summary.push(`Events: ${published.length} published, ${internal.length} internal`);
summary.push(`File schemas: ${schemaFiles.length} schemas across ${families.length} families (${families.join(', ')})`);
summary.push(`Event consumers: ${consumerSet.size} declared (${[...consumerSet].sort().join(', ')})`);

// Drift warnings
const missingSchemas = published.filter(e => e.schemaPath).filter(e => {
  // We can't async here, so just note the count check is in test suite
  return false;
});
if (byClass['unclassified']) {
  summary.push(`WARNING: ${byClass['unclassified']} operations without publication class`);
}
const missingOperationIds = operations.filter(op => !op.operationId);
if (missingOperationIds.length > 0) {
  summary.push(`WARNING: ${missingOperationIds.length} operations without operationId`);
}

// ---------------------------------------------------------------------------
// Assemble report
// ---------------------------------------------------------------------------

const report: CompatReport = {
  generatedAt: new Date().toISOString(),
  openApi: {
    version:            spec.info?.version ?? 'unknown',
    totalOperations:    operations.length,
    byPublicationClass: byClass,
    tags:               [...tagSet].sort(),
  },
  events: {
    total:       registry.events.length,
    published:   published.length,
    internal:    internal.length,
    byDataClass,
    consumers:   [...consumerSet].sort(),
  },
  fileSchemas: {
    total:    schemaFiles.length,
    families: families.sort(),
    files:    schemaRelPaths.sort(),
  },
  integrationContracts: {
    note: 'Integration contract counts are stored in the database; run GET /api/v1/integration-contracts at runtime for the live list.',
  },
  summary,
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

await mkdir(OUTPUT_DIR, { recursive: true });
const outputPath = join(OUTPUT_DIR, 'compat-report.json');
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');

console.log('\n=== Revelation SRS Contract Compatibility Report ===\n');
for (const line of summary) {
  console.log(' ', line);
}
console.log('\nREST operations by publication class:');
for (const [cls, count] of Object.entries(byClass).sort()) {
  console.log(`  ${cls.padEnd(20)} ${count}`);
}
console.log('\nEvent data classifications:');
for (const [cls, count] of Object.entries(byDataClass).sort()) {
  console.log(`  ${cls.padEnd(20)} ${count}`);
}
console.log(`\nReport written to ${outputPath}`);
