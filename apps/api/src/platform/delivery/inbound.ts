import { and, desc, eq } from 'drizzle-orm';
import { externalRecords, persons, type Db, type ExternalRecord, withTenantContext } from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface InboundField {
  name:      string;
  label:     string;
  type:      'integer' | 'text' | 'date' | 'code';
  required:  boolean;
  /** For type 'code': the value set (entity/field binding) the value must be in. */
  valueSet?: { entity: string; field: string };
  min?:      number;
}

/**
 * Inbound reference-model flows: what an adjacent system reports about a
 * student. `fields` drive validation and the staff entry form; a flow with
 * no fields is registered (so the gap is visible) but cannot be recorded yet.
 */
export interface InboundFlow {
  flowCode:     string;
  sourceSystem: string;
  sourceLabel:  string;
  name:         string;
  /**
   * record          — stored here as an external_record (has fields)
   * dedicated       — has its own SRS route (handlingNote says which)
   * not-per-student — not about one student, so not stored on a student record
   */
  handling:     'record' | 'dedicated' | 'not-per-student';
  handlingNote?: string;
  /** Payload field that identifies the record (e.g. a booking); absent: one record per student. */
  recordKeyField?: string;
  fields:       InboundField[];
  summarise:    (payload: Record<string, unknown>) => string;
}

const pence = (v: unknown): string => `£${(Number(v) / 100).toFixed(2)}`;
/** A validated payload value as text (they are only strings and numbers). */
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export const INBOUND_FLOWS: readonly InboundFlow[] = [
  {
    flowCode: 'F-LIB-SIS-01', sourceSystem: 'lib', sourceLabel: 'Library',
    name: 'Library account: loans, overdue items and fines', handling: 'record',
    fields: [
      { name: 'accountStatus', label: 'Account status', type: 'code', required: true, valueSet: { entity: 'external_record_library', field: 'account_status' } },
      { name: 'loansOnIssue', label: 'Loans on issue', type: 'integer', required: true, min: 0 },
      { name: 'overdueItems', label: 'Overdue items', type: 'integer', required: true, min: 0 },
      { name: 'outstandingBalancePence', label: 'Outstanding balance (pence)', type: 'integer', required: true, min: 0 },
    ],
    summarise: (p) => `Library account ${text(p['accountStatus'])}: ${text(p['loansOnIssue'])} on loan, ${text(p['overdueItems'])} overdue, ${pence(p['outstandingBalancePence'])} outstanding`,
  },
  {
    flowCode: 'F-ACC-SIS-01', sourceSystem: 'acc', sourceLabel: 'Accommodation',
    name: 'Accommodation booking: allocation and check-in/out', handling: 'record',
    recordKeyField: 'bookingReference',
    fields: [
      { name: 'bookingReference', label: 'Booking reference', type: 'text', required: true },
      { name: 'bookingStatus', label: 'Booking status', type: 'code', required: true, valueSet: { entity: 'external_record_accommodation', field: 'booking_status' } },
      { name: 'roomReference', label: 'Room', type: 'text', required: false },
      { name: 'startDate', label: 'From', type: 'date', required: false },
      { name: 'endDate', label: 'To', type: 'date', required: false },
    ],
    summarise: (p) => `Booking ${text(p['bookingReference'])} ${text(p['bookingStatus'])}${p['roomReference'] ? `, room ${text(p['roomReference'])}` : ''}${p['startDate'] ? ` from ${text(p['startDate'])}` : ''}${p['endDate'] ? ` to ${text(p['endDate'])}` : ''}`,
  },
  {
    flowCode: 'F-PAY-SIS-01', sourceSystem: 'pay', sourceLabel: 'Payroll',
    name: 'Bursary and stipend payment confirmations', handling: 'record',
    recordKeyField: 'paymentReference',
    fields: [
      { name: 'paymentReference', label: 'Payment reference', type: 'text', required: true },
      { name: 'paymentType', label: 'Payment type', type: 'code', required: true, valueSet: { entity: 'external_record_payroll', field: 'payment_type' } },
      { name: 'amountPence', label: 'Amount (pence)', type: 'integer', required: true, min: 0 },
      { name: 'paidOn', label: 'Paid on', type: 'date', required: true },
    ],
    summarise: (p) => `${text(p['paymentType'])} payment ${text(p['paymentReference'])}: ${pence(p['amountPence'])} paid ${text(p['paidOn'])}`,
  },
  {
    flowCode: 'F-RP-SIS-01', sourceSystem: 'rp', sourceLabel: 'Research portal',
    name: 'Funded studentship awards', handling: 'record',
    recordKeyField: 'awardReference',
    fields: [
      { name: 'awardReference', label: 'Award reference', type: 'text', required: true },
      { name: 'funder', label: 'Funder', type: 'text', required: true },
      { name: 'awardStatus', label: 'Status', type: 'code', required: true, valueSet: { entity: 'external_record_research', field: 'award_status' } },
      { name: 'startDate', label: 'From', type: 'date', required: false },
      { name: 'endDate', label: 'To', type: 'date', required: false },
    ],
    summarise: (p) => `Studentship ${text(p['awardReference'])} (${text(p['funder'])}) ${text(p['awardStatus'])}${p['startDate'] ? ` from ${text(p['startDate'])}` : ''}${p['endDate'] ? ` to ${text(p['endDate'])}` : ''}`,
  },
  {
    flowCode: 'F-ITSM-SIS-01', sourceSystem: 'itsm', sourceLabel: 'IT service desk',
    name: 'Service request outcomes affecting the student account', handling: 'record',
    recordKeyField: 'ticketReference',
    fields: [
      { name: 'ticketReference', label: 'Ticket reference', type: 'text', required: true },
      { name: 'outcome', label: 'Outcome', type: 'code', required: true, valueSet: { entity: 'external_record_itsm', field: 'outcome' } },
      { name: 'closedOn', label: 'Closed on', type: 'date', required: false },
    ],
    summarise: (p) => `Service request ${text(p['ticketReference'])}: ${text(p['outcome'])}${p['closedOn'] ? ` on ${text(p['closedOn'])}` : ''}`,
  },
  ...([
    ['F-OIV-SIS-01', 'oiv', 'Identity verification', 'Verification outcome, confidence and fraud flags', 'dedicated',
      'Recorded on the identity verification check: POST /students/{id}/identity-verifications/{checkId}/completion (it also completes the F-SIS-OIV-01 request).'],
    ['F-CRM-SIS-01', 'crm', 'CRM', 'Applicant, offer and admissions decisions', 'dedicated',
      'Admissions data arrives through the admissions hand-off and the UCAS integration, not as a student record.'],
    ['F-CM-SIS-01', 'cm', 'Curriculum management', 'Programme and module catalogue updates', 'dedicated',
      'Catalogue changes go through the programme and module catalogue API (/programmes, /modules).'],
    ['F-EST-SIS-01', 'est', 'Estates', 'Room allocation confirmations and availability', 'not-per-student',
      'About rooms and timetable slots, not one student; needs a rooms/timetabling model the SRS does not have.'],
    ['F-SETS-SIS-01', 'sets', 'Survey system', 'Survey completion and aggregated feedback', 'not-per-student',
      'Aggregated per module, not per student; belongs with module evaluation and analytics.'],
    ['F-CMS-SIS-01', 'cms', 'Content management', 'Published regulatory and policy notifications', 'not-per-student',
      'Institution-wide notices, not about one student; belongs with communications.'],
  ] as const).map(([flowCode, sourceSystem, sourceLabel, name, handling, handlingNote]) => ({
    flowCode, sourceSystem, sourceLabel, name, handling, handlingNote, fields: [], summarise: () => '',
  })),
];

