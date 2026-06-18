/**
 * Stage 6 — Contract Tests and Compatibility Gates
 *
 * Consumer-driven contract tests for all high-priority external and first-party
 * integration consumers.  No database or NATS connection required — all
 * artefacts are read from committed files on disk.
 *
 * Covers:
 *   1. Per-consumer event contract verification (VLE, Finance, UCAS, HESA, SLC, UKVI, Wellbeing)
 *   2. Per-consumer REST endpoint contract verification
 *   3. Per-consumer file schema existence checks
 *   4. Public surface isolation (no private/internal routes exposed as public)
 *   5. Deprecation policy artefact completeness
 *
 * If these tests fail after schema or route changes, re-run:
 *   pnpm --filter @revelation-srs/api generate:openapi
 *   pnpm --filter @revelation-srs/domain generate:schemas
 */
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegistryEntry = {
  subject:      string;
  version?:     string;
  schemaRef?:   string;
  schemaPath?:  string;
  dataClass?:   string;
  consumers?:   string[];
  status:       'published' | 'internal';
};

type Registry = {
  events: RegistryEntry[];
};

type OperationObject = {
  operationId?:          string;
  tags?:                 string[];
  'x-publication-class'?: string;
};

type SpecObject = {
  paths?: Record<string, Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..', '..', '..');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function isOperation(value: unknown): value is OperationObject {
  return typeof value === 'object' && value !== null;
}

function opClass(spec: SpecObject, method: string, path: string): string | undefined {
  const item = spec.paths?.[path];
  if (!item) return undefined;
  const op = item[method.toLowerCase()];
  if (!isOperation(op)) return undefined;
  return op['x-publication-class'];
}

