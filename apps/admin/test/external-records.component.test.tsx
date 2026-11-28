import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ExternalRecordsTab } from '../src/pages/ExternalRecordsTab.js';

const API = 'http://localhost:3000/bff/srs';

const records = [
  { externalRecordId: 'r2', flowCode: 'F-LIB-SIS-01', flowName: 'Library account', sourceLabel: 'Library', personId: 'p1', recordKey: 'account', payload: {}, summary: 'Library account active: 2 on loan, 0 overdue, £0.00 outstanding', observedAt: '2026-10-08T09:00:00.000Z', receivedAt: '2026-10-08T09:00:00.000Z', receivedVia: 'connector', current: true },
  { externalRecordId: 'r1', flowCode: 'F-LIB-SIS-01', flowName: 'Library account', sourceLabel: 'Library', personId: 'p1', recordKey: 'account', payload: {}, summary: 'Library account active: 3 on loan, 1 overdue, £2.50 outstanding', observedAt: '2026-10-01T09:00:00.000Z', receivedAt: '2026-10-01T09:00:00.000Z', receivedVia: 'connector', current: false },
];

const flows = [
  { flowCode: 'F-ACC-SIS-01', sourceSystem: 'acc', sourceLabel: 'Accommodation', name: 'Accommodation booking', defined: true, fields: [
    { name: 'bookingReference', label: 'Booking reference', type: 'text', required: true },
    { name: 'bookingStatus', label: 'Booking status', type: 'code', required: true, valueSet: { entity: 'external_record_accommodation', field: 'booking_status' } },
  ] },
  { flowCode: 'F-CRM-SIS-01', sourceSystem: 'crm', sourceLabel: 'CRM', name: 'CRM', defined: false, fields: [] },
];

describe('other systems tab', () => {
  it('shows current records, earlier ones on request, and records one by hand', async () => {
    let posted: unknown = null;
    server.use(
      http.get(`${API}/api/v1/students/p1/external-records`, () => HttpResponse.json(records)),
      http.get(`${API}/api/v1/inbound-flows`, () => HttpResponse.json(flows)),
      http.get(`${API}/api/v1/fields/external_record_accommodation/booking_status/value-set`, () => HttpResponse.json({
        entityName: 'external_record_accommodation', fieldName: 'booking_status', valueSetCode: 'accommodation-booking-status-code',
        members: [{ code: 'checked-in', displayLabel: 'Checked in' }, { code: 'checked-out', displayLabel: 'Checked out' }],
      })),
      http.post(`${API}/api/v1/students/p1/external-records/F-ACC-SIS-01`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...records[0], externalRecordId: 'r3' }, { status: 201 });
      }),
    );
    const { container } = renderWithProviders(<ExternalRecordsTab personId="p1" canWrite />, { roles: ['registry-administrator'] });

    expect(await screen.findByText(/2 on loan/)).toBeInTheDocument();
    expect(screen.queryByText(/3 on loan/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show earlier reports' }));
    expect(screen.getByText(/3 on loan.*\(earlier\)/)).toBeInTheDocument();

    // Only flows with defined fields can be recorded.
    expect(screen.queryByText(/Record by hand: CRM/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Booking reference/), 'HALL-7');
    await screen.findByRole('option', { name: 'Checked out' });
    await userEvent.selectOptions(screen.getByLabelText(/Booking status/), 'checked-out');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText('Recorded')).toBeInTheDocument();
    expect(posted).toEqual({ payload: { bookingReference: 'HALL-7', bookingStatus: 'checked-out' } });
    await expectNoA11yViolations(container);
  });
});
