import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { RegistrationPage } from '../src/pages/RegistrationPage.js';

const API = 'http://localhost:3000';
const ME = 'test-student-001';
const reg = (over: Record<string, unknown> = {}, statusCode = 'pending') => ({
  confirmation: { confirmationId: 'c-1', enrolmentId: 'e-1', statusCode, confirmedAt: null, channelCode: null, termsVersion: null },
  period: { periodId: 'rp-1', academicYear: '2027-28', opensAt: '2026-01-01T00:00:00Z', closesAt: '2099-09-30T00:00:00Z', periodTypeCode: 'annual', closedAt: null },
  blockers: [], termsVersion: '2027.1', ...over,
});

describe('registering for the year', () => {
  it('registers once the student accepts the current terms', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/students/${ME}/registrations`, () => HttpResponse.json([reg()])),
      http.post(`${API}/api/v1/registration-confirmations/c-1/confirmation`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    const { container } = renderWithProviders(<RegistrationPage />);
    const button = await screen.findByRole('button', { name: 'Register for 2027-28' });
    expect(button).toBeDisabled();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByLabelText(/accept the university's terms and conditions \(version 2027.1\)/));
    await userEvent.click(button);
    await screen.findByRole('button', { name: 'Register for 2027-28' });
    expect(body).toEqual({ acceptedTermsVersion: '2027.1' });
  });

  it('explains why the student cannot register yet', async () => {
    server.use(http.get(`${API}/api/v1/students/${ME}/registrations`, () => HttpResponse.json([reg({ blockers: [{ code: 'results-pending', message: 'Your results for last year are not yet confirmed by the exam board' }] })])));
    renderWithProviders(<RegistrationPage />);
    expect(await screen.findByText(/not yet confirmed by the exam board/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Register for/ })).toBeNull();
  });

  it('tells a lapsed student to contact the registry', async () => {
    server.use(http.get(`${API}/api/v1/students/${ME}/registrations`, () => HttpResponse.json([reg({}, 'lapsed')])));
    renderWithProviders(<RegistrationPage />);
    expect(await screen.findByText(/They can register you late/)).toBeVisible();
  });

  it('a student blocked on right to study can share a View and Prove code', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/students/${ME}/registrations`, () => HttpResponse.json([reg({ periodTypeCode: 'initial', blockers: [{ code: 'right-to-study', message: 'Your right to study in the UK has not been confirmed yet.' }] })])),
      http.post(`${API}/api/v1/students/${ME}/right-to-study/share-code`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }); }),
    );
    const { container } = renderWithProviders(<RegistrationPage />);
    const send = await screen.findByRole('button', { name: 'Send share code' });
    expect(send).toBeDisabled();
    await expectNoA11yViolations(container);
    await userEvent.type(screen.getByLabelText(/View and Prove share code/), 'W2X4YZ7AB');
    await userEvent.click(send);
    expect(await screen.findByText(/The registry will check your share code/)).toBeVisible();
    expect(body).toEqual({ shareCode: 'W2X4YZ7AB' });
  });
});
