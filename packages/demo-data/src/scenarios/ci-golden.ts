import {
  academicPeriods,
  awardingBodies,
  disabilityDeclarations,
  enrolments,
  examBoards,
  integrationContracts,
  integrationRegistrations,
  moduleOfferings,
  moduleRegistrations,
  modules,
  personIdentities,
  persons,
  programmes,
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowInstances,
  workflowTasks,
  type Db,
} from '@revelation-srs/db';

import { GOLDEN_IDS } from '../golden-ids.js';
import { loadEngagementDemo } from '../generators/engagement.js';
import { STORY_MARKERS } from '../story-markers.js';
import type { ScenarioManifest } from '../types.js';

export const manifest: ScenarioManifest = {
  slug:             'ci-golden',
  name:             'CI Golden Dataset',
  schemaVersion:    '0023',
  referenceDate:    '2025-11-14',
  academicYears:    ['2024-25'],
  targetVolumes:    { students: 4, boards: 3, workflowInstances: 3 },
  loadTimeBudgetMs: 10_000,
  storyMarkers:     [
    STORY_MARKERS.S0_STANDARD_ENROLLED,
    STORY_MARKERS.S0_INTERMITTING,
    STORY_MARKERS.S0_WITHDRAWN,
    STORY_MARKERS.S0_GRADUATED,
  ],
  phases: [
    'reference-data', 'persons', 'enrolments', 'registrations',
    'assessment', 'wellbeing', 'regulatory', 'boards', 'integration',
  ],
};

const ACADEMIC_YEAR = '2024-25';
const YEAR_START    = new Date('2024-09-01T00:00:00Z');
const ACTOR         = 'demo-data:ci-golden';

export async function load(
  db: Db,
  tenantId: string,
  phase: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  if (opts.dryRun) return;

  switch (phase) {
    case 'reference-data': return loadReferenceData(db, tenantId);
    case 'persons':        return loadPersons(db, tenantId);
    case 'enrolments':     return loadEnrolments(db, tenantId);
    case 'registrations':  return loadRegistrations(db, tenantId);
    case 'wellbeing':      return loadWellbeing(db, tenantId);
    case 'boards':         return loadBoards(db, tenantId);
    case 'integration':    return loadIntegration(db, tenantId);
    // 'assessment' and 'regulatory' have no data in the CI golden set
  }
}

// ─── Phase helpers ────────────────────────────────────────────────────────────

