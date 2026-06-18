import type { Page } from '@playwright/test';

// ── Mock fixtures ─────────────────────────────────────────────────────────────

export const MOCK = {
  student: {
    personId:       'test-student-001',
    studentNumber:  'S000001',
    legalFirstName: 'Test',
    legalFamilyName:'Student',
    preferredName:  null,
    dateOfBirth:    '2000-01-15',
    nationalityCode:'GBR',
    genderCode:     'M',
    statusCode:     'active',
    createdAt:      '2023-09-01T00:00:00Z',
    updatedAt:      '2024-01-01T00:00:00Z',
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
  localeConfig: {
    defaultLocale:    'en-GB',
    availableLocales: ['en-GB'],
  },
  currencyConfig: {
    defaultCurrencyCode:  'GBP',
    availableCurrencies:  ['GBP'],
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
  workflowTask: {
    taskId:          'task-001',
    workflowId:      'workflow-001',
    definitionCode:  'enrolment-review',
    assigneeId:      'test-staff-001',
    statusCode:      'pending',
    priority:        1,
    dueAt:           '2026-07-01T00:00:00Z',
    createdAt:       '2026-06-01T00:00:00Z',
    payload:         {},
  },
  hesaReturn: {
    returnId:            'hesa-001',
    academicYear:        '2025',
    statusCode:          'draft',
    submittedAt:         null,
    submissionReference: null,
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
    if (/\/tenant-configuration$/.test(url)) {
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

    // Single enrolment
    if (/\/enrolments\/[^/]+$/.test(url) && !url.includes('history') && !url.includes('?')) {
      await route.fulfill({ json: MOCK.enrolment });
      return;
    }

    // Default: empty array (safe for all list/collection endpoints)
    await route.fulfill({ json: [] });
  });
}

// Mock with a specific student list (for search/list pages)
export async function mockStudentList(page: Page, students = [MOCK.student]): Promise<void> {
  await page.route('**/api/v1/students**', async (route) => {
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
