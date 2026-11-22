import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ApplicationDetailPage } from '../src/pages/ApplicationDetailPage.js';
import { ApplicationsPage } from '../src/pages/ApplicationsPage.js';

const API = 'http://localhost:3000/bff/srs';
const ME = 'applicant-001';

const application = (over: Record<string, unknown> = {}) => ({
  applicationId: 'app-1', channelCode: 'direct', cycle: '2027',
  programme: { programmeId: 'p-1', code: 'BSC-CS', title: 'BSc Computer Science' },
  intakeCode: '2027-09', modeOfStudyCode: 'full-time', status: 'offer-made', respondElsewhere: false,
  offer: {
    offerId: 'offer-1', version: 1, offerTypeCode: 'conditional', statusCode: 'made', expiresOn: '2027-06-30', responseCode: null, respondedAt: null,
    conditions: [{ conditionId: 'cond-1', description: 'AAB at A level', requiredValue: 'AAB', statusCode: 'pending', evidence: [] }],
  },
  confirmation: null, cas: null, withdrawnAt: null, ...over,
});

const detail = () => (
  <Routes><Route path="/applications/:applicationId" element={<ApplicationDetailPage />} /></Routes>
);

describe('applicant portal (D-39)', () => {
  it('lists the applicant\'s applications with their status', async () => {
    server.use(http.get(`${API}/api/v1/applicants/${ME}/applications`, () => HttpResponse.json([application()])));
    const { container } = renderWithProviders(<ApplicationsPage />, { roles: ['applicant'], srsPersonId: ME });
    expect(await screen.findByRole('link', { name: 'BSc Computer Science' })).toBeVisible();
    expect(screen.getByText('Offer made')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('accepts a direct offer', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/applicants/${ME}/applications/app-1`, () => HttpResponse.json(application())),
      http.post(`${API}/api/v1/applicants/${ME}/offers/offer-1/response`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(application({ status: 'offer-accepted', offer: { ...application().offer, statusCode: 'accepted', responseCode: 'accept' } }));
      }),
    );
    const { container } = renderWithProviders(detail(), { roles: ['applicant'], srsPersonId: ME, route: '/applications/app-1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Accept offer' }));
    expect(await screen.findByText('You accepted this offer.')).toBeVisible();
    expect(body).toEqual({ responseCode: 'accept' });
    expect(screen.getByText('Offer accepted')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('a UCAS applicant is sent to UCAS Hub and cannot reply here', async () => {
    server.use(http.get(`${API}/api/v1/applicants/${ME}/applications/app-1`, () => HttpResponse.json(application({ channelCode: 'ucas', respondElsewhere: true }))));
    renderWithProviders(detail(), { roles: ['applicant'], srsPersonId: ME, route: '/applications/app-1' });
    expect(await screen.findByText(/Reply to offers and withdraw in UCAS Hub/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept offer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw this application' })).toBeNull();
  });
});
