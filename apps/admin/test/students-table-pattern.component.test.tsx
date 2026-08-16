import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { StudentsPage } from '../src/pages/StudentsPage.js';

const API = 'http://localhost:3000';
const student = { personId: 'p1', studentNumber: 'S000001', legalFirstName: 'Alice', legalFamilyName: 'Demo' };
const valueSet = { setCode: 'person_status_code', displayName: 'Person status', members: [{ code: 'student', displayLabel: 'Student', description: null, sortOrder: 1 }] };

function baseHandlers({ students = [student] } = {}) {
  return [
    http.get(`${API}/api/v1/fields/person/person_status_code/value-set`, () => HttpResponse.json(valueSet)),
    http.get(`${API}/api/v1/students`, () => HttpResponse.json(students)),
  ];
}

describe('data table/list pattern — students table', () => {
  it('loading: shows a spinner before the first page resolves', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeVisible();
    await screen.findByText('S000001');
  });

  it('empty: shows an accessible empty-state row rather than a blank table', async () => {
    server.use(...baseHandlers({ students: [] }));
    const { container } = renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('No students found.')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('populated: lists a row per student with an accessible column structure', async () => {
    server.use(...baseHandlers());
    const { container } = renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByRole('cell', { name: 'S000001' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Student #' })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('error: a failed request surfaces an accessible error message, not a silently empty table', async () => {
    server.use(
      http.get(`${API}/api/v1/fields/person/person_status_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students`, () => HttpResponse.json({ type: 'about:blank', title: 'Service unavailable' }, { status: 503 })),
    );
    renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('Service unavailable')).toBeVisible();
  });

  it('filter: submitting a search re-queries with the search term and resets to the first page', async () => {
    let lastQuery: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/api/v1/fields/person/person_status_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students`, ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return HttpResponse.json([student]);
      }),
    );
    renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    await screen.findByText('S000001');

    await userEvent.type(screen.getByPlaceholderText('Name or student number…'), 'Alice');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(lastQuery?.get('search')).toBe('Alice'));
    expect(lastQuery?.get('offset')).toBe('0');
  });

  it('pagination: Next requests the following page; Previous is disabled on the first page', async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => ({ personId: `p${i}`, studentNumber: `S${String(i).padStart(6, '0')}`, legalFirstName: 'Test', legalFamilyName: `Student${i}` }));
    let lastQuery: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/api/v1/fields/person/person_status_code/value-set`, () => HttpResponse.json(valueSet)),
      http.get(`${API}/api/v1/students`, ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return HttpResponse.json(fullPage);
      }),
    );
    renderWithProviders(<StudentsPage />, { roles: ['registry-administrator'] });
    await screen.findByText('S000000');

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(lastQuery?.get('offset')).toBe('20'));
  });
});
