import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ClearingPage } from '../src/pages/ClearingPage.js';

const API = 'http://localhost:3000';
const open = { open: true, opensAt: '2027-07-01T00:00:00Z', closesAt: '2099-09-30T00:00:00Z', programmeIds: ['prog-1'], verbalOfferHours: 48 };
const review = {
  caseId: 'cr-1', statusCode: 'open', applicationId: 'app-1', sourceReference: '2027:1234567890', offerId: 'o-1', offerTypeCode: 'clearing-verbal',
  expiresOn: '2027-08-16', programmeId: 'prog-1', decidedBy: 'someone-else', decidedAt: '2027-08-14T10:00:00Z', reviewDueBy: '2099-08-16T10:00:00Z', review: null,
};
function handlers(reviews: unknown[] = []) {
  return [
    http.get(`${API}/api/v1/clearing/status`, () => HttpResponse.json(open)),
    http.get(`${API}/api/v1/clearing/reviews`, () => HttpResponse.json(reviews)),
    http.get(`${API}/api/v1/programmes`, () => HttpResponse.json([{ programmeId: 'prog-1', code: 'BSC-CS', title: 'BSc Computer Science' }])),
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, () => HttpResponse.json({ setCode: 'x', displayName: 'x', members: [{ code: 'full-time', displayLabel: 'Full-time', description: null, sortOrder: 1 }] })),
  ];
}

describe('Clearing (BP-01-006)', () => {
  it('takes a call to a verbal offer; a declared visa need blocks the fast path', async () => {
    let body: unknown;
    server.use(...handlers(), http.post(`${API}/api/v1/clearing/calls`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ application: { id: 'app-9' }, reviewCaseId: 'cr-9' }, { status: 201 }); }));
    const { container } = renderWithProviders(<ClearingPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('Take a Clearing call')).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.type(screen.getByLabelText(/Call reference/), 'CALL-1');
    await userEvent.type(screen.getByLabelText(/First name/), 'Cleo');
    await userEvent.type(screen.getByLabelText(/Family name/), 'Clearing');
    await userEvent.selectOptions(screen.getByLabelText(/Programme/), 'prog-1');
    await userEvent.type(screen.getByLabelText(/Intake/), '2027-09');
    await userEvent.selectOptions(screen.getByLabelText(/Mode of study/), 'full-time');
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Meets BBC');
    await userEvent.click(screen.getByLabelText(/needs a Student visa/));
    expect(screen.getByText(/cannot be decided through the Clearing fast path/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Make the offer' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/needs a Student visa/));
    await userEvent.click(screen.getByRole('button', { name: 'Make the offer' }));
    expect(await screen.findByText(/Offer recorded/)).toBeVisible();
    expect(body).toMatchObject({ callReference: 'CALL-1', programmeId: 'prog-1', intakeCode: '2027-09', offer: { offerTypeCode: 'clearing-verbal' }, declarations: { studentVisaRequired: false } });
  });

  it('a programme approver upholds a decision awaiting review', async () => {
    let body: unknown;
    server.use(...handlers([review]), http.post(`${API}/api/v1/clearing/reviews/cr-1`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...review, statusCode: 'decided' }); }));
    renderWithProviders(<ClearingPage />, { roles: ['programme-approver'] });
    expect(await screen.findByText('2027:1234567890')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Needs correction' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Uphold' }));
    await screen.findByText('2027:1234567890');
    expect(body).toEqual({ outcomeCode: 'upheld' });
  });
});
