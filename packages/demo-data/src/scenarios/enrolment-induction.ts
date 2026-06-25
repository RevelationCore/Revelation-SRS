import {
  academicPeriods,
  deploymentEnvironments,
  awardingBodies,
  enrolmentDownstreamTriggers,
  enrolments,
  feeLiabilities,
  moduleOfferings,
  modules,
  personIdentities,
  persons,
  programmes,
  slcNotifications,
  studentAddresses,
  studentContactMethods,
  ukviCasRequests,
  type Db,
} from '@revelation-srs/db';

import {
  flattenBundles,
  generateCurriculum,
  generateMultiYearCalendar,
  generatePersonBundle,
  personId as mkPersonId,
  ucasPersonalId,
} from '../generators/index.js';
import { provisionPersonas } from '../generators/keycloak.js';
import { BASELINE_PROGRAMMES } from '../generators/curriculum.js';
import { programmeId } from '../generators/curriculum.js';
import { PERSONA_IDS } from '../persona-ids.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';
import { deterministicId } from '../generators/ids.js';

export const manifest: ScenarioManifest = {
  slug:             'enrolment-induction',
  name:             'S2 — Enrolment and Induction',
  schemaVersion:    '0023',
  referenceDate:    '2025-11-14',
  academicYears:    ['2024-25', '2025-26'],
  targetVolumes:    {
    students:            1_000,
    enrolments:          1_000,
    feeLiabilities:        725,
    slcNotifications:      500,
    ukviCasRequests:        30,
    downstreamTriggers:    750,
  },
  loadTimeBudgetMs: 120_000,
  storyMarkers:     [
    STORY_MARKERS.S2_ALICE_ENROLLED,
    STORY_MARKERS.S2_BOB_INTERMITTING,
    STORY_MARKERS.S2_CAROL_GRADUATED,
  ],
  phases: ['reference-data', 'personas', 'persons', 'enrolments', 'regulatory'],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STUDENTS  = 1_000;
const VALID_FROM      = new Date('2024-08-01T00:00:00Z');
const ACTOR           = 'demo-data:enrolment-induction';

// ─── Derived status from seq ───────────────────────────────────────────────────

// Distribution: 65% enrolled, 5% intermitting, 10% withdrawn, 20% graduated
function statusCodeForSeq(seq: number): 'enrolled' | 'intermitting' | 'withdrawn' | 'graduated' {
  const r = seq % 20;
  if (r <= 12) return 'enrolled';
  if (r === 13) return 'intermitting';
  if (r <= 15)  return 'withdrawn';
  return 'graduated';
}

// Mode of study: 85% full-time, 10% part-time, 3% distance, 2% sandwich
function modeOfStudyForSeq(seq: number): string {
  const r = seq % 20;
  if (r <= 16) return 'full-time';
  if (r === 17) return 'part-time';
  if (r === 18) return 'distance';
  return 'sandwich';
}

// International students: 8% (seq % 25 === 0)
function isInternationalForSeq(seq: number): boolean {
  return seq % 25 === 0;
}

// UCAS-sourced: 55% of domestic students (seq % 9 !== 0 among non-international)
function isUcasForSeq(seq: number): boolean {
  return !isInternationalForSeq(seq) && seq % 9 !== 0;
}

function academicYearOfEntryForSeq(seq: number, status: string): string {
  if (status === 'graduated') return '2022-23';
  if (status === 'withdrawn')  return '2024-25';
  if (status === 'intermitting') return '2024-25';
  // enrolled: mix of 2024-25 and 2025-26
  return seq % 3 === 0 ? '2025-26' : '2024-25';
}

function startDateForSeq(status: string, entryYear: string): string {
  const year = parseInt(entryYear.split('-')[0]!, 10);
  if (status === 'graduated') return `${year}-09-23`;
  return `${year}-09-23`;
}

function enrolmentId(tenantId: string, seq: number): string {
  return deterministicId('enrolment', tenantId, String(seq));
}

function feeLiabilityId(tenantId: string, seq: number): string {
  return deterministicId('fee-liability', tenantId, String(seq));
}

function slcNotificationId(tenantId: string, seq: number): string {
  return deterministicId('slc-notification', tenantId, String(seq));
}

function ukviCasId(tenantId: string, seq: number): string {
  return deterministicId('ukvi-cas', tenantId, String(seq));
}

function downstreamTriggerId(tenantId: string, seq: number, triggerType: string): string {
  return deterministicId('downstream-trigger', tenantId, String(seq), triggerType);
}

// ─── Story markers ────────────────────────────────────────────────────────────
// Sequences 1-3 are reserved for alice (enrolled), bob (intermitting), carol (graduated).

interface S2StoryMarker {
  seq:          number;
  statusCode:   'enrolled' | 'intermitting' | 'graduated';
  entryYear:    string;
  personaId:    string;
  isUcas:       boolean;
  isIntl:       boolean;
}

const S2_STORY_MARKERS: S2StoryMarker[] = [
  { seq: 1, statusCode: 'enrolled',     entryYear: '2025-26', personaId: PERSONA_IDS.STUDENT_STANDARD,     isUcas: true,  isIntl: false },
  { seq: 2, statusCode: 'intermitting', entryYear: '2024-25', personaId: PERSONA_IDS.STUDENT_INTERMITTING, isUcas: false, isIntl: false },
  { seq: 3, statusCode: 'graduated',    entryYear: '2022-23', personaId: PERSONA_IDS.STUDENT_GRADUATED,    isUcas: true,  isIntl: false },
];

// ─── Load function ────────────────────────────────────────────────────────────

export async function load(
  db:       Db,
  tenantId: string,
  phase:    string,
  opts:     { dryRun?: boolean },
): Promise<void> {
  if (opts.dryRun) return;

  switch (phase) {
    case 'reference-data': return loadReferenceData(db, tenantId);
    case 'personas':       return loadPersonas();
    case 'persons':        return loadPersons(db, tenantId);
    case 'enrolments':     return loadEnrolments(db, tenantId);
    case 'regulatory':     return loadRegulatory(db, tenantId);
    default: return;
  }
}

// ─── Phase implementations ────────────────────────────────────────────────────

const DEMO_ENVIRONMENT = {
  id:                      '00000000-0000-0000-0000-000000000002',
  environmentCode:         'development',
  displayName:             'Local development',
  environmentTypeCode:     'local',
  productionLike:          false,
  liveIntegrationsAllowed: false,
  configuration:           {} as Record<string, unknown>,
  active:                  true,
};

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const periods    = generateMultiYearCalendar(tenantId, manifest.academicYears);
  const curriculum = generateCurriculum(tenantId, manifest.academicYears);

  await batchInsert(db, academicPeriods, periods);
  await batchInsert(db, awardingBodies,  curriculum.awardingBodies);
  await batchInsert(db, programmes,      curriculum.programmes);
  await batchInsert(db, modules,         curriculum.modules);
  await batchInsert(db, moduleOfferings, curriculum.moduleOfferings);
  await batchInsert(db, deploymentEnvironments, [DEMO_ENVIRONMENT]);
}

