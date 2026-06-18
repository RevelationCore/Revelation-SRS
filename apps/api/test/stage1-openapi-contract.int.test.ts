/**
 * Stage 1 — OpenAPI Contract Tests
 *
 * These tests do not require a real database or NATS connection.  They build
 * the Fastify app with a stub config (lazy connections are never triggered)
 * and compare the live-generated spec against the committed openapi/v1.json.
 *
 * Purpose:
 *   - Detect drift between the committed spec and the runtime implementation.
 *   - Assert that every published operation has an operationId, a tag, and a
 *     publication class.
 *   - Assert spec version and info fields.
 *
 * If these tests fail after a route change, re-run:
 *   pnpm --filter @revelation-srs/api generate:openapi
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OperationObject = {
  operationId?: string;
  tags?: string[];
  'x-publication-class'?: string;
};

type PathItemObject = Record<string, unknown>;

type SpecObject = {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, PathItemObject>;
  tags?: Array<{ name: string }>;
};

type OperationFingerprint = {
  operationId?: string;
  tags: string[];
  publicationClass?: string;
};

type SpecFingerprint = Record<string, Record<string, OperationFingerprint>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function isOperation(value: unknown): value is OperationObject {
  return typeof value === 'object' && value !== null;
}

function fingerprint(spec: SpecObject): SpecFingerprint {
  const result: SpecFingerprint = {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    result[path] = {};
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isOperation(op)) continue;
      result[path][method] = {
        operationId:     op.operationId,
        tags:            [...(op.tags ?? [])].sort(),
        publicationClass: op['x-publication-class'],
      };
    }
  }
  return result;
}

function listOperations(spec: SpecObject): Array<{ method: string; path: string } & OperationObject> {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isOperation(op)) continue;
      ops.push({ method: method.toUpperCase(), path, ...op });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Stub config — no real DB or NATS connection is made during spec generation
// ---------------------------------------------------------------------------

const STUB_CONFIG: Config = {
  port:                      3000,
  logLevel:                  'silent',
  nodeEnv:                   'test',
  databaseUrl:               'postgres://unused/openapi-test',
  natsUrl:                   'nats://unused:4222',
  temporalAddress:           'unused:7233',
  deploymentEnvironmentCode: 'local',
  releaseVersion:            '1.0.0',
  imageDigest:               undefined,
  migrationVersion:          '0018_stage7_legacy_removal',
  jwtSecret:                 'test-secret',
  keycloakJwksUrl:           undefined,
  corsOrigins:               ['*'],
  otelEndpoint:              undefined,
  otelServiceName:           'srs-api',
};

// ---------------------------------------------------------------------------
// Setup — build app once, read committed spec once
// ---------------------------------------------------------------------------

let liveSpec: SpecObject;
let committedSpec: SpecObject;

beforeAll(async () => {
  const app = await buildApp(STUB_CONFIG);
  await app.ready();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  liveSpec = (app as any).swagger() as SpecObject;
  await app.close();

  const specPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi', 'v1.json');
  committedSpec = JSON.parse(await readFile(specPath, 'utf-8')) as SpecObject;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stage 1 — OpenAPI spec version and info', () => {
  it('committed spec declares OpenAPI 3.1.0', () => {
    expect(committedSpec.openapi).toBe('3.1.0');
  });

  it('committed spec title is Revelation SRS API', () => {
    expect(committedSpec.info?.title).toBe('Revelation SRS API');
  });

  it('committed spec version is 1.0.0', () => {
    expect(committedSpec.info?.version).toBe('1.0.0');
  });

  it('committed spec declares required domain tags', () => {
    const tagNames = (committedSpec.tags ?? []).map(t => t.name);
    const required = [
      'students', 'enrolments', 'module-registrations', 'catalogue', 'calendar',
      'assessment', 'adjustments', 'circumstances', 'governance', 'progression',
      'regulatory', 'tenant-admin', 'value-sets', 'platform-controls',
      'globalisation', 'communications',
    ];
    for (const tag of required) {
      expect(tagNames, `tag '${tag}' must be declared`).toContain(tag);
    }
  });
});

describe('Stage 1 — committed spec drift detection', () => {
  it('committed openapi/v1.json path set matches the runtime-generated spec', () => {
    const livePaths     = Object.keys(fingerprint(liveSpec)).sort();
    const committedPaths = Object.keys(fingerprint(committedSpec)).sort();
    expect(committedPaths).toEqual(livePaths);
  });

  it('committed openapi/v1.json operation fingerprints match the runtime spec', () => {
    const live      = fingerprint(liveSpec);
    const committed = fingerprint(committedSpec);
    expect(committed).toEqual(live);
  });
});

describe('Stage 1 — all published operations have required metadata', () => {
  it('every published operation has an operationId', () => {
    const missing = listOperations(liveSpec)
      .filter(op => !op.operationId)
      .map(op => `${op.method} ${op.path}`);
    expect(missing, 'operations missing operationId').toEqual([]);
  });

  it('every published operation has at least one tag', () => {
    const missing = listOperations(liveSpec)
      .filter(op => !op.tags?.length)
      .map(op => `${op.method} ${op.path}`);
    expect(missing, 'operations missing tag').toEqual([]);
  });

  it('every published operation has a publication class', () => {
    const missing = listOperations(liveSpec)
      .filter(op => !op['x-publication-class'])
      .map(op => `${op.method} ${op.path}`);
    expect(missing, 'operations missing x-publication-class').toEqual([]);
  });

  it('all operationIds are unique', () => {
    const ids = listOperations(liveSpec)
      .map(op => op.operationId)
      .filter(Boolean) as string[];
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('publication classes are from the approved set', () => {
    const APPROVED = new Set(['public', 'integration', 'workflow', 'admin', 'system', 'reporting', 'operational', 'private']);
    const invalid = listOperations(liveSpec)
      .filter(op => op['x-publication-class'] && !APPROVED.has(op['x-publication-class']))
      .map(op => `${op.method} ${op.path} → ${op['x-publication-class']}`);
    expect(invalid, 'operations with invalid publication class').toEqual([]);
  });
});

describe('Stage 1 — publication class coverage', () => {
  it('spec contains public-class operations', () => {
    const count = listOperations(liveSpec).filter(op => op['x-publication-class'] === 'public').length;
    expect(count, 'expected at least 50 public operations').toBeGreaterThanOrEqual(50);
  });

  it('spec contains workflow-class operations', () => {
    const count = listOperations(liveSpec).filter(op => op['x-publication-class'] === 'workflow').length;
    expect(count, 'expected at least 20 workflow operations').toBeGreaterThanOrEqual(20);
  });

  it('spec contains reporting-class operations', () => {
    const count = listOperations(liveSpec).filter(op => op['x-publication-class'] === 'reporting').length;
    expect(count, 'expected at least 10 reporting operations').toBeGreaterThanOrEqual(10);
  });

  it('no operation has an empty operationId string', () => {
    const empty = listOperations(liveSpec)
      .filter(op => op.operationId === '')
      .map(op => `${op.method} ${op.path}`);
    expect(empty).toEqual([]);
  });
});
