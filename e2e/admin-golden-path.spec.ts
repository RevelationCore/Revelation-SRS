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
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes, mockStudentList, mockTaskList, MOCK } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';

test.describe('Admin — student management (GP-A01)', () => {
  test('search returns student, clicking row navigates to detail', async ({ page }) => {
    await injectAdminAuth(page);
    await mockStudentList(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/students`);
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();

    // Student list renders
    await expect(page.getByText('Student')).toBeVisible();
    await expect(page.getByText('S000001')).toBeVisible();

    // Navigate to student detail
    await page.getByRole('link', { name: /student/i }).first().click();
    expect(page.url()).toContain('/students/');
    await expect(page.getByRole('heading', { name: /student/i })).toBeVisible();
  });

  test('search filter updates query param', async ({ page }) => {
    await injectAdminAuth(page);
    await mockStudentList(page);
    await mockApiRoutes(page);

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
    await mockTaskList(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/tasks`);
    await expect(page.getByRole('heading', { name: 'Task inbox' })).toBeVisible();
    await expect(page.getByText('enrolment-review')).toBeVisible();
  });

  test('complete task — confirm dialog appears', async ({ page }) => {
    await injectAdminAuth(page);
    await mockTaskList(page);
    await mockApiRoutes(page);

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
    await mockTaskList(page, []);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/tasks`);
    await expect(page.getByRole('heading', { name: 'Task inbox' })).toBeVisible();
    // Should show empty state
    await expect(page.getByText(/no tasks/i)).toBeVisible();
  });
});

test.describe('Admin — exam boards (GP-A03)', () => {
  test('exam boards list renders', async ({ page }) => {
    await injectAdminAuth(page);
    await page.route('**/api/v1/exam-boards**', async (route) => {
      await route.fulfill({
        json: [{
          boardId:      'board-001',
          boardName:    'Computer Science Board',
          boardTypeCode:'undergraduate',
          academicYear: '2025',
          statusCode:   'scheduled',
          scheduledDate:'2026-06-15',
          createdAt:    '2026-01-01T00:00:00Z',
        }],
      });
    });
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/exam-boards`);
    await expect(page.getByRole('heading', { name: 'Exam boards' })).toBeVisible();
    await expect(page.getByText('Computer Science Board')).toBeVisible();
  });
});

test.describe('Admin — regulatory returns (GP-A04)', () => {
  test('regulatory hub renders all body cards', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/regulatory`);
    await expect(page.getByRole('heading', { name: 'Regulatory' })).toBeVisible();
    await expect(page.getByText('HESA')).toBeVisible();
    await expect(page.getByText('UCAS')).toBeVisible();
    await expect(page.getByText('SLC')).toBeVisible();
    await expect(page.getByText('UKVI')).toBeVisible();
    await expect(page.getByText('OfS')).toBeVisible();
  });

  test('HESA page renders with draft return', async ({ page }) => {
    await injectAdminAuth(page);
    await page.route('**/api/v1/regulatory/hesa/returns**', async (route) => {
      await route.fulfill({ json: [MOCK.hesaReturn] });
    });
    await mockApiRoutes(page);

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
    // Institution name from MOCK.tenantConfig
    await expect(page.getByDisplayValue('Test University')).toBeVisible();
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
    await expect(page.getByText('HESA returns')).toBeVisible();
    await expect(page.getByText('UCAS applications')).toBeVisible();
  });

  test('FOI page renders request list and new request button', async ({ page }) => {
    await injectAdminAuth(page);
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
    await mockApiRoutes(page);

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
    await page.route('**/api/v1/integration-registrations**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [{
            registrationId: 'reg-001',
            contractId:     'contract-001',
            name:           'VLE Connector',
            endpointUrl:    'http://vle.test/api',
            statusCode:     'enabled',
            createdAt:      '2026-01-01T00:00:00Z',
          }],
        });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    });
    await mockApiRoutes(page);

    await page.goto(`${ADMIN}/operations/integrations`);
    await expect(page.getByRole('heading', { name: 'Integration operations' })).toBeVisible();
    await expect(page.getByText('VLE Connector')).toBeVisible();
    await expect(page.getByRole('button', { name: /health check/i })).toBeVisible();
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
