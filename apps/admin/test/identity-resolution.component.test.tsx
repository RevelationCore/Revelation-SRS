import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { IdentityResolutionPage } from '../src/pages/IdentityResolutionPage.js';

/** ADR-031: one officer proposes a merge, another decides it on the version they read. */
const API = 'http://localhost:3000';

const proposal = {
  proposalId: 'prop-1', version: 2, survivorPersonId: 'person-keep', mergedPersonId: 'person-dup',
  factChoices: {}, identifierResolutions: { husid: { keep: 'survivor', reason: 'HESA confirmed' } }, twoAccountsConfirmed: false,
  proposedBy: 'officer-a', proposedAt: '2026-11-22T10:00:00.000Z',
  identifierConflicts: [{ identifierClass: 'husid', survivorValues: ['1819876543210'], mergedValues: ['1811234567890'], resolved: true }],
};

describe('identity resolution (ADR-031)', () => {
  it('decides on the proposal version shown, with a reason and no survivor of its own', async () => {
    let body: unknown = null;
    server.use(
      http.get(`${API}/api/v1/identity-resolution/cases`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/identity-resolution/correction-cases`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/identity-resolution/cases/case-1/proposal`, () => HttpResponse.json(proposal)),
      http.post(`${API}/api/v1/identity-resolution/cases/case-1/decision`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ decisionId: 'dec-1' }, { status: 201 });
      }),
    );
    const { container } = renderWithProviders(<IdentityResolutionPage />, { roles: ['identity-resolution-officer'] });

    await userEvent.click(screen.getByRole('tab', { name: 'Decide a case' }));
    await userEvent.type(screen.getByLabelText(/Case ID/), 'case-1');
    await userEvent.click(screen.getByRole('button', { name: 'Load proposal' }));
    expect(await screen.findByText(/Version 2: merge/)).toHaveTextContent('husid (resolved)');

    await userEvent.type(screen.getByLabelText(/Reason/), 'Same date of birth and address');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText(/Decision recorded/)).toBeInTheDocument();
    expect(body).toEqual({ decisionTypeCode: 'merge', reason: 'Same date of birth and address', proposalVersion: 2 });
    await expectNoA11yViolations(container);
  });

  it('links related records only, never merges', async () => {
    let body: unknown = null;
    server.use(
      http.get(`${API}/api/v1/identity-resolution/cases`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/identity-resolution/correction-cases`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/identity-resolution/links`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ linkId: 'link-1' }, { status: 201 });
      }),
    );
    renderWithProviders(<IdentityResolutionPage />, { roles: ['identity-resolution-officer'] });

    await userEvent.click(screen.getByRole('tab', { name: 'Link persons' }));
    await userEvent.type(screen.getByLabelText(/Source person ID/), 'person-a');
    await userEvent.type(screen.getByLabelText(/Target person ID/), 'person-b');
    await userEvent.click(screen.getByRole('button', { name: 'Link persons' }));

    await waitFor(() => expect(body).toEqual({ sourcePersonId: 'person-a', targetPersonId: 'person-b', linkTypeCode: 'related-record' }));
  });
});
