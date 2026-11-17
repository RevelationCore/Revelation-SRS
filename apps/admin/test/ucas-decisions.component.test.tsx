import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { UcasDecisionsCard } from '../src/pages/UcasDecisionsCard.js';

const API = 'http://localhost:3000';
const item = (over: Record<string, unknown>) => ({
  exchangeId: 'x-1', applicationId: 'app-1', sourceReference: '2027:7200000001', outcome: 'offer-conditional', ucasCode: 'C',
  statusCode: 'queued', queuedAt: '2027-05-01T00:00:00Z', sentAt: null, attention: null, ...over,
});

describe('decisions for UCAS (D-15)', () => {
  it('shows queued decisions and what needs attention, and sends them', async () => {
    let sent = false;
    server.use(
      http.get(`${API}/api/v1/regulatory/ucas/decisions`, () => HttpResponse.json([
        item({}), item({ exchangeId: 'x-2', sourceReference: '2027:7200000002', statusCode: 'mismatch', attention: 'mismatch' }), item({ exchangeId: 'x-3', statusCode: 'reconciled' }),
      ])),
      http.post(`${API}/api/v1/regulatory/ucas/decisions/dispatch`, () => { sent = true; return HttpResponse.json({ contract: 'ucas/decisions-outbound.v1', generatedAt: '2027-05-02T00:00:00Z', transport: 'simulator', processedCount: 1, decisions: [] }); }),
    );
    const { container } = renderWithProviders(<UcasDecisionsCard canSend />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('2027:7200000001')).toBeVisible();
    expect(screen.getByText('UCAS reports something else')).toBeVisible();
    expect(screen.queryAllByText(/2027:7200000001/)).toHaveLength(1); // the reconciled item is not listed
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Send 1 decision(s)' }));
    expect(await screen.findByText(/1 decision\(s\) sent \(simulator\)/)).toBeVisible();
    expect(sent).toBe(true);
  });
});