async function loadPersonas(): Promise<void> {
  const hardFail = process.env['KEYCLOAK_REQUIRED'] === 'true';
  await provisionPersonas({ hardFail });
}

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  const bundles = [];

  // Story markers (seqs 1-3)
  for (const sm of S2_STORY_MARKERS) {
    bundles.push(generatePersonBundle(tenantId, sm.seq, {
      statusCode:         sm.statusCode,
      sourceSystem:       sm.isUcas ? 'ucas' : 'direct',
      ...(sm.isUcas ? { sourceReference: ucasPersonalId(sm.seq) } : {}),
      includeTermAddress: sm.statusCode === 'enrolled' || sm.statusCode === 'intermitting',
      validFrom:          VALID_FROM,
    }));
  }

  // General students (seqs 4-TOTAL_STUDENTS)
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const status   = statusCodeForSeq(seq);
    const isIntl   = isInternationalForSeq(seq);
    const isUcas   = isUcasForSeq(seq);
    const isActive = status === 'enrolled' || status === 'intermitting';
    bundles.push(generatePersonBundle(tenantId, seq, {
      statusCode:         status,
      sourceSystem:       isIntl ? 'international' : (isUcas ? 'ucas' : 'direct'),
      ...(isUcas ? { sourceReference: ucasPersonalId(seq) } : {}),
      includeTermAddress: isActive,
      validFrom:          VALID_FROM,
    }));
  }

  const flat = flattenBundles(bundles);
  await batchInsert(db, persons,               flat.persons);
  await batchInsert(db, personIdentities,      flat.identities);
  await batchInsert(db, studentAddresses,      flat.addresses);
  await batchInsert(db, studentContactMethods, flat.contactMethods);
}

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  const enrolmentRows    = [];
  const feeLiabilityRows = [];
  const progIds = BASELINE_PROGRAMMES.map(p => programmeId(tenantId, p.code));

  // Story markers
  for (const sm of S2_STORY_MARKERS) {
    const pid     = mkPersonId(tenantId, sm.seq);
    const eid     = enrolmentId(tenantId, sm.seq);
    const progId  = progIds[sm.seq % progIds.length]!;
    const entryYr = sm.entryYear;
    const mode    = 'full-time';

    enrolmentRows.push({
      id:                  eid,
      tenantId,
      validFrom:           VALID_FROM,
      recordedAt:          VALID_FROM,
      personId:            pid,
      programmeId:         progId,
      statusCode:          sm.statusCode,
      modeOfStudyCode:     mode,
      academicYearOfEntry: entryYr,
      startDate:           startDateForSeq(sm.statusCode, entryYr),
      expectedEndDate:     sm.statusCode === 'graduated' ? '2025-06-27' : null,
      actualEndDate:       sm.statusCode === 'graduated' ? '2025-06-27' : null,
      feeBandCode:         'home',
      fundingSourceCode:   'slc',
      ucasPersonalId:      sm.isUcas ? ucasPersonalId(sm.seq) : null,
      slcReference:        sm.isUcas ? `SLC${String(sm.seq).padStart(9, '0')}` : null,
    });

    {
      feeLiabilityRows.push({
        id:                feeLiabilityId(tenantId, sm.seq),
        tenantId,
        enrolmentId:       eid,
        personId:          pid,
        academicYear:      entryYr,
        feeBandCode:       'home',
        fundingSourceCode: 'slc',
        currencyCode:      'GBP',
        amountMinorUnits:  BigInt(925_000),
        statusCode:        sm.statusCode === 'graduated' ? 'settled' : 'generated',
      });
    }
  }

  // General students
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const status  = statusCodeForSeq(seq);
    const mode    = modeOfStudyForSeq(seq);
    const isIntl  = isInternationalForSeq(seq);
    const isUcas  = isUcasForSeq(seq);
    const entryYr = academicYearOfEntryForSeq(seq, status);
    const pid     = mkPersonId(tenantId, seq);
    const eid     = enrolmentId(tenantId, seq);
    const progId  = progIds[seq % progIds.length]!;

    enrolmentRows.push({
      id:                  eid,
      tenantId,
      validFrom:           VALID_FROM,
      recordedAt:          VALID_FROM,
      personId:            pid,
      programmeId:         progId,
      statusCode:          status,
      modeOfStudyCode:     mode,
      academicYearOfEntry: entryYr,
      startDate:           startDateForSeq(status, entryYr),
      expectedEndDate:     status === 'graduated' ? '2025-06-27' : null,
      actualEndDate:       status === 'graduated' ? '2025-06-27' : null,
      feeBandCode:         isIntl ? 'international' : 'home',
      fundingSourceCode:   isIntl ? 'self' : 'slc',
      ucasPersonalId:      isUcas ? ucasPersonalId(seq) : null,
      slcReference:        (!isIntl && !isUcas) ? null : (!isIntl ? `SLC${String(seq).padStart(9, '0')}` : null),
    });

    if (status !== 'withdrawn') {
      feeLiabilityRows.push({
        id:                feeLiabilityId(tenantId, seq),
        tenantId,
        enrolmentId:       eid,
        personId:          pid,
        academicYear:      entryYr,
        feeBandCode:       isIntl ? 'international' : 'home',
        fundingSourceCode: isIntl ? 'self' : 'slc',
        currencyCode:      'GBP',
        amountMinorUnits:  isIntl ? BigInt(2_000_000) : BigInt(925_000),
        statusCode:        status === 'graduated' ? 'settled' : 'generated',
      });
    }
  }

  await batchInsert(db, enrolments,      enrolmentRows);
  await batchInsert(db, feeLiabilities,  feeLiabilityRows);
}

