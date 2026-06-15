/**
 * Stage 3 — File Contract Specifications
 *
 * Validates that all file contract schema files exist, are valid JSON Schema,
 * and that representative sample payloads pass/fail validation as expected.
 * Tests run without Docker — no database or NATS connection required.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..', '..', '..');
const SCHEMA_ROOT = join(WORKSPACE_ROOT, 'schemas', 'file-contracts');
const DOCS_ROOT = join(WORKSPACE_ROOT, 'docs', 'integrations', 'file-contracts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSchema(relPath: string): Promise<object> {
  const full = join(SCHEMA_ROOT, relPath);
  const raw = await readFile(full, 'utf8');
  return JSON.parse(raw) as object;
}

function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

// ---------------------------------------------------------------------------
// 1. Registry completeness
// ---------------------------------------------------------------------------

describe('Stage 3 — registry completeness', () => {
  let registry: { contracts: Array<{ contractId: string; exchanges: Array<{ schemaPath: string | null }> }> };

  beforeAll(async () => {
    const raw = await readFile(join(SCHEMA_ROOT, 'registry.json'), 'utf8');
    registry = JSON.parse(raw);
  });

  it('registry.json exists and has contracts array', () => {
    expect(Array.isArray(registry.contracts)).toBe(true);
    expect(registry.contracts.length).toBeGreaterThanOrEqual(5);
  });

  it('all 5 primary file contract families are registered', () => {
    const ids = registry.contracts.map(c => c.contractId);
    expect(ids).toContain('ucas-admissions-exchange.v1');
    expect(ids).toContain('hesa-student-return.v1');
    expect(ids).toContain('slc-enrolment-exchange.v1');
    expect(ids).toContain('ukvi-sponsor-compliance.v1');
    expect(ids).toContain('exam-scheduling.v1');
  });

  it('every exchange with a schemaPath has a schema file on disk', () => {
    for (const contract of registry.contracts) {
      for (const exchange of contract.exchanges) {
        if (exchange.schemaPath) {
          const full = join(WORKSPACE_ROOT, exchange.schemaPath);
          expect(existsSync(full), `Schema file missing: ${exchange.schemaPath}`).toBe(true);
        }
      }
    }
  });

  it('registry has at least 10 exchange entries in total', () => {
    const total = registry.contracts.reduce((n, c) => n + c.exchanges.length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// 2. Schema file structure
// ---------------------------------------------------------------------------

describe('Stage 3 — schema file structure', () => {
  const SCHEMA_FILES = [
    'ucas/application-inbound.v1.json',
    'ucas/confirmation-outbound.v1.json',
    'hesa/validation-report-inbound.v1.json',
    'slc/confirmation-outbound.v1.json',
    'slc/notification-inbound.v1.json',
    'ukvi/cas-request-outbound.v1.json',
    'ukvi/attendance-report-outbound.v1.json',
    'ukvi/visa-update-inbound.v1.json',
    'exam/entry-outbound.v1.json',
    'exam/schedule-inbound.v1.json',
  ];

  it('all schema files exist on disk', () => {
    for (const f of SCHEMA_FILES) {
      expect(existsSync(join(SCHEMA_ROOT, f)), `Missing: ${f}`).toBe(true);
    }
  });

  it('all schema files are valid JSON', async () => {
    for (const f of SCHEMA_FILES) {
      const raw = await readFile(join(SCHEMA_ROOT, f), 'utf8');
      expect(() => JSON.parse(raw), `Invalid JSON: ${f}`).not.toThrow();
    }
  });

  it('all schema files have required JSON Schema fields', async () => {
    const ajv = makeAjv();
    for (const f of SCHEMA_FILES) {
      const schema = await loadSchema(f) as Record<string, unknown>;
      expect(schema.$schema, `Missing $schema: ${f}`).toBeDefined();
      expect(schema.$id, `Missing $id: ${f}`).toBeDefined();
      expect(schema.title, `Missing title: ${f}`).toBeDefined();
      expect(schema.type, `Missing type: ${f}`).toBe('object');
      // Compiles without error
      expect(() => ajv.compile(schema), `Invalid JSON Schema: ${f}`).not.toThrow();
    }
  });

  it('all $id values follow the canonical URI pattern', async () => {
    for (const f of SCHEMA_FILES) {
      const schema = await loadSchema(f) as Record<string, unknown>;
      expect(String(schema.$id)).toMatch(/^https:\/\/schemas\.revelation-srs\.io\/file-contracts\//);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Spec documents
// ---------------------------------------------------------------------------

describe('Stage 3 — spec documents', () => {
  const SPEC_DOCS = [
    'README.md',
    'ucas-admissions-exchange.md',
    'hesa-student-return.md',
    'slc-enrolment-exchange.md',
    'ukvi-sponsor-compliance.md',
    'exam-scheduling.md',
  ];

  it('all spec documents exist', () => {
    for (const doc of SPEC_DOCS) {
      expect(existsSync(join(DOCS_ROOT, doc)), `Missing doc: ${doc}`).toBe(true);
    }
  });

  it('spec documents are non-empty', async () => {
    for (const doc of SPEC_DOCS) {
      const content = await readFile(join(DOCS_ROOT, doc), 'utf8');
      expect(content.length, `Empty doc: ${doc}`).toBeGreaterThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Payload validation — UCAS
// ---------------------------------------------------------------------------

describe('Stage 3 — UCAS payload validation', () => {
  let ajv: Ajv;
  let applicationSchema: object;
  let confirmationSchema: object;

  beforeAll(async () => {
    ajv = makeAjv();
    applicationSchema = await loadSchema('ucas/application-inbound.v1.json');
    confirmationSchema = await loadSchema('ucas/confirmation-outbound.v1.json');
    ajv.compile(applicationSchema);
    ajv.compile(confirmationSchema);
  });

  it('valid UCAS application inbound passes', () => {
    const validate = ajv.compile(applicationSchema);
    const valid = validate({
      ucasPersonalId: '0123456789',
      cycle: '2025',
      statusCode: 'A',
      legalFirstName: 'Jane',
      legalFamilyName: 'Smith',
      dateOfBirth: '2003-05-12',
      programmeId: 'e3d4c9f2-1111-2222-3333-444455556666',
      modeOfStudyCode: 'FT',
      academicYearOfEntry: '2025/26',
      startDate: '2025-09-15',
      feeBandCode: 'home',
      fundingSourceCode: 'slc',
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UCAS application missing required ucasPersonalId fails', () => {
    const validate = ajv.compile(applicationSchema);
    const valid = validate({ cycle: '2025', statusCode: 'A' });
    expect(valid).toBe(false);
  });

  it('UCAS application missing cycle fails', () => {
    const validate = ajv.compile(applicationSchema);
    const valid = validate({ ucasPersonalId: '0123456789', statusCode: 'A' });
    expect(valid).toBe(false);
  });

  it('valid UCAS confirmation outbound passes', () => {
    const validate = ajv.compile(confirmationSchema);
    const valid = validate({
      cycle: '2025',
      confirmations: [
        {
          triggerId: 'a1b2c3d4-0000-0000-0000-000000000001',
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          ucasPersonalId: '0123456789',
          confirmationType: 'enrolled',
          confirmedAt: '2025-09-01T09:00:00Z',
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UCAS confirmation with empty confirmations array passes', () => {
    const validate = ajv.compile(confirmationSchema);
    const valid = validate({ cycle: '2025', confirmations: [] });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UCAS confirmation with invalid confirmationType fails', () => {
    const validate = ajv.compile(confirmationSchema);
    const valid = validate({
      cycle: '2025',
      confirmations: [
        {
          triggerId: 'a1b2c3d4-0000-0000-0000-000000000001',
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          ucasPersonalId: '0123456789',
          confirmationType: 'transferred',
          confirmedAt: '2025-09-01T09:00:00Z',
        },
      ],
    });
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Payload validation — HESA
// ---------------------------------------------------------------------------

describe('Stage 3 — HESA payload validation', () => {
  let ajv: Ajv;
  let validationReportSchema: object;

  beforeAll(async () => {
    ajv = makeAjv();
    validationReportSchema = await loadSchema('hesa/validation-report-inbound.v1.json');
  });

  it('valid HESA validation report passes', () => {
    const validate = ajv.compile(validationReportSchema);
    const valid = validate({
      reportPayload: {
        submissionReference: 'HESA-2025-12345',
        validatedAt: '2025-02-15T14:30:00Z',
        errors: [],
        warnings: [
          { field: 'OWNSTU', message: '12 records have no OWNSTU set', severity: 'warning' },
        ],
        studentIdentifiers: [
          { enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000001', husid: '1234567890123', ownRef: 'ST12345' },
        ],
      },
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('HESA validation report without reportPayload fails', () => {
    const validate = ajv.compile(validationReportSchema);
    const valid = validate({ someOtherField: true });
    expect(valid).toBe(false);
  });

  it('HESA validation report with empty reportPayload passes (additionalProperties true)', () => {
    const validate = ajv.compile(validationReportSchema);
    const valid = validate({ reportPayload: {} });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Payload validation — SLC
// ---------------------------------------------------------------------------

describe('Stage 3 — SLC payload validation', () => {
  let ajv: Ajv;
  let confirmationSchema: object;
  let notificationSchema: object;

  beforeAll(async () => {
    ajv = makeAjv();
    confirmationSchema = await loadSchema('slc/confirmation-outbound.v1.json');
    notificationSchema = await loadSchema('slc/notification-inbound.v1.json');
  });

  it('valid SLC confirmation outbound passes', () => {
    const validate = ajv.compile(confirmationSchema);
    const valid = validate({
      confirmations: [
        {
          triggerId: 'a1b2c3d4-0000-0000-0000-000000000001',
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          slcReference: 'SLC-REF-12345',
          programmeId: null,
          modeOfStudyCode: 'FT',
          confirmationType: 'enrolment',
          feeAmount: '9250.00',
          startDate: '2025-09-15',
          expectedEndDate: '2028-06-30',
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('SLC confirmation with invalid confirmationType fails', () => {
    const validate = ajv.compile(confirmationSchema);
    const valid = validate({
      confirmations: [
        {
          triggerId: 'a1b2c3d4-0000-0000-0000-000000000001',
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          slcReference: 'SLC-REF-12345',
          modeOfStudyCode: 'FT',
          confirmationType: 'graduated',
          startDate: '2025-09-15',
        },
      ],
    });
    expect(valid).toBe(false);
  });

  it('valid SLC notification inbound passes', () => {
    const validate = ajv.compile(notificationSchema);
    const valid = validate({
      enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000001',
      notificationTypeCode: 'entitlement',
      effectiveDate: '2025-10-01',
      amount: '9250.00',
      idempotencyKey: 'SLC-TXN-987654',
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('SLC notification missing required enrolmentId fails', () => {
    const validate = ajv.compile(notificationSchema);
    const valid = validate({ notificationTypeCode: 'payment', effectiveDate: '2025-10-01' });
    expect(valid).toBe(false);
  });

  it('SLC notification with null amount passes', () => {
    const validate = ajv.compile(notificationSchema);
    const valid = validate({
      enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000001',
      notificationTypeCode: 'status-change',
      effectiveDate: '2025-10-01',
      amount: null,
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Payload validation — UKVI
// ---------------------------------------------------------------------------

describe('Stage 3 — UKVI payload validation', () => {
  let ajv: Ajv;
  let casRequestSchema: object;
  let attendanceSchema: object;
  let visaUpdateSchema: object;

  beforeAll(async () => {
    ajv = makeAjv();
    casRequestSchema = await loadSchema('ukvi/cas-request-outbound.v1.json');
    attendanceSchema = await loadSchema('ukvi/attendance-report-outbound.v1.json');
    visaUpdateSchema = await loadSchema('ukvi/visa-update-inbound.v1.json');
  });

  it('valid UKVI CAS request outbound passes', () => {
    const validate = ajv.compile(casRequestSchema);
    const valid = validate({
      processedCount: 1,
      casRequests: [
        {
          casRequestId: 'a1b2c3d4-0000-0000-0000-000000000001',
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          personData: {
            personId: 'a1b2c3d4-0000-0000-0000-000000000003',
            legalFirstName: 'Mei',
            legalFamilyName: 'Zhang',
            dateOfBirth: '2001-04-15',
            nationalityCode: 'CN',
            programmeId: null,
            programmeCode: 'BSC-COMP',
            programmeTitle: 'BSc Computer Science',
            modeOfStudyCode: 'FT',
            academicYearOfEntry: '2025/26',
            startDate: '2025-09-15',
            expectedEndDate: '2028-06-30',
          },
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UKVI CAS request missing processedCount fails', () => {
    const validate = ajv.compile(casRequestSchema);
    const valid = validate({ casRequests: [] });
    expect(valid).toBe(false);
  });

  it('valid UKVI attendance report passes', () => {
    const validate = ajv.compile(attendanceSchema);
    const valid = validate({
      academicPeriodId: 'a1b2c3d4-0000-0000-0000-000000000001',
      generatedAt: '2025-11-01T09:00:00Z',
      studentCount: 1,
      threshold: { unauthorisedAbsencesPerEightWeeks: 10 },
      _attendance_data_completeness: 'provided',
      students: [
        {
          enrolmentId: 'a1b2c3d4-0000-0000-0000-000000000002',
          personId: 'a1b2c3d4-0000-0000-0000-000000000003',
          casReference: 'A12345678910',
          programmeId: null,
          programmeCode: 'BSC-COMP',
          programmeTitle: null,
          enrolmentStatusCode: 'enrolled',
          legalFirstName: 'Mei',
          legalFamilyName: 'Zhang',
          absenceCount: 12,
          thresholdBreached: true,
          attendanceDataCompleteness: 'provided',
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UKVI attendance report with invalid _attendance_data_completeness fails', () => {
    const validate = ajv.compile(attendanceSchema);
    const valid = validate({
      academicPeriodId: 'a1b2c3d4-0000-0000-0000-000000000001',
      generatedAt: '2025-11-01T09:00:00Z',
      studentCount: 0,
      threshold: { unauthorisedAbsencesPerEightWeeks: 10 },
      _attendance_data_completeness: 'complete',
      students: [],
    });
    expect(valid).toBe(false);
  });

  it('valid UKVI visa update inbound passes', () => {
    const validate = ajv.compile(visaUpdateSchema);
    const valid = validate({
      casReference: 'A12345678910',
      statusCode: 'granted',
      effectiveDate: '2025-08-15',
      idempotencyKey: 'UKVI-NOTIF-2025-98765',
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('UKVI visa update missing casReference fails', () => {
    const validate = ajv.compile(visaUpdateSchema);
    const valid = validate({ statusCode: 'granted', effectiveDate: '2025-08-15' });
    expect(valid).toBe(false);
  });

  it('UKVI visa update missing statusCode fails', () => {
    const validate = ajv.compile(visaUpdateSchema);
    const valid = validate({ casReference: 'A12345678910', effectiveDate: '2025-08-15' });
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Payload validation — Exam Scheduling
// ---------------------------------------------------------------------------

describe('Stage 3 — Exam Scheduling payload validation', () => {
  let ajv: Ajv;
  let entrySchema: object;
  let scheduleSchema: object;

  beforeAll(async () => {
    ajv = makeAjv();
    entrySchema = await loadSchema('exam/entry-outbound.v1.json');
    scheduleSchema = await loadSchema('exam/schedule-inbound.v1.json');
  });

  it('valid exam entry outbound passes', () => {
    const validate = ajv.compile(entrySchema);
    const valid = validate({
      entryCount: 1,
      entries: [
        {
          examEntryId: 'a1b2c3d4-0000-0000-0000-000000000001',
          moduleRegistrationId: 'a1b2c3d4-0000-0000-0000-000000000002',
          examBoardId: 'a1b2c3d4-0000-0000-0000-000000000003',
          candidateNumber: null,
          scheduledDate: null,
          roomReference: null,
          statusCode: 'pending',
          accommodations: { 'extra-time-25pc': { duration: '75 minutes' } },
          validFrom: '2025-10-01T00:00:00Z',
          recordedAt: '2025-10-01T09:00:00Z',
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('exam entry outbound with empty entries passes', () => {
    const validate = ajv.compile(entrySchema);
    const valid = validate({ entryCount: 0, entries: [] });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('exam entry outbound missing entryCount fails', () => {
    const validate = ajv.compile(entrySchema);
    const valid = validate({ entries: [] });
    expect(valid).toBe(false);
  });

  it('valid exam schedule inbound passes', () => {
    const validate = ajv.compile(scheduleSchema);
    const valid = validate({
      candidates: [
        {
          moduleRegistrationId: 'a1b2c3d4-0000-0000-0000-000000000001',
          candidateNumber: '0001',
          scheduledDate: '2025-11-15T09:00:00Z',
          room: 'B-101',
        },
      ],
    });
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('exam schedule with empty candidates array fails (minItems: 1)', () => {
    const validate = ajv.compile(scheduleSchema);
    const valid = validate({ candidates: [] });
    expect(valid).toBe(false);
  });

  it('exam schedule candidate missing candidateNumber fails', () => {
    const validate = ajv.compile(scheduleSchema);
    const valid = validate({
      candidates: [
        {
          moduleRegistrationId: 'a1b2c3d4-0000-0000-0000-000000000001',
          scheduledDate: '2025-11-15T09:00:00Z',
          room: 'B-101',
        },
      ],
    });
    expect(valid).toBe(false);
  });
});