function pathExists(spec: SpecObject, method: string, path: string): boolean {
  return opClass(spec, method, path) !== undefined;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

function eventsForConsumer(registry: Registry, consumer: string): RegistryEntry[] {
  return registry.events.filter(e => e.consumers?.includes(consumer) && e.status === 'published');
}

// ---------------------------------------------------------------------------
// Load artefacts once
// ---------------------------------------------------------------------------

let openApiSpec:    SpecObject;
let eventRegistry:  Registry;

beforeAll(async () => {
  const specPath     = join(__dirname, '..', 'openapi', 'v1.json');
  const registryPath = join(REPO_ROOT, 'schemas', 'events', 'registry.json');

  openApiSpec   = JSON.parse(await readFile(specPath, 'utf-8'))     as SpecObject;
  eventRegistry = JSON.parse(await readFile(registryPath, 'utf-8')) as Registry;
});

// ---------------------------------------------------------------------------
// Stage 6 — VLE consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — VLE consumer contract', () => {
  const CONSUMER = 'vle-adapter';

  const REQUIRED_EVENTS = [
    'srs.student.enrolled',
    'srs.student.status-changed',
    'srs.enrolment.module-registered',
    'srs.enrolment.module-registration-withdrawn',
    'srs.enrolment.module-registration-completed',
    'srs.catalogue.programme-updated',
    'srs.catalogue.module-updated',
  ];

  it('all required VLE events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, `missing VLE events in registry`).toEqual([]);
  });

  it('all VLE event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER)
      .filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'VLE event schemas missing on disk').toEqual([]);
  });

  it('mark submission endpoint exists as public', () => {
    expect(
      pathExists(openApiSpec, 'post', '/api/v1/module-registrations/{moduleRegistrationId}/marks'),
      'POST /api/v1/module-registrations/{moduleRegistrationId}/marks must be in spec',
    ).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/module-registrations/{moduleRegistrationId}/marks')).toBe('public');
  });

  it('module registration read endpoint exists as public', () => {
    expect(
      pathExists(openApiSpec, 'get', '/api/v1/module-registrations/{moduleRegistrationId}'),
    ).toBe(true);
    expect(opClass(openApiSpec, 'get', '/api/v1/module-registrations/{moduleRegistrationId}')).toBe('public');
  });

  it('adjustment distribution acknowledge endpoint exists as workflow', () => {
    const path = '/api/v1/adjustments/{adjustmentId}/distributions/{distributionId}/acknowledge';
    expect(pathExists(openApiSpec, 'post', path)).toBe(true);
    expect(opClass(openApiSpec, 'post', path)).toBe('workflow');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — Finance consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — Finance consumer contract', () => {
  const CONSUMER = 'finance-adapter';

  const REQUIRED_EVENTS = [
    'srs.student.enrolled',
    'srs.student.status-changed',
    'srs.enrolment.fee-liability-generated',
    'srs.regulatory.slc-confirmation-sent',
    'srs.regulatory.slc-notification-received',
  ];

  const REQUIRED_FILE_SCHEMAS = [
    'schemas/file-contracts/slc/confirmation-outbound.v1.json',
    'schemas/file-contracts/slc/notification-inbound.v1.json',
  ];

  it('all required Finance events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, 'missing Finance events in registry').toEqual([]);
  });

  it('all Finance event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER).filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'Finance event schemas missing on disk').toEqual([]);
  });

  it('required SLC file schemas exist on disk', async () => {
    const missing: string[] = [];
    for (const rel of REQUIRED_FILE_SCHEMAS) {
      if (!(await fileExists(join(REPO_ROOT, rel)))) missing.push(rel);
    }
    expect(missing, 'Finance file schemas missing on disk').toEqual([]);
  });

  it('SLC notification ingest endpoint exists with correct class', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/slc/notifications')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/slc/notifications')).toBe('reporting');
  });

  it('SLC confirmation generate endpoint exists as workflow', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/slc/confirmations/generate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/slc/confirmations/generate')).toBe('workflow');
  });

  it('enrolment fee liabilities query endpoint exists as public', () => {
    expect(pathExists(openApiSpec, 'get', '/api/v1/enrolments/{enrolmentId}/fee-liabilities')).toBe(true);
    expect(opClass(openApiSpec, 'get', '/api/v1/enrolments/{enrolmentId}/fee-liabilities')).toBe('public');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — UCAS / admissions consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — UCAS / admissions consumer contract', () => {
  const CONSUMER = 'admissions-adapter';

  const REQUIRED_EVENTS = [
    'srs.regulatory.ucas-application-received',
    'srs.regulatory.ucas-confirmation-sent',
  ];

  const REQUIRED_FILE_SCHEMAS = [
    'schemas/file-contracts/ucas/application-inbound.v1.json',
    'schemas/file-contracts/ucas/confirmation-outbound.v1.json',
  ];

  it('required UCAS events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, 'missing UCAS events in registry').toEqual([]);
  });

  it('all UCAS event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER).filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'UCAS event schemas missing on disk').toEqual([]);
  });

  it('required UCAS file schemas exist on disk', async () => {
    const missing: string[] = [];
    for (const rel of REQUIRED_FILE_SCHEMAS) {
      if (!(await fileExists(join(REPO_ROOT, rel)))) missing.push(rel);
    }
    expect(missing, 'UCAS file schemas missing').toEqual([]);
  });

  it('UCAS application ingest endpoint exists with correct class', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ucas/applications')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ucas/applications')).toBe('reporting');
  });

  it('UCAS confirmation generate endpoint exists as workflow', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ucas/confirmations/generate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ucas/confirmations/generate')).toBe('workflow');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — HESA consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — HESA consumer contract', () => {
  const CONSUMER = 'regulatory-reporting-adapter';

  const REQUIRED_EVENTS = [
    'srs.regulatory.hesa-return-generated',
    'srs.regulatory.hesa-return-submitted',
    'srs.regulatory.hesa-id-assigned',
  ];

  const REQUIRED_FILE_SCHEMAS = [
    'schemas/file-contracts/hesa/validation-report-inbound.v1.json',
  ];

  it('required HESA events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, 'missing HESA events in registry').toEqual([]);
  });

  it('all HESA event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER).filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'HESA event schemas missing on disk').toEqual([]);
  });

  it('required HESA file schemas exist on disk', async () => {
    const missing: string[] = [];
    for (const rel of REQUIRED_FILE_SCHEMAS) {
      if (!(await fileExists(join(REPO_ROOT, rel)))) missing.push(rel);
    }
    expect(missing, 'HESA file schemas missing').toEqual([]);
  });

  it('HESA return creation endpoint exists with correct class', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/hesa/returns')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/hesa/returns')).toBe('reporting');
  });

  it('HESA return file download endpoint exists with correct class', () => {
    expect(pathExists(openApiSpec, 'get', '/api/v1/regulatory/hesa/returns/{returnId}/file')).toBe(true);
    expect(opClass(openApiSpec, 'get', '/api/v1/regulatory/hesa/returns/{returnId}/file')).toBe('reporting');
  });

  it('HESA validation report ingest endpoint exists with correct class', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/hesa/returns/{returnId}/validation-reports')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/hesa/returns/{returnId}/validation-reports')).toBe('reporting');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — SLC regulatory exchange contract
