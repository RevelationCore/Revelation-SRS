import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AssessmentStructuresPage } from '../src/pages/AssessmentStructuresPage.js';

const API = 'http://localhost:3000/bff/srs';
const component = (overrides: Record<string, unknown> = {}) => ({
  assessmentComponentId: 'ac-1', moduleOfferingId: 'mo-1', componentTypeCode: 'coursework', title: 'Essay', weighting: 40,
  passMarkOverride: null, durationMinutes: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...overrides,
});

function handlers(components: unknown[]) {
  return [
    http.get(`${API}/api/v1/academic-periods`, () => HttpResponse.json([{ academicPeriodId: 'ap-1', academicYear: '2026-27', periodCode: 'SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' }])),
    http.get(`${API}/api/v1/module-offerings`, () => HttpResponse.json([{ moduleOfferingId: 'mo-1', moduleId: 'm-1', moduleCode: 'CS101', moduleTitle: 'Programming', academicPeriodId: 'ap-1', periodCode: 'SEM1' }])),
    http.get(`${API}/api/v1/module-offerings/mo-1/components`, () => HttpResponse.json(components)),
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, () => HttpResponse.json({ setCode: 'x', displayName: 'x', members: [{ code: 'exam', displayLabel: 'Examination', description: null, sortOrder: 1 }] })),
  ];
}

describe('assessment structures (BP-05-001)', () => {
  it('shows the total weighting, warns when it is not 100, and adds a component for the remainder', async () => {
    let body: unknown;
    server.use(...handlers([component()]), http.post(`${API}/api/v1/module-offerings/mo-1/components`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json({ assessmentComponentId: 'ac-2' }, { status: 201 });
    }));
    const { container } = renderWithProviders(<AssessmentStructuresPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText(/They must total 100/)).toBeVisible();
    expect(screen.getByLabelText(/^Weighting/)).toHaveValue(60);
    await expectNoA11yViolations(container);
    await userEvent.selectOptions(screen.getByLabelText(/^Type/), 'exam');
    await userEvent.type(screen.getByLabelText(/^Title/), 'Final exam');
    await userEvent.type(screen.getByLabelText(/Duration/), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await screen.findByRole('cell', { name: 'Essay' });
    expect(body).toEqual({ componentTypeCode: 'exam', title: 'Final exam', weighting: 60, durationMinutes: 120 });
  });

  it('a change refused because marks exist is shown', async () => {
    server.use(...handlers([component({ weighting: 100 })]), http.patch(`${API}/api/v1/module-offerings/mo-1/components/ac-1`, () => HttpResponse.json(
      { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Component has marks recorded' }, { status: 409 },
    )));
    renderWithProviders(<AssessmentStructuresPage />, { roles: ['registry-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Essay' }));
    const weighting = screen.getByLabelText('Weighting');
    await userEvent.clear(weighting);
    await userEvent.type(weighting, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Component has marks recorded')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add component' })).toBeNull();
  });
});
