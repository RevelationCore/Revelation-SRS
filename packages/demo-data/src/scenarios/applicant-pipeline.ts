import {
  academicPeriods,
  awardingBodies,
  moduleOfferings,
  modules,
  personIdentities,
  persons,
  programmes,
  studentAddresses,
  ucasApplications,
  type Db,
} from '@revelation-srs/db';

import {
  flattenBundles,
  generateCurriculum,
  generateMultiYearCalendar,
  generatePersonBundle,
  ucasPersonalId,
} from '../generators/index.js';
import { provisionPersonas } from '../generators/keycloak.js';
import { PERSONA_IDS } from '../persona-ids.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';
import { batchInsert } from '../utils/batch.js';
import { deterministicId } from '../generators/ids.js';

export const manifest: ScenarioManifest = {
  slug:             'applicant-pipeline',
  name:             'S1 — Applicant Pipeline',
  schemaVersion:    '0023',
  referenceDate:    '2025-11-14',
  academicYears:    ['2025-26'],
  targetVolumes:    {
    applicants:        600,
    ucasApplications:  420,
  },
  loadTimeBudgetMs: 60_000,
  storyMarkers:     [
    STORY_MARKERS.S1_ALICE_APPLICANT,
    STORY_MARKERS.S1_BOB_APPLICANT,
    STORY_MARKERS.S1_CAROL_APPLICANT,
  ],
  phases: ['reference-data', 'personas', 'persons', 'admissions'],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_APPLICANTS = 600;
const ACADEMIC_YEAR    = '2025-26';
const VALID_FROM       = new Date('2025-08-01T00:00:00Z');
const ACTOR            = 'demo-data:applicant-pipeline';

// Offer status distribution by (seq % 7)
const OFFER_STATUS: readonly string[] = [
  'submitted',    // 0
  'under-review', // 1
  'under-review', // 2
  'conditional',  // 3
  'conditional',  // 4
  'unconditional',// 5
  'rejected',     // 6
];

// Source system distribution by (seq % 20)
// 70% ucas, 10% direct, 10% international, 5% agent, 5% clearing
function sourceSystemForSeq(seq: number): string {
  const r = seq % 20;
  if (r <= 13) return 'ucas';
  if (r <= 15) return 'direct';
  if (r <= 17) return 'international';
  if (r === 18) return 'agent';
  return 'clearing';
}

// ─── Story markers ────────────────────────────────────────────────────────────
// Sequences 1-3 are reserved for alice, bob, carol.

interface StoryMarkerSpec {
  seq:          number;
  sourceSystem: string;
  offerStatus:  string;
  personaId:    string;
}

const STORY_MARKER_SPECS: StoryMarkerSpec[] = [
  { seq: 1, sourceSystem: 'ucas',          offerStatus: 'conditional',  personaId: PERSONA_IDS.STUDENT_STANDARD     },
  { seq: 2, sourceSystem: 'direct',        offerStatus: 'under-review', personaId: PERSONA_IDS.STUDENT_INTERMITTING },
  { seq: 3, sourceSystem: 'international', offerStatus: 'conditional',  personaId: PERSONA_IDS.STUDENT_GRADUATED    },
];

function ucasApplicationIdForSeq(tenantId: string, seq: number): string {
  return deterministicId('ucas-application', tenantId, String(seq));
}

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
    case 'personas':        return loadPersonas();
    case 'persons':         return loadPersons(db, tenantId);
    case 'admissions':      return loadAdmissions(db, tenantId);
    default: return;
  }
}

// ─── Phase implementations ────────────────────────────────────────────────────

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  const periods    = generateMultiYearCalendar(tenantId, manifest.academicYears);
  const curriculum = generateCurriculum(tenantId, manifest.academicYears);

  await batchInsert(db, academicPeriods, periods);
  await batchInsert(db, awardingBodies,  curriculum.awardingBodies);
  await batchInsert(db, programmes,      curriculum.programmes);
  await batchInsert(db, modules,         curriculum.modules);
  await batchInsert(db, moduleOfferings, curriculum.moduleOfferings);
}

async function loadPersonas(): Promise<void> {
  const hardFail = process.env['KEYCLOAK_REQUIRED'] === 'true';
  await provisionPersonas({ hardFail });
}

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  const bundles = [];

  // Story-marker personas (seqs 1-3)
  for (const spec of STORY_MARKER_SPECS) {
    bundles.push(generatePersonBundle(tenantId, spec.seq, {
      statusCode:   'prospective',
      sourceSystem: spec.sourceSystem,
      ...(spec.sourceSystem === 'ucas' ? { sourceReference: ucasPersonalId(spec.seq) } : {}),
      validFrom:    VALID_FROM,
    }));
  }

  // General applicants (seqs 4-TOTAL_APPLICANTS)
  for (let seq = 4; seq <= TOTAL_APPLICANTS; seq++) {
    const ss = sourceSystemForSeq(seq);
    bundles.push(generatePersonBundle(tenantId, seq, {
      statusCode:   'prospective',
      sourceSystem: ss,
      ...(ss === 'ucas' ? { sourceReference: ucasPersonalId(seq) } : {}),
      validFrom:    VALID_FROM,
    }));
  }

  const flat = flattenBundles(bundles);
  await batchInsert(db, persons,          flat.persons);
  await batchInsert(db, personIdentities, flat.identities);
  await batchInsert(db, studentAddresses, flat.addresses);
}

async function loadAdmissions(db: Db, tenantId: string): Promise<void> {
  const apps = [];

  // Story markers
  for (const spec of STORY_MARKER_SPECS) {
    if (spec.sourceSystem !== 'ucas') continue;
    apps.push({
      id:            ucasApplicationIdForSeq(tenantId, spec.seq),
      tenantId,
      validFrom:     VALID_FROM,
      recordedAt:    VALID_FROM,
      ucasPersonalId: ucasPersonalId(spec.seq),
      cycle:         ACADEMIC_YEAR.split('-')[0]!,
      statusCode:    spec.offerStatus,
      rawPayload:    { source: 'demo', marker: true, actor: ACTOR },
    });
  }

  // General UCAS applicants
  for (let seq = 4; seq <= TOTAL_APPLICANTS; seq++) {
    if (sourceSystemForSeq(seq) !== 'ucas') continue;
    apps.push({
      id:             ucasApplicationIdForSeq(tenantId, seq),
      tenantId,
      validFrom:      VALID_FROM,
      recordedAt:     VALID_FROM,
      ucasPersonalId: ucasPersonalId(seq),
      cycle:          ACADEMIC_YEAR.split('-')[0]!,
      statusCode:     OFFER_STATUS[seq % OFFER_STATUS.length]!,
      rawPayload:     { source: 'demo', actor: ACTOR },
    });
  }

  await batchInsert(db, ucasApplications, apps);
}
