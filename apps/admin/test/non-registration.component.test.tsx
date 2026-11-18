import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { NonRegistrationPage } from '../src/pages/NonRegistrationPage.js';

const API = 'http://localhost:3000';
const base = {
  caseId: 'nr-1', statusCode: 'under-review', enrolmentId: 'e-1', confirmationId: 'c-1', academicYear: '2027-28', periodClosesAt: '2027-10-15T00:00:00Z', openedAt: '2027-10-15T00:00:00Z',
  flags: ['sponsored', 'results-pending'], contactAttempts: [{ evidenceId: 'ev-1', channelCode: 'phone', reference: 'Call log 1', contactedAt: '2027-10-16T00:00:00Z', contactedBy: 'u' }],
  writtenNonContinuation: null, outcome: null, decisionAllowedFrom: '2027-10-30T00:00:00Z', ukviReportDueBy: '2027-10-29T00:00:00Z',
  subject: { personId: 'p-1', studentNumber: 'S1', studentName: 'Ada Lovelace', programmeCode: 'BSC-CS', programmeTitle: 'BSc CS' },
};
const channels = http.get(`${API}/api/v1/fields/non_registration_case/contact_channel_code/value-set`, () => HttpResponse.json({
  setCode: 'x', displayName: 'x', members: [{ code: 'portal', displayLabel: 'Portal notification', description: null, sortOrder: 1 }, { code: 'email', displayLabel: 'Email', description: null, sortOrder: 2 }],
}));

describe('students who did not register (BP-02-011)', () => {
  it('shows the UKVI deadline and review points, and records a contact attempt', async () => {
    let body: unknown;
    server.use(
      channels,
      http.get(`${API}/api/v1/non-registration-cases`, () => HttpResponse.json([base])),
      http.post(`${API}/api/v1/non-registration-cases/nr-1/contact-attempts`, async ({ request }) => { body = await request.json(); return HttpResponse.json(base, { status: 201 }); }),
    );
    const { container } = renderWithProviders(<NonRegistrationPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText(/UKVI must be told by 29\/10\/2027/)).toBeVisible();
    expect(await screen.findByText('Last year\'s results not ratified')).toBeVisible();
    expect(screen.getByText(/Call log 1/)).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.click(screen.getByRole('button', { name: /Record contact/ }));
    await userEvent.selectOptions(await screen.findByLabelText(/How/), 'email');
    await userEvent.type(screen.getByLabelText(/Reference/), 'msg-42');
    await userEvent.click(screen.getByRole('button', { name: 'Record contact' }));
    await screen.findByRole('button', { name: /Record contact/ });
    expect(body).toEqual({ channelCode: 'email', reference: 'msg-42' });
  });

  it('decides non-registration with the regulations applied, defaulting the effective date to the period close', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/non-registration-cases`, () => HttpResponse.json([base])),
      http.post(`${API}/api/v1/non-registration-cases/nr-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json(base); }),
    );
    renderWithProviders(<NonRegistrationPage />, { roles: ['registry-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: /Decide non-registration/ }));
    expect(screen.getByText(/Another person must approve it/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Reason/), 'No response to three contacts');
    await userEvent.type(screen.getByLabelText(/Regulations applied/), 'GR-2027');
    await userEvent.click(screen.getAllByRole('button', { name: 'Decide non-registration' }).at(-1)!);
    await screen.findByText('Ada Lovelace');
    expect(body).toEqual({ reason: 'No response to three contacts', policyVersion: 'GR-2027', effectiveDate: '2027-10-15' });
  });

  it('a personal tutor sees cases but cannot act', async () => {
    server.use(http.get(`${API}/api/v1/non-registration-cases`, () => HttpResponse.json([{ ...base, flags: [], ukviReportDueBy: null }])));
    renderWithProviders(<NonRegistrationPage />, { roles: ['personal-tutor'] });
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Record contact/ })).toBeNull();
  });
});
