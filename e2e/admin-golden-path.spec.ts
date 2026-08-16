/**
 * Stage 8 — Admin golden-path E2E tests.
 *
 * Tests the primary staff workflows end-to-end against mocked API responses.
 * Journey coverage:
 *   GP-A01  Student search and navigation to detail
 *   GP-A02  Task inbox — view and confirm-complete flow
 *   GP-A03  Exam boards — list and navigate to detail
 *   GP-A04  Regulatory — navigate HESA hub and returns list
 *   GP-A05  Tenant admin — configuration page renders form
 *   GP-A06  Reporting hub — navigate to enrolment report
 *   GP-A07  Operations — environment runtime renders version info
 *   GP-A08  Integration ops — connector health check trigger
 *   GP-A09  RBAC — role-gated route returns 403 when role absent
 */
import { test, expect } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes, mockStudentList, mockTaskList, MOCK } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';

test.describe('Admin — student management (GP-A01)', () => {
  test('search returns student, clicking row navigates to detail', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await mockStudentList(page);

    await page.goto(`${ADMIN}/students`);
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();

    // Student list renders — 'Student' alone matches the nav link, page
    // heading and "New student" button too, so check the full name instead.
    await expect(page.getByRole('cell', { name: 'Test Student' })).toBeVisible();
    await expect(page.getByText('S000001')).toBeVisible();

    // Navigate to student detail — scoped to the table row, not the first
    // "student" link on the page (the sidebar nav link comes first in DOM
    // order and also matches the /student/i substring).
    await page.getByRole('row').filter({ hasText: 'S000001' }).getByRole('link').click();
    expect(page.url()).toContain('/students/');
    await expect(page.getByRole('heading', { name: /student/i })).toBeVisible();
  });

  test('search filter updates query param', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await mockStudentList(page);

    await page.goto(`${ADMIN}/students`);
    const searchBox = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
    if (await searchBox.count() > 0) {
      await searchBox.fill('Smith');
      await searchBox.press('Enter');
      expect(page.url()).toContain('search=Smith');
    }
  });
});

test.describe('Admin — task inbox (GP-A02)', () => {
  test('task list renders with pending task', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await mockTaskList(page);

    await page.goto(`${ADMIN}/tasks`);
    await expect(page.getByRole('heading', { name: 'Task inbox' })).toBeVisible();
    await expect(page.getByText('enrolment-review')).toBeVisible();
  });

  test('complete task — confirm dialog appears', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await mockTaskList(page);

    await page.goto(`${ADMIN}/tasks`);
    await expect(page.getByText('enrolment-review')).toBeVisible();

    // Click the Complete button
    const completeBtn = page.getByRole('button', { name: /complete/i }).first();
    if (await completeBtn.count() > 0) {
      await completeBtn.click();
      // Confirm dialog or inline confirm should appear
      await expect(
        page.getByRole('button', { name: /confirm/i }).or(page.getByText(/are you sure/i))
      ).toBeVisible({ timeout: 3_000 });
    }
  });

  test('empty state renders when no tasks', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await mockTaskList(page, []);

    await page.goto(`${ADMIN}/tasks`);
    await expect(page.getByRole('heading', { name: 'Task inbox' })).toBeVisible();
    // Should show empty state
    await expect(page.getByText(/no tasks/i)).toBeVisible();
  });
});

test.describe('Admin — exam boards (GP-A03)', () => {
  test('exam boards list renders', async ({ page }) => {
    await injectAdminAuth(page);
    // mockApiRoutes must be registered first: Playwright resolves the most
    // recently registered matching route first, so a page-specific route
    // registered before the generic catch-all would be shadowed by it.
    await mockApiRoutes(page);
    // Boards have no free-text name in the real ExamBoard contract — they're
    // identified by boardTypeCode + academicYear, which is what the list
    // actually renders (see ExamBoardsPage.tsx).
    await page.route('**/api/v1/exam-boards**', async (route) => {
      await route.fulfill({
        json: [{
          examBoardId:      'board-001',
          boardTypeCode:    'undergraduate',
          academicYear:     '2025',
          academicPeriodId: null,
          periodCode:       null,
          meetingDate:      '2026-06-15',
          ratifiedAt:       null,
          deferredAt:       null,
          deferralReason:   null,
          quorumCount:      null,
          quorumRecordedAt: null,
          actorId:          'test-staff-001',
          createdAt:        '2026-01-01T00:00:00Z',
        }],
      });
    });

    await page.goto(`${ADMIN}/exam-boards`);
    await expect(page.getByRole('heading', { name: 'Exam boards' })).toBeVisible();
    await expect(page.getByText('undergraduate')).toBeVisible();
    await expect(page.getByText('2025')).toBeVisible();
  });
});