export function findInboundFlow(flowCode: string): InboundFlow | undefined {
  return INBOUND_FLOWS.find((f) => f.flowCode === flowCode);
}

export interface ReceiveInput {
  personId?:      string;
  /** Alternative to personId for connectors that know the student number. */
  studentNumber?: string;
  payload:        Record<string, unknown>;
  observedAt?:    string;
  /** Identifies this report; a repeat records nothing new. */
  idempotencyKey: string;
}

export interface ExternalRecordDto {
  externalRecordId: string;
  flowCode:         string;
  flowName:         string;
  sourceLabel:      string;
  personId:         string;
  recordKey:        string;
  payload:          Record<string, unknown>;
  summary:          string;
  observedAt:       Date;
  receivedAt:       Date;
  receivedVia:      string;
  /** False for earlier observations of the same record. */
  current:          boolean;
}

/**
 * Records adjacent systems report about a student, from a connector or
 * entered by staff. Informational only: nothing here changes academic status.
 */
export class InboundRecordService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
  ) {}

  async receive(
    tenantId: string,
    flowCode: string,
    input: ReceiveInput,
    via: 'connector' | 'person',
    actorId: string,
  ): Promise<{ record: ExternalRecordDto; replayed: boolean }> {
    const flow = findInboundFlow(flowCode);
    if (!flow) throw new NotFoundError('InboundFlow', flowCode);
    if (flow.handling !== 'record') {
      throw new ValidationError(`${flowCode} is not stored as a student record: ${flow.handlingNote ?? ''}`.trim());
    }
    const payload = await this.#validate(tenantId, flow, input.payload);
    const personId = await this.#resolvePerson(tenantId, input);
    const observedAt = input.observedAt ? new Date(input.observedAt) : clockNow();
    if (Number.isNaN(observedAt.getTime())) {
      throw new ValidationError('observedAt must be a date-time', [{ field: 'observedAt', message: 'Must be a date-time' }]);
    }
    const recordKey = flow.recordKeyField ? text(payload[flow.recordKeyField]) : 'account';

    const result = await withTenantContext(this.db, tenantId, async (tx) => {
      const inserted = await tx.insert(externalRecords).values({
        tenantId: tenantId as Uuid,
        flowCode,
        personId: personId as Uuid,
        recordKey,
        payload,
        summary: flow.summarise(payload),
        observedAt,
        receivedAt: clockNow(),
        receivedVia: via,
        actorId,
        idempotencyKey: input.idempotencyKey,
      }).onConflictDoNothing().returning();
      if (inserted[0]) return { row: inserted[0], replayed: false };
      const [existing] = await tx.select().from(externalRecords).where(and(
        eq(externalRecords.tenantId, tenantId as Uuid),
        eq(externalRecords.flowCode, flowCode),
        eq(externalRecords.idempotencyKey, input.idempotencyKey),
      ));
      return { row: existing!, replayed: true };
    });

    const all = await this.listForPerson(tenantId, result.row.personId);
    return { record: all.find((r) => r.externalRecordId === result.row.id)!, replayed: result.replayed };
  }

  /** Newest first; `current` marks the latest observation of each record. */
  async listForPerson(tenantId: string, personId: string): Promise<ExternalRecordDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(externalRecords).where(and(
        eq(externalRecords.tenantId, tenantId as Uuid),
        eq(externalRecords.personId, personId as Uuid),
      )).orderBy(desc(externalRecords.observedAt), desc(externalRecords.receivedAt)),
    );
    const seen = new Set<string>();
    return rows.map((row) => {
      const key = `${row.flowCode}|${row.recordKey}`;
      const current = !seen.has(key);
      seen.add(key);
      return toDto(row, current);
    });
  }

  async #validate(tenantId: string, flow: InboundFlow, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const errors: Array<{ field: string; message: string }> = [];
    for (const field of flow.fields) {
      const value = raw[field.name];
      if (value === undefined || value === null || value === '') {
        if (field.required) errors.push({ field: field.name, message: 'Required' });
        continue;
      }
      switch (field.type) {
        case 'integer': {
          const n = typeof value === 'number' ? value : Number(value);
          if (!Number.isInteger(n) || (field.min !== undefined && n < field.min)) {
            errors.push({ field: field.name, message: `Must be a whole number${field.min !== undefined ? ` of at least ${field.min}` : ''}` });
          } else out[field.name] = n;
          break;
        }
        case 'date':
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push({ field: field.name, message: 'Must be a date (YYYY-MM-DD)' });
          else out[field.name] = value;
          break;
        case 'code': {
          if (typeof value !== 'string') {
            errors.push({ field: field.name, message: 'Must be a code' });
            break;
          }
          const valid = await this.valueSets.validateFieldValue(field.valueSet!.entity, field.valueSet!.field, value, tenantId);
          if (valid === false) errors.push({ field: field.name, message: 'Value is not active in the configured value set' });
          else out[field.name] = value;
          break;
        }
        default:
          if (typeof value !== 'string' || value.length > 200) errors.push({ field: field.name, message: 'Must be text of at most 200 characters' });
          else out[field.name] = value.trim();
      }
    }
    if (errors.length > 0) throw new ValidationError(`Invalid ${flow.flowCode} record`, errors);
    return out;
  }

  async #resolvePerson(tenantId: string, input: ReceiveInput): Promise<string> {
    if (!input.personId && !input.studentNumber) {
      throw new ValidationError('personId or studentNumber is required', [{ field: 'personId', message: 'Required' }]);
    }
    const [row] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: persons.id }).from(persons).where(and(
        eq(persons.tenantId, tenantId as Uuid),
        input.personId ? eq(persons.id, input.personId as Uuid) : eq(persons.studentNumber, input.studentNumber!),
      )).limit(1),
    );
    if (!row) throw new NotFoundError('Person', input.personId ?? input.studentNumber!);
    return row.id;
  }
}

function toDto(row: ExternalRecord, current: boolean): ExternalRecordDto {
  const flow = findInboundFlow(row.flowCode);
  return {
    externalRecordId: row.id,
    flowCode: row.flowCode,
    flowName: flow?.name ?? row.flowCode,
    sourceLabel: flow?.sourceLabel ?? row.flowCode,
    personId: row.personId,
    recordKey: row.recordKey,
    payload: row.payload,
    summary: row.summary,
    observedAt: row.observedAt,
    receivedAt: row.receivedAt,
    receivedVia: row.receivedVia,
    current,
  };
}
