import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { UkviPage } from '../src/pages/UkviPage.js';

const API = 'http://localhost:3000';
const base = {
  casCaseId: 'cc-1', personId: 'p-1', applicationId: 'app-1', enrolmentId: null, casReference: null, statusCode: 'eligibility-checked',
  preparedBy: null, preparedPayload: null, openedAt: '2027-05-01T00:00:00Z',
  subject: { studentName: 'Amara Singh', programmeCode: 'MSC-X', programmeTitle: 'MSc X' },
  eligibilityChecks: [{ checkId: 'k-1', guidanceVersion: '10/2026', checkTypeCode: 'genuine-student', resultCode: 'pass', checkedBy: 'o-1', checkedAt: '2027-05-02T00:00:00Z' }],
  assignmentVersions: [],
};
function handlers(cases: unknown[]) {
  return [
    http.get(`${API}/api/v1/regulatory/cas-cases`, () => HttpResponse.json(cases)),
    http.get(`${API}/api/v1/regulatory/ukvi/operations/status`, () => HttpResponse.json({ reconciliationRequired: 0, pendingAuthorisation: 0, failedExchanges: 0 })),
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, () => HttpResponse.json({ setCode: 'x', displayName: 'x', members: [{ code: 'pass', displayLabel: 'Pass', description: null, sortOrder: 1 }] })),
  ];
}

describe('CAS cases on the UKVI page (D-16)', () => {
  it('prepares a checked case and exports approved CAS data for SMS', async () => {
    let prepared = false; let exported = false;
    server.use(
      ...handlers([base]),
      http.post(`${API}/api/v1/regulatory/cas-cases/cc-1/preparation`, () => { prepared = true; return HttpResponse.json({ ...base, statusCode: 'prepared' }); }),
      http.post(`${API}/api/v1/regulatory/cas-cases/sms-export`, () => { exported = true; return HttpResponse.json({ contract: 'ukvi/cas-request-outbound.v2', generatedAt: '2027-05-03T00:00:00Z', processedCount: 0, casRequests: [] }); }),
    );
    const { container } = renderWithProviders(<UkviPage />, { roles: ['regulatory-officer'] });
    expect(await screen.findByText('Amara Singh')).toBeVisible();
    expect(screen.getByText(/genuine-student/)).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Prepare CAS data' }));
    expect(prepared).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Export approved for SMS' }));
    expect(await screen.findByText('Nothing approved is waiting to be sent.')).toBeVisible();
    expect(exported).toBe(true);
  });

  it('the preparer is told someone else must approve; a sent case takes the CAS number', async () => {
    server.use(...handlers([
      { ...base, casCaseId: 'cc-2', statusCode: 'prepared', preparedBy: 'test-user-001' },
      { ...base, casCaseId: 'cc-3', statusCode: 'requested', subject: { ...base.subject, studentName: 'Bao Tran' },
        assignmentVersions: [{ assignmentVersionId: 'av-1', versionNumber: 1, assignedPayloadHash: 'x', casNumber: null, approvedBy: 'o-2', approvedAt: '2027-05-02T00:00:00Z', smsRequestSentAt: '2027-05-03T00:00:00Z', smsReceiptRef: null }] },
    ]));
    renderWithProviders(<UkviPage />, { roles: ['regulatory-officer'] });
    expect(await screen.findByText(/someone else must approve it/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve for SMS' })).toBeNull();
    const record = screen.getByRole('button', { name: 'Record CAS number' });
    expect(record).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/CAS number/), 'E4G1H2J3K4L5M6');
    expect(record).toBeEnabled();
  });
});