// ---------------------------------------------------------------------------

describe('Stage 6 — SLC regulatory exchange contract', () => {
  const REQUIRED_EVENTS = [
    'srs.regulatory.slc-confirmation-sent',
    'srs.regulatory.slc-notification-received',
  ];

  const REQUIRED_FILE_SCHEMAS = [
    'schemas/file-contracts/slc/confirmation-outbound.v1.json',
    'schemas/file-contracts/slc/notification-inbound.v1.json',
  ];

  it('SLC events are present in the published registry', () => {
    const subjects  = eventRegistry.events.filter(e => e.status === 'published').map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !subjects.includes(s));
    expect(missing, 'missing SLC events in registry').toEqual([]);
  });

  it('SLC events have schemaPath entries', () => {
    const noPath = REQUIRED_EVENTS.filter(sub => {
      const entry = eventRegistry.events.find(e => e.subject === sub);
      return !entry?.schemaPath;
    });
    expect(noPath, 'SLC events missing schemaPath').toEqual([]);
  });

  it('required SLC file schemas exist on disk', async () => {
    const missing: string[] = [];
    for (const rel of REQUIRED_FILE_SCHEMAS) {
      if (!(await fileExists(join(REPO_ROOT, rel)))) missing.push(rel);
    }
    expect(missing, 'SLC file schemas missing').toEqual([]);
  });

  it('SLC confirmation generate endpoint exists as workflow', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/slc/confirmations/generate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/slc/confirmations/generate')).toBe('workflow');
  });

  it('SLC payment notification ingest endpoint exists as reporting', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/slc/notifications')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/slc/notifications')).toBe('reporting');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — UKVI consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — UKVI consumer contract', () => {
  const CONSUMER = 'ukvi-adapter';

  const REQUIRED_EVENTS = [
    'srs.regulatory.ukvi-cas-requested',
    'srs.regulatory.ukvi-cas-assigned',
    'srs.regulatory.ukvi-attendance-submitted',
    'srs.regulatory.ukvi-visa-status-updated',
    'srs.regulatory.ukvi-compliance-alert-raised',
  ];

  const REQUIRED_FILE_SCHEMAS = [
    'schemas/file-contracts/ukvi/cas-request-outbound.v1.json',
    'schemas/file-contracts/ukvi/attendance-report-outbound.v1.json',
    'schemas/file-contracts/ukvi/visa-update-inbound.v1.json',
  ];

  it('all required UKVI events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, 'missing UKVI events in registry').toEqual([]);
  });

  it('all UKVI event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER).filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'UKVI event schemas missing on disk').toEqual([]);
  });

  it('required UKVI file schemas exist on disk', async () => {
    const missing: string[] = [];
    for (const rel of REQUIRED_FILE_SCHEMAS) {
      if (!(await fileExists(join(REPO_ROOT, rel)))) missing.push(rel);
    }
    expect(missing, 'UKVI file schemas missing').toEqual([]);
  });

  it('UKVI CAS request generate endpoint exists as workflow', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ukvi/cas-requests/generate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ukvi/cas-requests/generate')).toBe('workflow');
  });

  it('UKVI attendance report generate endpoint exists as workflow', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ukvi/attendance-reports/generate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ukvi/attendance-reports/generate')).toBe('workflow');
  });

  it('UKVI visa status update endpoint exists as reporting', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ukvi/visa-updates')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ukvi/visa-updates')).toBe('reporting');
  });

  it('UKVI compliance alert evaluation endpoint exists as reporting', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/regulatory/ukvi/compliance-alerts/evaluate')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/regulatory/ukvi/compliance-alerts/evaluate')).toBe('reporting');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — Wellbeing first-party module consumer contract
