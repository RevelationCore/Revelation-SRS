import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { StatusChangesSection } from '../src/pages/StatusChangesSection.js';
import { DocumentsPage } from '../src/pages/DocumentsPage.js';
import { GraduationPage } from '../src/pages/GraduationPage.js';

const API = 'http://localhost:3000';
const ME = 'test-student-001';

function common(options: Record<string, unknown>, cases: unknown[] = []) {
  return [
    http.get(`${API}/api/v1/enrolments/enr-1/status-case-options`, () => HttpResponse.json({
      enrolmentStatusCode: 'enrolled', requestableTypes: ['interruption', 'withdrawal', 'transfer'], openCaseId: null, returnFrom: null, sponsored: false, ...options,
    })),
    http.get(`${API}/api/v1/enrolments/enr-1/status-cases`, () => HttpResponse.json(cases)),
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => HttpResponse.json({
      setCode: 'x', displayName: 'x',
      members: params['field'] === 'reason_category_code'
        ? [{ code: 'health', displayLabel: 'Health', description: null, sortOrder: 1 }]
        : [{ code: 'full-time', displayLabel: 'Full-time', description: null, sortOrder: 1 }, { code: 'part-time', displayLabel: 'Part-time', description: null, sortOrder: 2 }],
    })),
    http.get(`${API}/api/v1/programmes`, () => HttpResponse.json([{ programmeId: 'prog-2', code: 'BA-HIS', title: 'BA History' }])),
  ];
}

const render = () => renderWithProviders(<StatusChangesSection enrolmentId="enr-1" modeOfStudyCode="full-time" />, { srsPersonId: ME });

describe('requesting a change to my studies', () => {
  it('offers only what the enrolment allows and shows a funding notice before a withdrawal is sent', async () => {
    let body: unknown;
    server.use(...common({}), http.post(`${API}/api/v1/enrolments/enr-1/status-cases`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json({ statusCaseId: 'c-1' }, { status: 201 });
    }));
    const { container } = render();
    await userEvent.click(await screen.findByRole('button', { name: 'Request a change' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('Leave my course (withdrawal)');
    expect(screen.queryByRole('option', { name: /suspension/i })).toBeNull();
    await expectNoA11yViolations(container);

    await userEvent.selectOptions(screen.getByLabelText(/What do you want to request/), 'withdrawal');
    await userEvent.type(screen.getByLabelText(/Date you want this to start/), '2027-01-10');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/can change your student finance payments/)).toBeVisible();
    expect(screen.queryByText(/Student visa/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send my request' }));
    await screen.findByRole('button', { name: 'Request a change' });
    expect(body).toEqual({ caseTypeCode: 'withdrawal', requestedEffectiveDate: '2027-01-10' });
  });

  it('a sponsored student is told the university must report the change to UKVI', async () => {
    server.use(...common({ sponsored: true }));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Request a change' }));
    await userEvent.selectOptions(screen.getByLabelText(/What do you want to request/), 'interruption');
    await userEvent.type(screen.getByLabelText(/Date you want this to start/), '2027-01-10');
    await userEvent.type(screen.getByLabelText(/Date you expect to come back/), '2027-09-20');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/within 10 working days/)).toBeVisible();
  });

  it('shows an open request and lets the student withdraw it', async () => {
    let withdrawn = false;
    const open = { statusCaseId: 'c-9', caseTypeCode: 'interruption', statusCode: 'requested', initiatedByCode: 'student', reasonCategoryCode: null, requestedEffectiveDate: '2027-01-10', expectedReturnDate: '2027-09-20', decisionReason: null, approvedEffectiveDate: null, approvedReturnDate: null, createdBy: 'x', createdAt: '2026-11-01T00:00:00Z', conditions: [] };
    server.use(...common({ requestableTypes: [], openCaseId: 'c-9' }, [open]), http.post(`${API}/api/v1/status-cases/c-9/withdrawal`, () => { withdrawn = true; return HttpResponse.json({ ...open, statusCode: 'withdrawn' }); }));
    render();
    expect(await screen.findByText(/waiting for a decision/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw my request' }));
    await screen.findByText(/waiting for a decision/);
    expect(withdrawn).toBe(true);
  });
});

describe('documents and graduation', () => {
  it('lists my documents with verification codes only for valid issues', async () => {
    server.use(http.get(`${API}/api/v1/students/${ME}/documents`, () => HttpResponse.json([
      { documentIssueId: 'd-1', documentTypeCode: 'certificate', issueNumber: 1, issueTypeCode: 'original', channelCode: 'post', verificationCode: 'VER-111', statusCode: 'issued', issuedAt: '2027-07-01T00:00:00Z' },
      { documentIssueId: 'd-2', documentTypeCode: 'transcript', issueNumber: 1, issueTypeCode: 'original', channelCode: 'post', verificationCode: 'VER-222', statusCode: 'revoked', issuedAt: '2027-07-01T00:00:00Z' },
    ])));
    const { container } = renderWithProviders(<DocumentsPage />, { srsPersonId: ME });
    expect(await screen.findByText('VER-111')).toBeVisible();
    expect(screen.queryByText('VER-222')).toBeNull();
    expect(screen.getByText('Revoked')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('replies to a graduation invitation with guests and accessibility needs', async () => {
    let body: unknown;
    const invitation = { invitationId: 'i-1', cycleId: 'cy-1', awardId: 'a-1', responseCode: 'invited', guestCount: 0, accessibilityRequired: false, respondedAt: null, createdAt: '2027-05-01T00:00:00Z' };
    server.use(
      http.get(`${API}/api/v1/students/${ME}/graduation-invitations`, () => HttpResponse.json([invitation])),
      http.post(`${API}/api/v1/graduation-invitations/i-1/response`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...invitation, responseCode: 'attending' }); }),
    );
    renderWithProviders(<GraduationPage />, { srsPersonId: ME });
    const guests = await screen.findByLabelText('Number of guests');
    await userEvent.clear(guests);
    await userEvent.type(guests, '2');
    await userEvent.click(screen.getByLabelText(/accessibility support/));
    await userEvent.click(screen.getByRole('button', { name: 'Save my reply' }));
    expect(await screen.findByText('Your reply has been saved.')).toBeVisible();
    expect(body).toEqual({ responseCode: 'attending', guestCount: 2, accessibilityRequired: true });
  });
});
