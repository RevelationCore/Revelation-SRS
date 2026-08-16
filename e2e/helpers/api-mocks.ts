import type { Page } from '@playwright/test';

// ── Mock fixtures ─────────────────────────────────────────────────────────────

export const MOCK = {
  student: {
    personId:         'test-student-001',
    studentNumber:    'S000001',
    hesaId:            null,
    personStatusCode: 'student',
    sourceSystem:      null,
    createdAt:         '2023-09-01T00:00:00Z',
    // Duplicated at the top level too: mockStudentList() reuses this object
    // as a StudentSummary list row, which reads legalFirstName/legalFamilyName
    // directly (not nested) — see the `identity` object below for the
    // detail-page contract these also belong to.
    legalFirstName:  'Test',
    legalFamilyName: 'Student',
    // Both the admin (PersonIdentity) and portal (StudentIdentity) contracts
    // nest identity fields here rather than on the profile object itself —
    // pages that gate a whole section on `profile?.identity` (e.g. the
    // portal Profile page's "Identity" card) render nothing at all, without
    // erroring, if this is missing, which silently skips real coverage
    // rather than failing loudly.
    identity: {
      versionId:          'identity-v1',
      legalFirstName:     'Test',
      legalFamilyName:    'Student',
      preferredName:      null,
      preferredPronouns:  null,
      dateOfBirth:        '2000-01-15',
      genderCode:         'M',
      nationalityCode:    'GBR',
      domicileCode:       'GBR',
      emailInstitutional: 't.student@test.ac.uk',
      emailPersonal:      null,
      phoneMobile:        null,
      validFrom:          '2023-09-01',
      recordedAt:         '2023-09-01T00:00:00Z',
    },
  },
  enrolment: {
    enrolmentId:        'enrol-001',
    personId:           'test-student-001',
    programmeCode:      'BSC-CS',
    academicYearOfEntry:'2023',
    levelCode:          'L6',
    modeOfStudyCode:    'full-time',
    statusCode:         'enrolled',
    startDate:          '2023-09-01',
    expectedEndDate:    '2026-06-30',
    createdAt:          '2023-09-01T00:00:00Z',
  },
  tenantConfig: {
    tenantId:            'test-tenant-001',
    academicYearStartMonth: 9,
    defaultLocale:       'en-GB',
    defaultTimezone:     'Europe/London',
    defaultCurrencyCode: 'GBP',
    institutionName:     'Test University',
    ukprn:               '10000001',
    hesaSubscriberId:    '0001',
    ucasProviderCode:    'T99',
    updatedAt:           '2026-01-01T00:00:00Z',
  },
  // Matches apps/admin/src/api/globalisation.ts's LocaleConfig/CurrencyConfig
  // — the previous field names (availableLocales/availableCurrencies)
  // matched neither contract, so GlobalisationPage always rendered these
  // tabs with blank supported-locale/currency lists.
  localeConfig: {
    defaultLocale:    'en-GB',
    defaultTimeZone:  'Europe/London',
    supportedLocales: ['en-GB', 'cy'],
  },
  currencyConfig: {
    defaultCurrencyCode: 'GBP',
    acceptedCurrencies:  ['GBP'],
  },
  environmentRuntime: {
    environment: {
      deploymentEnvironmentId: 'env-001',
      environmentCode:         'test',
      displayName:             'Test',
      environmentTypeCode:     'test',
      productionLike:          false,
      liveIntegrationsAllowed: false,
      active:                  true,
      createdAt:               '2026-01-01T00:00:00Z',
      updatedAt:               '2026-01-01T00:00:00Z',
    },
    releaseVersion:      '0.1.0-test',
    imageDigest:         null,
    migrationVersion:    '0021',
    workflowDefinitions: [],
    featureFlags:        [],
  },
  // Matches apps/admin/src/api/tasks.ts's WorkflowTask contract — field
  // names below (workflowTaskId, stepKey, assigneeRoleCode, ...) are what
  // TaskInboxPage actually reads; a shape mismatch here doesn't error, it
  // just silently renders blank cells and a broken workflow link.
  workflowTask: {
    workflowTaskId:     'task-001',
    workflowInstanceId: 'workflow-001',
    stepKey:            'enrolment-review',
    taskTypeCode:       'review',
    statusCode:         'pending',
    assigneeActorId:    'test-staff-001',
    assigneeRoleCode:   'registry-administrator',
    dueAt:              '2026-07-01T00:00:00Z',
    completedBy:        null,
    completedAt:        null,
    payload:            {},
    createdAt:          '2026-06-01T00:00:00Z',
  },
  examBoard: {
    examBoardId:      'test-exam-board-001',
    boardTypeCode:    'progression',
    academicYear:     '2025',
    academicPeriodId: null,
    periodCode:       null,
    meetingDate:      null,
    ratifiedAt:       null,
    deferredAt:       null,
    deferralReason:   null,
    quorumCount:      null,
    quorumRecordedAt: null,
    actorId:          'test-staff-001',
    createdAt:        '2026-01-01T00:00:00Z',
  },
  hesaReturn: {
    returnId:            'hesa-001',
    academicYear:        '2025',
    statusCode:          'draft',
    submittedAt:         null,
    validatedAt:         null,
    submissionReference: null,
    amendmentOfId:       null,
    generatedBy:         'test-staff-001',
    generatedAt:         '2026-01-01T00:00:00Z',
    recordCount:         0,
    validationSummary:   null,
    createdAt:           '2026-01-01T00:00:00Z',
  },
};