async function loadReferenceData(db: Db, tenantId: string): Promise<void> {
  await db.insert(academicPeriods).values([
    {
      id:             GOLDEN_IDS.ACADEMIC_PERIOD_AUTUMN,
      tenantId,
      academicYear:   ACADEMIC_YEAR,
      periodCode:     'AUTUMN',
      periodTypeCode: 'term',
      startDate:      '2024-09-23',
      endDate:        '2024-12-20',
    },
    {
      id:             GOLDEN_IDS.ACADEMIC_PERIOD_SPRING,
      tenantId,
      academicYear:   ACADEMIC_YEAR,
      periodCode:     'SPRING',
      periodTypeCode: 'term',
      startDate:      '2025-01-20',
      endDate:        '2025-04-11',
    },
    {
      id:             GOLDEN_IDS.ACADEMIC_PERIOD_SUMMER,
      tenantId,
      academicYear:   ACADEMIC_YEAR,
      periodCode:     'SUMMER',
      periodTypeCode: 'term',
      startDate:      '2025-04-28',
      endDate:        '2025-06-27',
    },
  ]).onConflictDoNothing();

  await db.insert(awardingBodies).values({
    id:       GOLDEN_IDS.AWARDING_BODY,
    tenantId,
    code:     'DEMO-UNI',
    name:     'DEMO - Demo University',
    active:   true,
  }).onConflictDoNothing();

  await db.insert(programmes).values({
    id:                   GOLDEN_IDS.PROGRAMME,
    tenantId,
    validFrom:            YEAR_START,
    recordedAt:           YEAR_START,
    code:                 'BSCS',
    title:                'DEMO - BSc Computer Science',
    fheqLevel:            6,
    durationYears:        3,
    creditTotal:          360,
    creditFrameworkCode:  'cats',
    modeOfStudyCode:      'full-time',
    awardingBodyId:       GOLDEN_IDS.AWARDING_BODY,
  }).onConflictDoNothing();

  await db.insert(modules).values([
    {
      id:          GOLDEN_IDS.MODULE_A,
      tenantId,
      validFrom:   YEAR_START,
      recordedAt:  YEAR_START,
      code:        'CS101',
      title:       'DEMO - Introduction to Programming',
      creditValue: 20,
      fheqLevel:   4,
    },
    {
      id:          GOLDEN_IDS.MODULE_B,
      tenantId,
      validFrom:   YEAR_START,
      recordedAt:  YEAR_START,
      code:        'CS102',
      title:       'DEMO - Data Structures',
      creditValue: 20,
      fheqLevel:   4,
    },
    {
      id:          GOLDEN_IDS.MODULE_C,
      tenantId,
      validFrom:   YEAR_START,
      recordedAt:  YEAR_START,
      code:        'CS103',
      title:       'DEMO - Algorithms',
      creditValue: 20,
      fheqLevel:   5,
    },
  ]).onConflictDoNothing();

  await db.insert(moduleOfferings).values([
    {
      id:               GOLDEN_IDS.MODULE_OFFERING_A_AUTUMN,
      tenantId,
      moduleId:         GOLDEN_IDS.MODULE_A,
      academicPeriodId: GOLDEN_IDS.ACADEMIC_PERIOD_AUTUMN,
      deliveryModeCode: 'in-person',
    },
    {
      id:               GOLDEN_IDS.MODULE_OFFERING_B_SPRING,
      tenantId,
      moduleId:         GOLDEN_IDS.MODULE_B,
      academicPeriodId: GOLDEN_IDS.ACADEMIC_PERIOD_SPRING,
      deliveryModeCode: 'in-person',
    },
    {
      id:               GOLDEN_IDS.MODULE_OFFERING_C_SUMMER,
      tenantId,
      moduleId:         GOLDEN_IDS.MODULE_C,
      academicPeriodId: GOLDEN_IDS.ACADEMIC_PERIOD_SUMMER,
      deliveryModeCode: 'in-person',
    },
  ]).onConflictDoNothing();
}

async function loadPersons(db: Db, tenantId: string): Promise<void> {
  await db.insert(persons).values([
    {
      id:               GOLDEN_IDS.PERSON_ENROLLED,
      tenantId,
      studentNumber:    'S24000001',
      personStatusCode: 'active',
    },
    {
      id:               GOLDEN_IDS.PERSON_INTERMITTING,
      tenantId,
      studentNumber:    'S24000002',
      personStatusCode: 'active',
    },
    {
      id:               GOLDEN_IDS.PERSON_WITHDRAWN,
      tenantId,
      studentNumber:    'S24000003',
      personStatusCode: 'inactive',
    },
    {
      id:               GOLDEN_IDS.PERSON_GRADUATED,
      tenantId,
      studentNumber:    'S24000004',
      personStatusCode: 'graduated',
    },
  ]).onConflictDoNothing();

  await db.insert(personIdentities).values([
    {
      id:                   GOLDEN_IDS.PERSON_ENROLLED,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_ENROLLED,
      validFrom:            YEAR_START,
      recordedAt:           YEAR_START,
      legalFirstName:       'DEMO - Alice',
      legalFamilyName:      'DEMO - Chapman',
      preferredName:        'Alice',
      dateOfBirth:          '2003-04-12',
      genderCode:           '2',
      nationalityCode:      'GBR',
      emailInstitutional:   's24000001@demo.srs',
    },
    {
      id:                   GOLDEN_IDS.PERSON_INTERMITTING,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_INTERMITTING,
      validFrom:            YEAR_START,
      recordedAt:           YEAR_START,
      legalFirstName:       'DEMO - Ben',
      legalFamilyName:      'DEMO - Dalton',
      dateOfBirth:          '2003-07-22',
      genderCode:           '1',
      nationalityCode:      'GBR',
      emailInstitutional:   's24000002@demo.srs',
    },
    {
      id:                   GOLDEN_IDS.PERSON_WITHDRAWN,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_WITHDRAWN,
      validFrom:            YEAR_START,
      recordedAt:           YEAR_START,
      legalFirstName:       'DEMO - Cara',
      legalFamilyName:      'DEMO - Ellis',
      dateOfBirth:          '2002-11-05',
      genderCode:           '2',
      nationalityCode:      'GBR',
      emailInstitutional:   's24000003@demo.srs',
    },
    {
      id:                   GOLDEN_IDS.PERSON_GRADUATED,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_GRADUATED,
      validFrom:            new Date('2021-09-01T00:00:00Z'),
      recordedAt:           new Date('2021-09-01T00:00:00Z'),
      legalFirstName:       'DEMO - David',
      legalFamilyName:      'DEMO - Fisher',
      dateOfBirth:          '2000-03-18',
      genderCode:           '1',
      nationalityCode:      'GBR',
      emailInstitutional:   's24000004@demo.srs',
    },
  ]).onConflictDoNothing();
}