async function loadRegulatory(db: Db, tenantId: string): Promise<void> {
  const slcRows:     Record<string, unknown>[] = [];
  const ukviRows:    Record<string, unknown>[] = [];
  const triggerRows: Record<string, unknown>[] = [];

  const processSeq = (seq: number, status: string, entryYear: string, isIntl: boolean, isUcas: boolean) => {
    if (status === 'withdrawn' || status === 'graduated') return;

    const eid = enrolmentId(tenantId, seq);

    if (isIntl) {
      // UKVI CAS request for international enrolled students
      const casStatuses = ['pending', 'issued', 'issued', 'used'];
      ukviRows.push({
        id:           ukviCasId(tenantId, seq),
        tenantId,
        validFrom:    VALID_FROM,
        recordedAt:   VALID_FROM,
        enrolmentId:  eid,
        casReference: `DEMO-CAS-${String(seq).padStart(7, '0')}`,
        statusCode:   casStatuses[seq % casStatuses.length]!,
      });
    } else {
      // SLC notification for domestic students
      slcRows.push({
        id:                   slcNotificationId(tenantId, seq),
        tenantId,
        enrolmentId:          eid,
        notificationTypeCode: 'attendance-confirmation',
        effectiveDate:        `${parseInt(entryYear.split('-')[0]!, 10)}-11-01`,
        amount:               '9250.00',
        rawPayload:           { source: 'demo', actor: ACTOR },
      });

      // Downstream UCAS confirmation trigger
      if (isUcas) {
        triggerRows.push({
          id:              downstreamTriggerId(tenantId, seq, 'ucas-confirmation'),
          tenantId,
          enrolmentId:     eid,
          triggerTypeCode: 'ucas-confirmation',
          statusCode:      'sent',
          payloadSummary:  { ucasPersonalId: ucasPersonalId(seq), actor: ACTOR },
        });
      }

      // SLC confirmation trigger
      triggerRows.push({
        id:              downstreamTriggerId(tenantId, seq, 'slc-notification'),
        tenantId,
        enrolmentId:     eid,
        triggerTypeCode: 'slc-notification',
        statusCode:      'sent',
        payloadSummary:  { actor: ACTOR },
      });
    }
  };

  // Story markers
  for (const sm of S2_STORY_MARKERS) {
    processSeq(sm.seq, sm.statusCode, sm.entryYear, false, sm.isUcas);
  }

  // General students
  for (let seq = 4; seq <= TOTAL_STUDENTS; seq++) {
    const status  = statusCodeForSeq(seq);
    const isIntl  = isInternationalForSeq(seq);
    const isUcas  = isUcasForSeq(seq);
    const entryYr = academicYearOfEntryForSeq(seq, status);
    processSeq(seq, status, entryYr, isIntl, isUcas);
  }

  await batchInsert(db, slcNotifications,          slcRows);
  await batchInsert(db, ukviCasRequests,           ukviRows);
  await batchInsert(db, enrolmentDownstreamTriggers, triggerRows);
}
