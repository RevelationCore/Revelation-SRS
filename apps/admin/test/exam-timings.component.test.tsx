import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ExamTimingsPage } from '../src/pages/ExamTimingsPage.js';

const API = 'http://localhost:3000';

function handlers(saved: { body: unknown }) {
  return [
    http.get(`${API}/api/v1/academic-periods`, () => HttpResponse.json([
      { academicPeriodId: 'p1', academicYear: '2026-27', periodCode: 'SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' },
    ])),
    http.get(`${API}/api/v1/module-offerings`, () => HttpResponse.json([
      { moduleOfferingId: 'o1', moduleId: 'm1', moduleCode: 'LAW301', moduleTitle: 'Contract Law', academicPeriodId: 'p1', periodCode: 'SEM1' },
    ])),
    http.get(`${API}/api/v1/module-offerings/o1/components`, () => HttpResponse.json([
      { assessmentComponentId: 'c1', moduleOfferingId: 'o1', componentTypeCode: 'exam', title: 'Written exam', weighting: 60, passMarkOverride: null, durationMinutes: null, createdAt: '', updatedAt: '' },
      { assessmentComponentId: 'c2', moduleOfferingId: 'o1', componentTypeCode: 'coursework', title: 'Essay', weighting: 40, passMarkOverride: null, durationMinutes: null, createdAt: '', updatedAt: '' },
    ])),
    http.patch(`${API}/api/v1/module-offerings/o1/components/c1`, async ({ request }) => {
      saved.body = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

describe('exam timings', () => {
  it('lists exams only, flags missing durations, and saves one', async () => {
    const saved = { body: null as unknown };
    server.use(...handlers(saved));
    const { container } = renderWithProviders(<ExamTimingsPage />, { roles: ['registry-administrator'] });

    const input = await screen.findByLabelText('LAW301 Written exam duration');
    expect(screen.queryByText('Essay')).not.toBeInTheDocument();
    expect(screen.getByText('1 exam · 1 without a duration')).toBeInTheDocument();

    await userEvent.type(input, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(saved.body).toEqual({ durationMinutes: 120 });
    await expectNoA11yViolations(container);
  });
});