async function loadEnrolments(db: Db, tenantId: string): Promise<void> {
  const enrolledAt     = new Date('2024-09-23T00:00:00Z');
  const intermittingAt = new Date('2025-02-01T00:00:00Z');
  const withdrawnAt    = new Date('2024-10-15T00:00:00Z');
  const graduatedAt    = new Date('2024-07-01T00:00:00Z');

  await db.insert(enrolments).values([
    {
      id:                   GOLDEN_IDS.ENROLMENT_ENROLLED,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_ENROLLED,
      programmeId:          GOLDEN_IDS.PROGRAMME,
      statusCode:           'enrolled',
      modeOfStudyCode:      'full-time',
      academicYearOfEntry:  ACADEMIC_YEAR,
      startDate:            '2024-09-23',
      expectedEndDate:      '2027-07-01',
      validFrom:            enrolledAt,
      recordedAt:           enrolledAt,
    },
    {
      id:                   GOLDEN_IDS.ENROLMENT_INTERMITTING,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_INTERMITTING,
      programmeId:          GOLDEN_IDS.PROGRAMME,
      statusCode:           'intermitting',
      modeOfStudyCode:      'full-time',
      academicYearOfEntry:  ACADEMIC_YEAR,
      startDate:            '2024-09-23',
      expectedEndDate:      '2028-07-01',
      validFrom:            intermittingAt,
      recordedAt:           intermittingAt,
    },
    {
      id:                   GOLDEN_IDS.ENROLMENT_WITHDRAWN,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_WITHDRAWN,
      programmeId:          GOLDEN_IDS.PROGRAMME,
      statusCode:           'withdrawn',
      modeOfStudyCode:      'full-time',
      academicYearOfEntry:  ACADEMIC_YEAR,
      startDate:            '2024-09-23',
      actualEndDate:        '2024-10-15',
      validFrom:            withdrawnAt,
      recordedAt:           withdrawnAt,
    },
    {
      id:                   GOLDEN_IDS.ENROLMENT_GRADUATED,
      tenantId,
      personId:             GOLDEN_IDS.PERSON_GRADUATED,
      programmeId:          GOLDEN_IDS.PROGRAMME,
      statusCode:           'graduated',
      modeOfStudyCode:      'full-time',
      academicYearOfEntry:  '2021-22',
      startDate:            '2021-09-20',
      expectedEndDate:      '2024-07-01',
      actualEndDate:        '2024-07-01',
      validFrom:            graduatedAt,
      recordedAt:           graduatedAt,
    },
  ]).onConflictDoNothing();
}

async function loadRegistrations(db: Db, tenantId: string): Promise<void> {
  const regAt = new Date('2024-09-23T00:00:00Z');

  await db.insert(moduleRegistrations).values([
    {
      id:               GOLDEN_IDS.MODULE_REG_ENROLLED_A,
      tenantId,
      enrolmentId:      GOLDEN_IDS.ENROLMENT_ENROLLED,
      moduleOfferingId: GOLDEN_IDS.MODULE_OFFERING_A_AUTUMN,
      statusCode:       'registered',
      registrationDate: '2024-09-23',
      validFrom:        regAt,
      recordedAt:       regAt,
    },
    {
      id:               GOLDEN_IDS.MODULE_REG_ENROLLED_B,
      tenantId,
      enrolmentId:      GOLDEN_IDS.ENROLMENT_ENROLLED,
      moduleOfferingId: GOLDEN_IDS.MODULE_OFFERING_B_SPRING,
      statusCode:       'registered',
      registrationDate: '2024-09-23',
      validFrom:        regAt,
      recordedAt:       regAt,
    },
  ]).onConflictDoNothing();
}

