import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { CasCasePanel } from '../src/components/CasCasePanel.js';

const API = 'http://localhost:3000/bff/srs';
const item = {
  casCaseId: 'cas-1', personId: 'p-1', applicationId: 'a-1', enrolmentId: null, casReference: 'E4G7X2', statusCode: 'assigned',
  preparedBy: 'officer-1', preparedPayload: null, openedAt: '2026-05-01T00:00:00Z',
  subject: { studentName: 'Ada Applicant', programmeCode: 'BSC', programmeTitle: 'BSc' },
  eligibilityChecks: [], assignmentVersions: [], attentionReason: 'application-withdrawn' as const,
};

describe('CAS sponsor reports (D-43a)', () => {
  it('lists the sponsor reports made, records a new one, and flags a withdrawn applicant', async () => {
    let posted: unknown;
    const reports = [{ reportId: 'r-1', reportPayloadRef: 'SMS-REP-0001', distributionItemId: null, generatedAt: '2026-09-01T00:00:00Z', generatedBy: 'officer-1' }];
    server.use(
      http.get(`${API}/api/v1/regulatory/cas-cases/cas-1/sponsor-report-versions`, () => HttpResponse.json(reports)),
      http.post(`${API}/api/v1/regulatory/cas-cases/cas-1/sponsor-report-versions`, async ({ request }) => {
        posted = await request.json();
        reports.unshift({ reportId: 'r-2', reportPayloadRef: 'SMS-REP-0002', distributionItemId: null, generatedAt: '2026-10-01T00:00:00Z', generatedBy: 'officer-2' });
        return HttpResponse.json({ reportId: 'r-2' }, { status: 201 });
      }),
    );
    const { container } = renderWithProviders(<CasCasePanel item={item} onChanged={() => undefined} />, { roles: ['regulatory-officer'] });
    expect(await screen.findByText(/SMS-REP-0001/)).toBeVisible();
    expect(screen.getByText(/The applicant has withdrawn/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/SMS report reference/), 'SMS-REP-0002');
    await userEvent.click(screen.getByRole('button', { name: 'Record sponsor report' }));
    expect(await screen.findByText(/SMS-REP-0002/)).toBeVisible();
    expect(posted).toEqual({ reportPayloadRef: 'SMS-REP-0002' });
    await expectNoA11yViolations(container);
  });
});