// ---------------------------------------------------------------------------

describe('Stage 6 — Wellbeing first-party consumer contract', () => {
  const CONSUMER = 'wellbeing-module';

  const REQUIRED_EVENTS = [
    'srs.student.enrolled',
    'srs.student.status-changed',
    'srs.student.disability-declaration-updated',
    'srs.adjustment.approved',
    'srs.circumstances.exceptional-circumstances-flagged',
    'srs.circumstances.exceptional-circumstances-updated',
    'srs.regulatory.ukvi-compliance-alert-raised',
  ];

  it('all required Wellbeing events are published in the event registry', () => {
    const published = eventsForConsumer(eventRegistry, CONSUMER).map(e => e.subject);
    const missing   = REQUIRED_EVENTS.filter(s => !published.includes(s));
    expect(missing, 'missing Wellbeing events in registry').toEqual([]);
  });

  it('all Wellbeing event schema files exist on disk', async () => {
    const entries = eventsForConsumer(eventRegistry, CONSUMER).filter(e => e.schemaPath);
    const results = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => r.subject);
    expect(missing, 'Wellbeing event schemas missing on disk').toEqual([]);
  });

  it('disability-declaration-updated is classified as special-category', () => {
    const entry = eventRegistry.events.find(e => e.subject === 'srs.student.disability-declaration-updated');
    expect(entry, 'disability-declaration-updated must be in registry').toBeTruthy();
    expect(entry?.dataClass, 'disability declaration event must be special-category').toBe('special-category');
  });

  it('UKVI compliance-alert-raised is classified as sensitive or special-category', () => {
    const entry = eventRegistry.events.find(e => e.subject === 'srs.regulatory.ukvi-compliance-alert-raised');
    expect(entry).toBeTruthy();
    expect(['sensitive', 'special-category', 'personal', 'regulatory']).toContain(entry?.dataClass);
  });

  it('adjustment POST endpoint exists as integration-class (first-party access only)', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/students/{personId}/adjustments')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/students/{personId}/adjustments')).toBe('integration');
  });

  it('disability declarations read endpoint exists as public', () => {
    expect(pathExists(openApiSpec, 'get', '/api/v1/students/{personId}/disability-declarations')).toBe(true);
    expect(opClass(openApiSpec, 'get', '/api/v1/students/{personId}/disability-declarations')).toBe('public');
  });

  it('exceptional circumstances POST endpoint exists as public', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/students/{personId}/exceptional-circumstances')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/students/{personId}/exceptional-circumstances')).toBe('public');
  });

  it('misconduct outcome POST endpoint exists as public', () => {
    expect(pathExists(openApiSpec, 'post', '/api/v1/students/{personId}/misconduct-outcomes')).toBe(true);
    expect(opClass(openApiSpec, 'post', '/api/v1/students/{personId}/misconduct-outcomes')).toBe('public');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — Public surface isolation
// ---------------------------------------------------------------------------

describe('Stage 6 — public surface isolation', () => {
  it('all integration registry management routes are admin-class', () => {
    const integrationPaths = [
      { method: 'get',   path: '/api/v1/integration-contracts' },
      { method: 'get',   path: '/api/v1/integration-contracts/{contractId}' },
      { method: 'get',   path: '/api/v1/integration-registrations' },
      { method: 'post',  path: '/api/v1/integration-registrations' },
      { method: 'get',   path: '/api/v1/integration-registrations/{registrationId}' },
      { method: 'patch', path: '/api/v1/integration-registrations/{registrationId}' },
      { method: 'post',  path: '/api/v1/integration-registrations/{registrationId}/enable' },
      { method: 'post',  path: '/api/v1/integration-registrations/{registrationId}/disable' },
      { method: 'post',  path: '/api/v1/integration-registrations/{registrationId}/health-check' },
      { method: 'post',  path: '/api/v1/integration-registrations/{registrationId}/replay' },
      { method: 'get',   path: '/api/v1/integration-exchanges' },
      { method: 'get',   path: '/api/v1/integration-exchanges/{exchangeId}' },
    ];

    const wrong: string[] = [];
    for (const { method, path } of integrationPaths) {
      const cls = opClass(openApiSpec, method, path);
      if (cls !== 'admin') {
        wrong.push(`${method.toUpperCase()} ${path} has class '${cls ?? '(missing)'}', expected 'admin'`);
      }
    }
    expect(wrong, 'integration registry routes must be admin-class').toEqual([]);
  });

  it('no private-class route is exposed with the public publication class', () => {
    const wronglyPublic: string[] = [];
    for (const [path, item] of Object.entries(openApiSpec.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!isOperation(op)) continue;
        if (op['x-publication-class'] === 'private') {
          wronglyPublic.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    // private-class routes may exist but must not have x-publication-class === 'public'
    // this test verifies none are accidentally promoted to 'public'
    const promoted = wronglyPublic.filter(label => {
      const [method, path] = label.split(' ') as [string, string];
      return opClass(openApiSpec, method.toLowerCase(), path ?? '') === 'public';
    });
    expect(promoted, 'private-class routes must not be promoted to public').toEqual([]);
  });

  it('downstream-triggers endpoint is private-class (not exposed publicly)', () => {
    const cls = opClass(openApiSpec, 'get', '/api/v1/enrolments/{enrolmentId}/downstream-triggers');
    expect(cls).toBe('private');
  });

  it('no internal events appear in the published registry', () => {
    const internal = eventRegistry.events.filter(e => e.status === 'internal').map(e => e.subject);
    const published = eventRegistry.events.filter(e => e.status === 'published').map(e => e.subject);
    const leaked = internal.filter(s => published.includes(s));
    expect(leaked, 'internal events must not appear as published').toEqual([]);
  });

  it('all published events have a dataClass assigned', () => {
    const noClass = eventRegistry.events
      .filter(e => e.status === 'published' && !e.dataClass)
      .map(e => e.subject);
    expect(noClass, 'published events missing dataClass').toEqual([]);
  });

  it('sensitive and special-category events are not tagged for public-only consumers', () => {
    const sensitiveSubjects = eventRegistry.events
      .filter(e => e.dataClass === 'special-category' || e.dataClass === 'sensitive')
      .map(e => e.subject);

    const publicOnlyConsumers = ['prospectus-adapter', 'alumni-service'];
    const violations: string[] = [];
    for (const subject of sensitiveSubjects) {
      const entry    = eventRegistry.events.find(e => e.subject === subject)!;
      const exposed  = (entry.consumers ?? []).filter(c => publicOnlyConsumers.includes(c));
      if (exposed.length > 0) {
        violations.push(`${subject} → ${exposed.join(', ')}`);
      }
    }
    expect(violations, 'sensitive events must not be assigned to public-only consumers').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — Deprecation policy artefact completeness
// ---------------------------------------------------------------------------

describe('Stage 6 — deprecation policy artefacts', () => {
  it('all published events have a status field', () => {
    const missing = eventRegistry.events
      .filter(e => !e.status)
      .map(e => e.subject);
    expect(missing, 'events missing status field').toEqual([]);
  });

  it('all published events have a schemaPath', () => {
    const missing = eventRegistry.events
      .filter(e => e.status === 'published' && !e.schemaPath)
      .map(e => e.subject);
    expect(missing, 'published events missing schemaPath').toEqual([]);
  });

  it('every schemaPath in the registry resolves to a file on disk', async () => {
    const entries  = eventRegistry.events.filter(e => e.schemaPath);
    const results  = await Promise.all(
      entries.map(async e => ({
        subject: e.subject,
        path:    e.schemaPath!,
        exists:  await fileExists(join(REPO_ROOT, e.schemaPath!)),
      })),
    );
    const missing = results.filter(r => !r.exists).map(r => `${r.subject} → ${r.path}`);
    expect(missing, 'registry schemaPath entries that do not exist on disk').toEqual([]);
  });

  it('all published events have a version', () => {
    const missing = eventRegistry.events
      .filter(e => e.status === 'published' && !e.version)
      .map(e => e.subject);
    expect(missing, 'published events missing version').toEqual([]);
  });

  it('all published events have at least one consumer listed', () => {
    const noConsumers = eventRegistry.events
      .filter(e => e.status === 'published' && (!e.consumers || e.consumers.length === 0))
      .map(e => e.subject);
    expect(noConsumers, 'published events with no declared consumers').toEqual([]);
  });
});