async function loadWellbeing(db: Db, tenantId: string): Promise<void> {
  const declaredAt = new Date('2024-09-15T10:00:00Z');

  await db.insert(disabilityDeclarations).values({
    id:                      GOLDEN_IDS.DISABILITY_DECLARATION,
    tenantId,
    personId:                GOLDEN_IDS.PERSON_ENROLLED,
    disabilityCategoryCode:  '58', // HESA: social/communication impairment
    declarationStatusCode:   'declared',
    declaredAt,
    validFrom:               declaredAt,
    recordedAt:              declaredAt,
  }).onConflictDoNothing();
}

async function loadBoards(db: Db, tenantId: string): Promise<void> {
  await db.insert(examBoards).values([
    {
      id:               GOLDEN_IDS.BOARD_SCHEDULED,
      tenantId,
      boardTypeCode:    'module',
      academicYear:     ACADEMIC_YEAR,
      academicPeriodId: GOLDEN_IDS.ACADEMIC_PERIOD_SPRING,
      meetingDate:      '2025-03-15',
      actorId:          ACTOR,
    },
    {
      id:                 GOLDEN_IDS.BOARD_OPEN,
      tenantId,
      boardTypeCode:      'module',
      academicYear:       ACADEMIC_YEAR,
      academicPeriodId:   GOLDEN_IDS.ACADEMIC_PERIOD_AUTUMN,
      meetingDate:        '2024-12-10',
      quorumCount:        5,
      quorumRecordedAt:   new Date('2024-12-10T10:00:00Z'),
      actorId:            ACTOR,
    },
    {
      id:               GOLDEN_IDS.BOARD_RATIFIED,
      tenantId,
      boardTypeCode:    'module',
      academicYear:     '2023-24',
      meetingDate:      '2024-06-05',
      quorumCount:      6,
      quorumRecordedAt: new Date('2024-06-05T14:00:00Z'),
      ratifiedAt:       new Date('2024-06-05T16:00:00Z'),
      actorId:          ACTOR,
    },
  ]).onConflictDoNothing();
}

