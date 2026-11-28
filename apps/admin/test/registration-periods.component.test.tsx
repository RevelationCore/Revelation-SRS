import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { RegistrationPeriodDetailPage, RegistrationPeriodsPage } from '../src/pages/RegistrationPeriodsPage.js';

const API = 'http://localhost:3000/bff/srs';
const period = {
  periodId: 'rp-1', academicYear: '2027-28', programmeId: null, opensAt: '2027-06-01T00:00:00Z', closesAt: '2027-09-30T00:00:00Z', reminderAt: null,
  periodTypeCode: 'annual', openedBy: 'u', closedAt: null, closedBy: null, counts: { pending: 1, confirmed: 3, lapsed: 0 }, termsVersion: '2027.1',
};
const row = (statusCode: string) => ({
  confirmationId: 'c-1', enrolmentId: 'e-1', reenrolmentPeriodId: 'rp-1', statusCode, confirmedAt: null, confirmedBy: null, channelCode: null, termsVersion: null, assistedReasonCode: null,
  subject: { personId: 'p-1', studentNumber: 'S1', studentName: 'Ada Lovelace', programmeCode: 'BSC-CS', programmeTitle: 'BSc CS' },
});
const reasons = http.get(`${API}/api/v1/fields/:entity/:field/value-set`, () => HttpResponse.json({
  setCode: 'x', displayName: 'x', members: [{ code: 'phone', displayLabel: 'By phone', description: null, sortOrder: 1 }, { code: 'late', displayLabel: 'Late registration', description: null, sortOrder: 2 }],
}));

describe('registration periods (BP-02-010)', () => {
  it('lists periods with their counts', async () => {
    server.use(http.get(`${API}/api/v1/registration-periods`, () => HttpResponse.json([period])), http.get(`${API}/api/v1/programmes`, () => HttpResponse.json([])));
    const { container } = renderWithProviders(<RegistrationPeriodsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('2027-28')).toBeVisible();
    expect(screen.getByText('Continuing students')).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Open a period' }));
    expect(screen.getByRole('button', { name: 'Open period' })).toBeDisabled();
  });

  it('registers a student on their behalf with a reason and the current terms', async () => {
    let body: unknown;
    server.use(
      reasons,
      http.get(`${API}/api/v1/registration-periods/rp-1`, () => HttpResponse.json(period)),
      http.get(`${API}/api/v1/registration-periods/rp-1/confirmations`, () => HttpResponse.json([row('pending')])),
      http.post(`${API}/api/v1/registration-confirmations/c-1/confirmation`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    const { container } = renderWithProviders(<Routes><Route path="/registration/:periodId" element={<RegistrationPeriodDetailPage />} /></Routes>, { roles: ['registry-administrator'], route: '/registration/rp-1' });
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    // The period has not ended, so it cannot be closed yet.
    expect(screen.getByRole('button', { name: 'Close period' })).toBeDisabled();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: /Register on their behalf/ }));
    await userEvent.selectOptions(await screen.findByLabelText('Reason for Ada Lovelace'), 'phone');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    await screen.findByRole('button', { name: /Register on their behalf/ });
    expect(body).toEqual({ acceptedTermsVersion: '2027.1', assistedReasonCode: 'phone' });
  });

  it('a lapsed student can only be registered as a late registration', async () => {
    server.use(
      reasons,
      http.get(`${API}/api/v1/registration-periods/rp-1`, () => HttpResponse.json(period)),
      http.get(`${API}/api/v1/registration-periods/rp-1/confirmations`, () => HttpResponse.json([row('lapsed')])),
    );
    renderWithProviders(<Routes><Route path="/registration/:periodId" element={<RegistrationPeriodDetailPage />} /></Routes>, { roles: ['registry-administrator'], route: '/registration/rp-1' });
    await userEvent.click(await screen.findByRole('button', { name: /Register on their behalf/ }));
    const select = await screen.findByLabelText<HTMLSelectElement>('Reason for Ada Lovelace');
    expect(select.value).toBe('late');
    expect(select).toBeDisabled();
  });
});
