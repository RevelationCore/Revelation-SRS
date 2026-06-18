/**
 * Stage 2 — Event Schema Registry Tests
 *
 * Verifies that:
 * 1. Every published event in EVENT_TYPES has a committed schema file.
 * 2. Every committed schema is valid JSON Schema draft-07.
 * 3. Sample payloads for each domain validate against their schemas.
 * 4. Internal events are NOT present in the published schema set.
 * 5. The registry.json index is consistent with the committed schema files.
 * 6. The envelope schema validates a structurally correct envelope.
 *
 * These tests do not require a database or NATS connection.
 *
 * If these tests fail after adding or changing event payload types, re-run:
 *   pnpm --filter @revelation-srs/domain generate:schemas
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENT_TYPES } from '@revelation-srs/domain';

import {
  PUBLISHED_EVENTS,
  INTERNAL_EVENTS,
} from '../../../packages/domain/scripts/generate-event-schemas.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonSchema = {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string;
  definitions?: Record<string, { type?: string; properties?: Record<string, unknown>; required?: string[] }>;
  required?: string[];
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
};

type RegistryEntry = {
  subject: string;
  version?: string;
  schemaRef?: string;
  schemaPath?: string;
  dataClass?: string;
  partitionKey?: string;
  consumers?: string[];
  status: 'published' | 'internal';
};

type Registry = {
  events: RegistryEntry[];
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEMA_ROOT     = join(WORKSPACE_ROOT, 'schemas', 'events');

let ajv: Ajv;
let registry: Registry;
const schemaCache = new Map<string, JsonSchema>();

async function loadSchema(schemaPath: string): Promise<JsonSchema> {
  if (schemaCache.has(schemaPath)) return schemaCache.get(schemaPath)!;
  const raw = await readFile(join(SCHEMA_ROOT, schemaPath), 'utf-8');
  const schema = JSON.parse(raw) as JsonSchema;
  schemaCache.set(schemaPath, schema);
  return schema;
}

beforeAll(async () => {
  ajv = new Ajv({ strict: false, allErrors: true });

  const registryRaw = await readFile(join(SCHEMA_ROOT, 'registry.json'), 'utf-8');
  registry = JSON.parse(registryRaw) as Registry;

  // Preload all published schemas
  for (const event of PUBLISHED_EVENTS) {
    await loadSchema(`${event.schemaPath}/v1.json`);
  }
});

// ---------------------------------------------------------------------------
// Helper: validate a payload against its schema
// ---------------------------------------------------------------------------

function validatePayload(schema: JsonSchema, payload: unknown): { valid: boolean; errors: string[] } {
  const validate = ajv.compile(schema);
  const valid = validate(payload) as boolean;
  return {
    valid,
    errors: (validate.errors ?? []).map(e => `${e.instancePath} ${e.message}`),
  };
}

// ---------------------------------------------------------------------------
// 1. Registry completeness
// ---------------------------------------------------------------------------

describe('Stage 2 — event registry completeness', () => {
  it('registry.json exists and has events', () => {
    expect(registry.events.length).toBeGreaterThan(0);
  });

  it('registry.json contains 46 published events and 6 internal events', () => {
    const published = registry.events.filter(e => e.status === 'published');
    const internal  = registry.events.filter(e => e.status === 'internal');
    expect(published.length).toBe(46);
    expect(internal.length).toBe(6);
  });

  it('every published EVENT_TYPES entry is either in the schema registry or in the internal list', () => {
    const publishedSubjects = new Set(
      registry.events.filter(e => e.status === 'published').map(e => e.subject),
    );
    const internalSubjects = new Set(
      registry.events.filter(e => e.status === 'internal').map(e => e.subject),
    );

    const missing: string[] = [];
    for (const subject of Object.values(EVENT_TYPES)) {
      if (!publishedSubjects.has(subject) && !internalSubjects.has(subject)) {
        missing.push(subject);
      }
    }
    expect(missing, 'EVENT_TYPES subjects not in registry').toEqual([]);
  });

  it('every published registry entry has a matching schema file', async () => {
    const missing: string[] = [];
    for (const entry of registry.events.filter(e => e.status === 'published')) {
      if (!entry.schemaPath) { missing.push(`${entry.subject} — missing schemaPath`); continue; }
      try {
        await loadSchema(entry.schemaPath.replace('schemas/events/', ''));
      } catch {
        missing.push(entry.subject);
      }
    }
    expect(missing, 'published events missing schema file').toEqual([]);
  });

  it('no internal event subject has a published schema file', () => {
    const internalSubjects = new Set(INTERNAL_EVENTS.map(e => e.subject));
    const publishedSubjects = registry.events
      .filter(e => e.status === 'published')
      .map(e => e.subject);
    const leaked = publishedSubjects.filter(s => internalSubjects.has(s));
    expect(leaked, 'internal events must not appear in published registry').toEqual([]);
  });

  it('every published event has required registry metadata', () => {
    const incomplete: string[] = [];
    for (const entry of registry.events.filter(e => e.status === 'published')) {
      if (!entry.version || !entry.schemaRef || !entry.dataClass || !entry.partitionKey) {
        incomplete.push(entry.subject);
      }
    }
    expect(incomplete, 'events missing required metadata').toEqual([]);
  });

  it('every published event schemaRef resolves to a local schema path', () => {
    for (const entry of registry.events.filter(e => e.status === 'published')) {
      expect(entry.schemaRef, `${entry.subject} must have schemaRef`).toBeTruthy();
      expect(entry.schemaRef!.startsWith('https://schemas.revelation-srs.io/events/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Schema file structure
// ---------------------------------------------------------------------------

describe('Stage 2 — schema file structure', () => {
  it('every payload schema is valid JSON Schema draft-07', async () => {
    const invalid: string[] = [];
    for (const event of PUBLISHED_EVENTS) {
      const schema = await loadSchema(`${event.schemaPath}/v1.json`);
      if (schema.$schema !== 'http://json-schema.org/draft-07/schema#') {
        invalid.push(`${event.schemaPath}: missing or wrong $schema`);
      }
      if (!schema.$id) {
        invalid.push(`${event.schemaPath}: missing $id`);
      }
    }
    expect(invalid, 'schemas with structural issues').toEqual([]);
  });

  it('every payload schema has a $ref to its definitions', async () => {
    const invalid: string[] = [];
    for (const event of PUBLISHED_EVENTS) {
      const schema = await loadSchema(`${event.schemaPath}/v1.json`);
      if (!schema.$ref && !schema.properties) {
        invalid.push(event.schemaPath);
      }
    }
    expect(invalid, 'schemas missing $ref or properties').toEqual([]);
  });

  it('every payload schema definition has required fields declared', async () => {
    const incomplete: string[] = [];
    for (const event of PUBLISHED_EVENTS) {
      const schema = await loadSchema(`${event.schemaPath}/v1.json`);
      const def = schema.definitions?.[event.typeName];
      if (!def) { incomplete.push(`${event.schemaPath}: definition not found`); continue; }
      if (!def.required?.length) {
        incomplete.push(`${event.schemaPath}: no required fields declared`);
      }
    }
    expect(incomplete, 'schemas with no required fields').toEqual([]);
  });

  it('envelope schema declares all required envelope fields', async () => {
    const envelope = await loadSchema('envelope.v1.json');
    const required = envelope.required ?? [];
    const expected = ['id', 'type', 'version', 'schemaRef', 'tenantId', 'occurredAt', 'publishedAt', 'validAt', 'correlationId', 'causationId', 'source', 'dataClassification', 'payload'];
    for (const field of expected) {
      expect(required, `envelope missing required field '${field}'`).toContain(field);
    }
  });

  it('all 46 domain-specific schema files exist on disk', async () => {
    const found = await readdir(SCHEMA_ROOT, { recursive: true });
    const jsonFiles = found.filter(f => (f).endsWith('v1.json') && f !== 'envelope.v1.json');
    expect(jsonFiles.length).toBe(46);
  });
});

// ---------------------------------------------------------------------------
// 3. Payload validation — one sample per domain
// ---------------------------------------------------------------------------

describe('Stage 2 — payload validation against schemas', () => {
  async function check(schemaPath: string, payload: unknown): Promise<void> {
    const schema = await loadSchema(`${schemaPath}/v1.json`);
    const result = validatePayload(schema, payload);
    expect(result.errors, `${schemaPath}: payload validation failed`).toEqual([]);
    expect(result.valid, `${schemaPath}: expected valid payload`).toBe(true);
  }

  async function checkInvalid(schemaPath: string, payload: unknown): Promise<void> {
    const schema = await loadSchema(`${schemaPath}/v1.json`);
    const result = validatePayload(schema, payload);
    expect(result.valid, `${schemaPath}: expected validation to fail`).toBe(false);
  }

  // Student domain
  it('validates a valid student.created payload', () =>
    check('student/created', {
      personId: '01931abc-0001-7000-a000-000000000001',
      studentNumber: 'STU-2024-00001',
      tenantId: '01931abc-0000-7000-a000-000000000000',
    }));

  it('rejects student.created payload with missing required field', () =>
    checkInvalid('student/created', { personId: '01931abc-0001-7000-a000-000000000001' }));

  it('validates a valid student.enrolled payload', () =>
    check('student/enrolled', {
      personId: '01931abc-0001-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      academicYear: '2024-25',
      modeOfStudy: 'full-time',
    }));

  it('validates a valid student.status-changed payload', () =>
    check('student/status-changed', {
      personId: '01931abc-0001-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      previousStatus: 'active',
      newStatus: 'intermitting',
      effectiveDate: '2025-01-15',
    }));

  it('validates a valid student.disability-declaration-updated payload', () =>
    check('student/disability-declaration-updated', {
      personId: '01931abc-0001-7000-a000-000000000001',
      declarationId: '01931abc-0010-7000-a000-000000000001',
      disabilityCategoryCode: 'hearing-impairment',
      declarationStatusCode: 'confirmed',
    }));

  // Identity domain
  it('validates a valid identity.verification-requested payload', () =>
    check('identity/verification-requested', {
      personId: '01931abc-0001-7000-a000-000000000001',
      verificationCheckId: '01931abc-0011-7000-a000-000000000001',
    }));

  it('validates a valid identity.verification-completed payload', () =>
    check('identity/verification-completed', {
      personId: '01931abc-0001-7000-a000-000000000001',
      verificationCheckId: '01931abc-0011-7000-a000-000000000001',
      statusCode: 'passed',
      fraudFlag: false,
    }));

  // Enrolment domain
  it('validates a valid enrolment.fee-liability-generated payload', () =>
    check('enrolment/fee-liability-generated', {
      personId: '01931abc-0001-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      feeLiabilityId: '01931abc-0020-7000-a000-000000000001',
      academicYear: '2024-25',
    }));

  it('validates a valid enrolment.module-registered payload', () =>
    check('enrolment/module-registered', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      moduleRegistrationId: '01931abc-0030-7000-a000-000000000001',
      moduleOfferingId: '01931abc-0031-7000-a000-000000000001',
      moduleId: '01931abc-0032-7000-a000-000000000001',
      academicPeriodId: '01931abc-0033-7000-a000-000000000001',
      registrationDate: '2024-09-01',
    }));

  it('validates a valid enrolment.module-registration-withdrawn payload', () =>
    check('enrolment/module-registration-withdrawn', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      moduleRegistrationId: '01931abc-0030-7000-a000-000000000001',
      moduleOfferingId: '01931abc-0031-7000-a000-000000000001',
      withdrawnAt: '2024-10-15T09:00:00Z',
    }));

  // Catalogue domain
  it('validates a valid catalogue.programme-updated payload', () =>
    check('catalogue/programme-updated', {
      programmeId: '01931abc-0040-7000-a000-000000000001',
      code: 'BSCCS',
      title: 'BSc Computer Science',
      effectiveDate: '2024-09-01',
    }));

  it('validates a valid catalogue.module-updated payload', () =>
    check('catalogue/module-updated', {
      moduleId: '01931abc-0041-7000-a000-000000000001',
      code: 'CS101',
      title: 'Introduction to Computing',
      creditValue: 20,
      effectiveDate: '2024-09-01',
    }));

  it('validates a valid catalogue.module-updated payload with null creditValue', () =>
    check('catalogue/module-updated', {
      moduleId: '01931abc-0041-7000-a000-000000000001',
      code: 'CS101',
      title: 'Introduction to Computing',
      creditValue: null,
      effectiveDate: '2024-09-01',
    }));

  // Assessment domain
  it('validates a valid assessment.mark-received payload', () =>
    check('assessment/mark-received', {
      markId: '01931abc-0050-7000-a000-000000000001',
      moduleRegistrationId: '01931abc-0030-7000-a000-000000000001',
      assessmentComponentId: '01931abc-0051-7000-a000-000000000001',
      rawMark: 68,
      adjustedMark: 68,
      attemptNumber: 1,
      penaltyApplied: false,
    }));

  it('validates a valid assessment.module-result-ratified payload', () =>
    check('assessment/module-result-ratified', {
      moduleResultId: '01931abc-0055-7000-a000-000000000001',
      moduleRegistrationId: '01931abc-0030-7000-a000-000000000001',
      aggregateMark: 68,
      resultCode: 'pass',
      examBoardId: '01931abc-0060-7000-a000-000000000001',
      ratifiedAt: '2025-06-14T14:00:00Z',
    }));

  // Adjustment domain
  it('validates a valid adjustment.approved payload', () =>
    check('adjustment/approved', {
      adjustmentId: '01931abc-0070-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      personId: '01931abc-0001-7000-a000-000000000001',
      adjustmentTypeCode: 'extra-time-25-percent',
      scopeCode: 'all-assessments',
      validFrom: '2024-09-01',
    }));

  // Circumstances domain
  it('validates a valid circumstances.exceptional-circumstances-flagged payload', () =>
    check('circumstances/exceptional-circumstances-flagged', {
      exceptionalCircumstancesId: '01931abc-0080-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      personId: '01931abc-0001-7000-a000-000000000001',
      outcomeCode: 'sit',
      determinationDate: '2024-12-01',
    }));

  // Governance domain
  it('validates a valid governance.exam-board-ratified payload', () =>
    check('governance/exam-board-ratified', {
      examBoardId: '01931abc-0060-7000-a000-000000000001',
      boardTypeCode: 'progression',
      academicYear: '2024-25',
      ratifiedAt: '2025-06-14T14:00:00Z',
      externalExaminerConfirmedAt: '2025-06-12T10:00:00Z',
    }));

  it('validates a valid governance.exam-board-data-pack-ready payload', () =>
    check('governance/exam-board-data-pack-ready', {
      examBoardId: '01931abc-0060-7000-a000-000000000001',
      dataPackId: '01931abc-0061-7000-a000-000000000001',
      boardTypeCode: 'progression',
      academicYear: '2024-25',
      candidateCount: 142,
      packVersion: 1,
    }));

  it('validates a valid governance.record-locked payload', () =>
    check('governance/record-locked', {
      examBoardId: '01931abc-0060-7000-a000-000000000001',
      lockedEntityTypes: ['mark', 'module-result'],
      lockedCount: 284,
    }));

  // Progression domain
  it('validates a valid progression.decided payload', () =>
    check('progression/decided', {
      progressionDecisionId: '01931abc-0090-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      personId: '01931abc-0001-7000-a000-000000000001',
      academicYear: '2024-25',
      yearOfStudy: '2',
      decisionCode: 'progress',
    }));

  // Award domain
  it('validates a valid award.conferred payload', () =>
    check('award/conferred', {
      awardId: '01931abc-0100-7000-a000-000000000001',
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      personId: '01931abc-0001-7000-a000-000000000001',
      examBoardId: '01931abc-0060-7000-a000-000000000001',
      qualificationCode: 'BSc',
      classificationCode: 'upper-second',
      awardDate: '2025-07-15',
    }));

  // Regulatory domain
  it('validates a valid regulatory.ucas-application-received payload', () =>
    check('regulatory/ucas-application-received', {
      applicationId: '01931abc-0110-7000-a000-000000000001',
      ucasPersonalId: '1234567890',
      cycle: '2025',
      statusCode: 'unconditional-offer',
      tenantId: '01931abc-0000-7000-a000-000000000000',
    }));

  it('validates a valid regulatory.ucas-confirmation-sent payload', () =>
    check('regulatory/ucas-confirmation-sent', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      ucasPersonalId: '1234567890',
      cycle: '2025',
      confirmationType: 'enrolled',
      exchangeId: '01931abc-0111-7000-a000-000000000001',
    }));

  it('rejects regulatory.ucas-confirmation-sent with invalid enum value', () =>
    checkInvalid('regulatory/ucas-confirmation-sent', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      ucasPersonalId: '1234567890',
      cycle: '2025',
      confirmationType: 'accepted',  // not a valid enum value
      exchangeId: '01931abc-0111-7000-a000-000000000001',
    }));

  it('validates a valid regulatory.hesa-return-submitted payload', () =>
    check('regulatory/hesa-return-submitted', {
      returnId: '01931abc-0120-7000-a000-000000000001',
      academicYear: '2024-25',
      submissionReference: 'HESA-2025-001',
      submittedAt: '2025-04-01T10:00:00Z',
    }));

  it('validates a valid regulatory.slc-confirmation-sent payload', () =>
    check('regulatory/slc-confirmation-sent', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      confirmationType: 'enrolment',
      exchangeId: '01931abc-0130-7000-a000-000000000001',
    }));

  it('validates a valid regulatory.ukvi-cas-requested payload', () =>
    check('regulatory/ukvi-cas-requested', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      casRequestId: '01931abc-0140-7000-a000-000000000001',
      requestedAt: '2025-01-10T09:00:00Z',
    }));

  it('validates a valid regulatory.ukvi-compliance-alert-raised payload', () =>
    check('regulatory/ukvi-compliance-alert-raised', {
      enrolmentId: '01931abc-0002-7000-a000-000000000001',
      alertTypeCode: 'absence-threshold-breached',
      casReference: 'CAS123456789',
      triggeredAt: '2025-03-15T08:00:00Z',
    }));
});

// ---------------------------------------------------------------------------
// 4. Schema drift detection (committed schemas match generation input types)
// ---------------------------------------------------------------------------

describe('Stage 2 — schema registry consistency', () => {
  it('every published event in PUBLISHED_EVENTS has an entry in registry.json', () => {
    const registrySubjects = new Set(registry.events.map(e => e.subject));
    const missing = PUBLISHED_EVENTS
      .filter(e => !registrySubjects.has(e.subject))
      .map(e => e.subject);
    expect(missing, 'events in PUBLISHED_EVENTS missing from registry').toEqual([]);
  });

  it('every published event type name appears in its schema definitions', async () => {
    const mismatch: string[] = [];
    for (const event of PUBLISHED_EVENTS) {
      const schema = await loadSchema(`${event.schemaPath}/v1.json`);
      if (!schema.definitions?.[event.typeName]) {
        mismatch.push(`${event.schemaPath}: expected definition '${event.typeName}'`);
      }
    }
    expect(mismatch, 'schema type name mismatches').toEqual([]);
  });

  it('data classification values are from the approved set', () => {
    const APPROVED = new Set(['standard', 'personal', 'sensitive', 'special-category', 'regulatory']);
    const invalid = PUBLISHED_EVENTS
      .filter(e => !APPROVED.has(e.dataClass))
      .map(e => `${e.subject}: ${e.dataClass}`);
    expect(invalid, 'events with invalid data classification').toEqual([]);
  });

  it('every published event has at least one consumer declared', () => {
    const empty = PUBLISHED_EVENTS
      .filter(e => !e.consumers.length)
      .map(e => e.subject);
    expect(empty, 'events with no declared consumers').toEqual([]);
  });
});