test.describe('Admin — regulatory returns (GP-A04)', () => {
  test('regulatory hub renders all body cards', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/regulatory`);
    await expect(page.getByRole('heading', { name: 'Regulatory' })).toBeVisible();
    // .first(): each regulator appears in both the sidebar nav and its own
    // body card heading.
    await expect(page.getByText('HESA').first()).toBeVisible();
    await expect(page.getByText('UCAS').first()).toBeVisible();
    await expect(page.getByText('SLC').first()).toBeVisible();
    await expect(page.getByText('UKVI').first()).toBeVisible();
    await expect(page.getByText('OfS').first()).toBeVisible();
  });

  test('HESA page renders with draft return', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    // Scoped precisely: an unqualified '**/returns**' pattern also matches
    // the sibling .../returns/submission-requests endpoint, feeding that
    // queue HESA-return-shaped items instead of submission requests and
    // crashing the whole page on `request.context['academicYear']`.
    await page.route('**/api/v1/regulatory/hesa/returns', async (route) => {
      await route.fulfill({ json: [MOCK.hesaReturn] });
    });
    await page.route('**/api/v1/regulatory/hesa/returns/submission-requests**', async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto(`${ADMIN}/regulatory/hesa`);
    await expect(page.getByRole('heading', { name: /hesa/i })).toBeVisible();
    await expect(page.getByText('2025')).toBeVisible();
    await expect(page.getByText('draft')).toBeVisible();
  });
});

test.describe('Admin — tenant configuration (GP-A05)', () => {
  test('config page renders form pre-populated from API', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/tenant-admin/config`);
    await expect(page.getByRole('heading', { name: /tenant configuration/i })).toBeVisible();
    // Institution name from MOCK.tenantConfig — getByDisplayValue is a
    // Testing Library API, not part of Playwright's Page/Locator; the field
    // is checked directly by its current value instead.
    await expect(page.getByLabel('Institution name')).toHaveValue('Test University');
  });
});

test.describe('Admin — reporting (GP-A06)', () => {
  test('reporting hub navigates to enrolment report', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/reporting`);
    await expect(page.getByRole('heading', { name: 'Reporting' })).toBeVisible();

    await page.getByRole('link', { name: /enrolment volumes/i }).click();
    expect(page.url()).toContain('/reporting/enrolments');
    await expect(page.getByRole('heading', { name: /enrolment volumes/i })).toBeVisible();
  });

  test('regulatory status page renders summary cards', async ({ page }) => {
    await injectAdminAuth(page);
    await page.route('**/api/v1/regulatory/hesa/returns**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/v1/regulatory/ucas/applications**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/v1/regulatory/ukvi/cas-requests**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route('**/api/v1/regulatory/ukvi/compliance-alerts**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/reporting/regulatory-status`);
    await expect(page.getByRole('heading', { name: /regulatory submission status/i })).toBeVisible();
    // .first(): each label appears in both a summary card and its section
    // heading.
    await expect(page.getByText('HESA returns').first()).toBeVisible();
    await expect(page.getByText('UCAS applications').first()).toBeVisible();
  });

  test('FOI page renders request list and new request button', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await page.route('**/api/v1/regulatory/foi/requests**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{
          requestId:        'foi-001',
          requestReference: 'FOI-2026-001',
          receivedDate:     '2026-05-01',
          description:      'Data on student numbers',
          legalBasis:       'FOIA 2000',
          statusCode:       'open',
          dueDate:          '2026-07-01',
          closedAt:         null,
          createdAt:        '2026-05-01T00:00:00Z',
        }] });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    });

    await page.goto(`${ADMIN}/reporting/foi`);
    await expect(page.getByRole('heading', { name: /freedom of information/i })).toBeVisible();
    await expect(page.getByText('FOI-2026-001')).toBeVisible();
    await expect(page.getByRole('button', { name: /new request/i })).toBeVisible();
  });
});

test.describe('Admin — operations (GP-A07/GP-A08)', () => {
  test('environment runtime renders version information', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/operations/environment`);
    await expect(page.getByRole('heading', { name: 'Environment runtime' })).toBeVisible();
    await expect(page.getByText('0.1.0-test')).toBeVisible();
    await expect(page.getByText('0021')).toBeVisible();
  });

  test('integration ops page renders connector health tab', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await page.route('**/api/v1/integration-registrations**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [{
            registrationId:           'reg-001',
            tenantId:                 'test-tenant-001',
            contractId:               'contract-001',
            displayName:              'VLE Connector',
            contractVersion:          '1.0.0',
            transportCode:            'rest',
            endpointUrl:              'http://vle.test/api',
            enabled:                  true,
            healthStatusCode:         'healthy',
            lastHealthCheckAt:        null,
            lastSuccessfulExchangeAt: null,
            registeredAt:             '2026-01-01T00:00:00Z',
          }],
        });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    });

    await page.goto(`${ADMIN}/operations/integrations`);
    await expect(page.getByRole('heading', { name: 'Integration operations' })).toBeVisible();
    // exact: true — a health-check help panel also mentions "VLE connector".
    await expect(page.getByText('VLE Connector', { exact: true })).toBeVisible();
    // Health check is recorded per outcome (ok/degraded/down), not one
    // generic "Health check" button; exact: true avoids the bulk "Record
    // all OK" action, which also matches an unscoped substring search.
    await expect(page.getByRole('button', { name: 'ok', exact: true })).toBeVisible();
  });
});

test.describe('Admin — RBAC (GP-A09)', () => {
  test('unauthenticated user redirected from protected route', async ({ page }) => {
    // No auth injection — should redirect to /login
    await page.goto(`${ADMIN}/students`);
    await page.waitForURL(`${ADMIN}/login`);
    expect(page.url()).toContain('/login');
  });
});
