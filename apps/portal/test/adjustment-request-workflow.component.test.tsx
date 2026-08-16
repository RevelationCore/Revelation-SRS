import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AdjustmentRequestPage } from '../src/pages/AdjustmentRequestPage.js';
import { AdjustmentCaseDetailPage } from '../src/pages/AdjustmentCaseDetailPage.js';

const WELLBEING_API = 'http://localhost:3002';
const PERSON_ID = 'test-student-001';
const NEW_CASE_ID = 'new-case-001';

function renderApp() {
  return renderWithProviders(
    <Routes>
      <Route path="/adjustments/request" element={<AdjustmentRequestPage />} />
      <Route path="/adjustments/requests/:caseId" element={<AdjustmentCaseDetailPage />} />
    </Routes>,
    { route: '/adjustments/request' },
  );
}

describe('adjustment request workflow — student portal', () => {
  it('submits a request and navigates to the new case, showing it is open for evidence', async () => {
    server.use(
      http.post(`${WELLBEING_API}/api/v1/adjustment-cases`, async ({ request }) => {
        const body = await request.json() as { personId: string; adjustmentTypeCode: string };
        expect(body.personId).toBe(PERSON_ID);
        return HttpResponse.json({ id: NEW_CASE_ID }, { status: 201 });
      }),
      http.get(`${WELLBEING_API}/api/v1/adjustment-cases/${NEW_CASE_ID}`, () => HttpResponse.json({
        id: NEW_CASE_ID,
        personId: PERSON_ID,
        adjustmentTypeCode: 'exam-time',
        statusCode: 'referral_received',
        recommendedAdjustment: null,
        rationale: 'I need extra time due to my condition.',
        validFrom: '2026-06-01T00:00:00Z',
        evidence: [],
      })),
    );

    const { container } = renderApp();

    await userEvent.type(screen.getByLabelText(/tell us why you need this adjustment/i), 'I need extra time due to my condition.');
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await screen.findByRole('heading', { name: /your adjustment request/i });
    expect(screen.getByText(/being reviewed/i)).toBeInTheDocument();
    expect(screen.getByText('I need extra time due to my condition.')).toBeInTheDocument();

    // Evidence upload is offered while the request is open
    expect(screen.getByLabelText(/^file$/i)).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it('shows the submit-error message when the request fails', async () => {
    server.use(
      http.post(`${WELLBEING_API}/api/v1/adjustment-cases`, () =>
        HttpResponse.json({ error: 'Could not create case' }, { status: 500 })),
    );

    renderApp();
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

    await screen.findByRole('alert');
  });
});