async function loadIntegration(db: Db, tenantId: string): Promise<void> {
  // Global integration contract (no tenant_id)
  await db.insert(integrationContracts).values({
    id:                      GOLDEN_IDS.INTEGRATION_CONTRACT,
    contractId:              'ci-golden:vle-enrolment-sync:v1',
    displayName:             'DEMO - VLE Enrolment Sync',
    ownerModuleCode:         'vle-connector',
    directionCode:           'outbound',
    patternType:             'event-driven',
    currentContractVersion:  '1.0.0',
    dataClassificationCode:  'standard',
  }).onConflictDoNothing();

  // Tenant-scoped registration
  await db.insert(integrationRegistrations).values({
    id:                     GOLDEN_IDS.INTEGRATION_REGISTRATION,
    tenantId,
    integrationContractId:  GOLDEN_IDS.INTEGRATION_CONTRACT,
    integrationCode:        'demo-vle-sync',
    displayName:            'DEMO - VLE Sync Registration',
    contractVersion:        '1.0.0',
    transportCode:          'nats',
    subjectFilter:          'srs.enrolment.>',
    enabled:                true,
    configuration:          {},
  }).onConflictDoNothing();

  // Workflow definition (tenant-scoped)
  await db.insert(workflowDefinitions).values({
    id:                   GOLDEN_IDS.WORKFLOW_DEF,
    tenantId,
    definitionCode:       'ci-golden:ec-review',
    displayName:          'DEMO - EC Review Process',
    ownerModuleCode:      'wellbeing',
    statusCode:           'active',
    currentVersionNumber: 1,
  }).onConflictDoNothing();

  await db.insert(workflowDefinitionVersions).values({
    id:                   GOLDEN_IDS.WORKFLOW_DEF_VERSION,
    workflowDefinitionId: GOLDEN_IDS.WORKFLOW_DEF,
    versionNumber:        1,
    statusCode:           'active',
    definitionJson:       { steps: ['review', 'approve'] },
    effectiveFrom:        YEAR_START,
  }).onConflictDoNothing();

  // Workflow instances — one per major status
  await db.insert(workflowInstances).values([
    {
      id:                          GOLDEN_IDS.WORKFLOW_INSTANCE_PENDING,
      tenantId,
      workflowDefinitionVersionId: GOLDEN_IDS.WORKFLOW_DEF_VERSION,
      workflowCode:                'ci-golden:ec-review',
      subjectEntityType:           'enrolment',
      subjectEntityId:             GOLDEN_IDS.ENROLMENT_ENROLLED,
      statusCode:                  'pending',
      startedBy:                   ACTOR,
      startedAt:                   new Date('2025-10-01T09:00:00Z'),
      context:                     { storyMarker: STORY_MARKERS.S0_STANDARD_ENROLLED },
    },
    {
      id:                          GOLDEN_IDS.WORKFLOW_INSTANCE_ACTIVE,
      tenantId,
      workflowDefinitionVersionId: GOLDEN_IDS.WORKFLOW_DEF_VERSION,
      workflowCode:                'ci-golden:ec-review',
      subjectEntityType:           'enrolment',
      subjectEntityId:             GOLDEN_IDS.ENROLMENT_INTERMITTING,
      statusCode:                  'in-progress',
      startedBy:                   ACTOR,
      startedAt:                   new Date('2025-09-15T11:00:00Z'),
      context:                     { storyMarker: STORY_MARKERS.S0_INTERMITTING },
    },
    {
      id:                          GOLDEN_IDS.WORKFLOW_INSTANCE_COMPLETED,
      tenantId,
      workflowDefinitionVersionId: GOLDEN_IDS.WORKFLOW_DEF_VERSION,
      workflowCode:                'ci-golden:ec-review',
      subjectEntityType:           'enrolment',
      subjectEntityId:             GOLDEN_IDS.ENROLMENT_GRADUATED,
      statusCode:                  'completed',
      startedBy:                   ACTOR,
      startedAt:                   new Date('2024-05-01T10:00:00Z'),
      completedAt:                 new Date('2024-05-10T14:00:00Z'),
      context:                     { storyMarker: STORY_MARKERS.S0_GRADUATED },
    },
  ]).onConflictDoNothing();

  // Workflow tasks — one per major status
  await db.insert(workflowTasks).values([
    {
      id:                 GOLDEN_IDS.WORKFLOW_TASK_PENDING,
      tenantId,
      workflowInstanceId: GOLDEN_IDS.WORKFLOW_INSTANCE_PENDING,
      stepKey:            'review',
      taskTypeCode:       'human-task',
      statusCode:         'pending',
      assigneeRoleCode:   'registry-administrator',
      dueAt:              new Date('2025-11-01T17:00:00Z'),
      payload:            {},
    },
    {
      id:                 GOLDEN_IDS.WORKFLOW_TASK_CLAIMED,
      tenantId,
      workflowInstanceId: GOLDEN_IDS.WORKFLOW_INSTANCE_ACTIVE,
      stepKey:            'review',
      taskTypeCode:       'human-task',
      statusCode:         'in-progress',
      assigneeActorId:    'registry-user-01',
      assigneeRoleCode:   'registry-administrator',
      dueAt:              new Date('2025-10-01T17:00:00Z'),
      payload:            {},
    },
    {
      id:                 GOLDEN_IDS.WORKFLOW_TASK_DONE,
      tenantId,
      workflowInstanceId: GOLDEN_IDS.WORKFLOW_INSTANCE_COMPLETED,
      stepKey:            'approve',
      taskTypeCode:       'human-task',
      statusCode:         'completed',
      assigneeActorId:    'registry-user-01',
      assigneeRoleCode:   'registry-administrator',
      completedBy:        'registry-user-01',
      completedAt:        new Date('2024-05-10T14:00:00Z'),
      payload:            { decision: 'approved' },
    },
  ]).onConflictDoNothing();
  await loadEngagementDemo(db, tenantId);
}