// ── Route mock setup ──────────────────────────────────────────────────────────
//
// Intercepts all /api/v1/** calls and returns sensible mock responses.
// Specific object-shaped endpoints are matched first; everything else
// falls through to returning an empty array.

export async function mockApiRoutes(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url    = route.request().url();
    const method = route.request().method();

    // Non-GET — return 204 No Content
    if (method !== 'GET') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    // Specific object-shaped endpoints
    // Real endpoint is /api/v1/tenant/configuration (nested path); this
    // hyphenated form doesn't match anything actually called anywhere in
    // the app, which is why TenantConfigPage always rendered its form
    // blank against this mock rather than pre-populated.
    if (/\/tenant\/configuration$/.test(url)) {
      await route.fulfill({ json: MOCK.tenantConfig });
      return;
    }
    if (/\/locale-config$/.test(url)) {
      await route.fulfill({ json: MOCK.localeConfig });
      return;
    }
    if (/\/currency-config$/.test(url)) {
      await route.fulfill({ json: MOCK.currencyConfig });
      return;
    }
    if (/\/environment-runtime$/.test(url)) {
      await route.fulfill({ json: MOCK.environmentRuntime });
      return;
    }
    // Value-set lookups: the default empty-array fallback below is wrong
    // here — callers destructure `.members` from the response, so an array
    // (no `.members` property) crashes with "Cannot read properties of
    // undefined (reading 'find')" the moment a page actually renders a
    // value-set-backed label, rather than just showing an empty list.
    if (/\/value-set$/.test(url)) {
      await route.fulfill({ json: { setCode: 'mock', displayName: 'Mock value set', members: [] } });
      return;
    }
    // Reporting aggregates: object-shaped like value-sets above — an empty
    // array response makes `data.byYearOfEntry` etc. throw on a plain
    // object property access against an array, crashing the whole page.
    if (/\/reporting\/enrolment-volumes$/.test(url)) {
      await route.fulfill({ json: { total: 0, byStatus: {}, byMode: {}, byYearOfEntry: {}, byProgramme: [], generatedAt: '2026-01-01T00:00:00Z' } });
      return;
    }
    // Wellbeing module — adjustment-case list/queue endpoints (a separate
    // service on its own base URL, but still under /api/v1/ so it's
    // caught by this same wildcard route): object-shaped like value-sets
    // above — an empty array crashes `.items.filter(...)` callers.
    if (/\/adjustment-cases(\?.*)?$/.test(url)) {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }

    // Portal: student profile (no trailing path segment after the id)
    if (/\/students\/test-student-001$/.test(url)) {
      await route.fulfill({ json: MOCK.student });
      return;
    }

    // Admin: single student
    if (/\/students\/[^/]+$/.test(url) && !url.includes('?')) {
      await route.fulfill({ json: MOCK.student });
      return;
    }

    // Single exam board (bare id — not the /exam-boards list, and not one
    // of its /data-pack or /exam-entries sub-resources, which the overview
    // tab doesn't fetch on initial load and so can safely stay []).
    if (/\/exam-boards\/[^/]+$/.test(url) && !url.includes('?')) {
      await route.fulfill({ json: MOCK.examBoard });
      return;
    }

    // Single enrolment
    if (/\/enrolments\/[^/]+$/.test(url) && !url.includes('history') && !url.includes('?')) {
      await route.fulfill({ json: MOCK.enrolment });
      return;
    }

    // Portal: the signed-in student's own enrolments (list) — most portal
    // pages derive their "current enrolment" from this and stay on their
    // loading state indefinitely if it falls through to an empty array,
    // since their dependent fetches (registrations, timetable, etc.) never
    // get a non-null enrolment ID to fetch against.
    if (/\/students\/[^/]+\/enrolments$/.test(url)) {
      await route.fulfill({ json: [MOCK.enrolment] });
      return;
    }

    // Default: empty array (safe for all list/collection endpoints)
    await route.fulfill({ json: [] });
  });
}

// Mock with a specific student list (for search/list pages). Scoped to the
// bare list endpoint only — an unqualified '**/api/v1/students**' pattern
// also matches .../students/{id} detail requests, feeding StudentDetailPage
// an array instead of a single Student object.
export async function mockStudentList(page: Page, students = [MOCK.student]): Promise<void> {
  await page.route(/\/api\/v1\/students(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: students });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
}

// Mock workflow tasks
export async function mockTaskList(page: Page, tasks = [MOCK.workflowTask]): Promise<void> {
  await page.route('**/api/v1/workflow-tasks**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: tasks });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
}
