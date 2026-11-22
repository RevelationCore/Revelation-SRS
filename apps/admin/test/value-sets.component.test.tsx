import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ValueSetsPage } from '../src/pages/ValueSetsPage.js';

const API = 'http://localhost:3000/bff/srs';
const locales = http.get(`${API}/api/v1/admin/globalisation/locales`, () => HttpResponse.json([
  { localeCode: 'en-GB', displayName: 'English (UK)', nativeDisplayName: 'English (UK)', isRtl: false, isPlatformDefault: true, active: true },
  { localeCode: 'cy-GB', displayName: 'Welsh', nativeDisplayName: 'Cymraeg', isRtl: false, isPlatformDefault: false, active: true },
]));

const sets = [
  { setCode: 'mode-of-study-code', displayName: 'Mode of Study', source: 'srs-internal', sourceVersion: null, description: 'Student mode of study',
    isExtensible: false, allowsTenantHide: true, usedBy: [{ entityName: 'enrolment', fieldName: 'mode_of_study_code' }] },
  { setCode: 'enrolment-status-code', displayName: 'Enrolment Status', source: 'srs-internal', sourceVersion: null, description: null,
    isExtensible: false, allowsTenantHide: false, usedBy: [{ entityName: 'enrolment', fieldName: 'status_code' }] },
  { setCode: 'hesa-domicile', displayName: 'HESA Domicile', source: 'hesa', sourceVersion: '2024-25', description: null,
    isExtensible: false, allowsTenantHide: true, usedBy: [] },
];

const member = (code: string, label: string, extra: Record<string, unknown> = {}) => ({
  code, displayLabel: label, description: null, sortOrder: 0, activeFrom: null, activeTo: null, active: true, hidden: false, selectable: true,
  isTenantOwned: false, platformLabel: label, platformDescription: null, overridden: false, wordings: [], ...extra,
});

describe('value sets management', () => {
  it('searches sets by field, and shows which fields a set governs', async () => {
    server.use(locales, http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)));
    const { container } = renderWithProviders(<ValueSetsPage />, { roles: ['tenant-administrator'] });

    expect(await screen.findByText('3 of 3 sets')).toBeInTheDocument();
    expect(screen.getByText('Used by enrolment.mode_of_study_code')).toBeInTheDocument();
    expect(screen.getByText('Relabel only')).toBeInTheDocument();
    expect(screen.getByText('Not linked to a field')).toBeInTheDocument();
    await expectNoA11yViolations(container);

    await userEvent.type(screen.getByLabelText(/^Search/), 'enrolment.status');
    expect(screen.getByText('1 of 3 sets')).toBeInTheDocument();
    expect(screen.getByText('Enrolment Status')).toBeInTheDocument();
    expect(screen.queryByText('Mode of Study')).not.toBeInTheDocument();
  });

  it('relabels, hides and restores a platform value', async () => {
    const state = { label: 'Part-time', hidden: false, calls: [] as unknown[] };
    const current = () => [
      member('full-time', 'Full-time'),
      member('part-time', state.label, { platformLabel: 'Part-time', hidden: state.hidden, selectable: !state.hidden, overridden: state.label !== 'Part-time' || state.hidden }),
    ];
    server.use(
      locales,
      http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)),
      http.get(`${API}/api/v1/value-sets/mode-of-study-code/members`, () => HttpResponse.json(current())),
      http.put(`${API}/api/v1/value-sets/mode-of-study-code/members/part-time/wording`, async ({ request }) => {
        const body = await request.json() as { displayLabel?: string | null };
        state.calls.push(body);
        state.label = body.displayLabel ?? 'Part-time';
        return HttpResponse.json(current()[1]);
      }),
      http.put(`${API}/api/v1/value-sets/mode-of-study-code/members/part-time/hidden`, async ({ request }) => {
        state.hidden = (await request.json() as { hidden: boolean }).hidden;
        return HttpResponse.json(current()[1]);
      }),
      http.delete(`${API}/api/v1/value-sets/mode-of-study-code/members/part-time/customisation`, () => {
        state.label = 'Part-time'; state.hidden = false;
        return HttpResponse.json(current()[1]);
      }),
    );
    const { container } = renderWithProviders(<ValueSetsPage />, { roles: ['tenant-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: /Mode of Study/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Relabel Part-time (part-time)' }));
    const label = screen.getByLabelText('Label for part-time');
    await userEvent.clear(label);
    await userEvent.type(label, 'Part-time (evening)');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const row = (await screen.findByText('Part-time (evening)')).closest('tr')!;
    expect(within(row).getByText('Platform: Part-time')).toBeInTheDocument();
    expect(state.calls[0]).toEqual({ localeCode: null, displayLabel: 'Part-time (evening)', description: null });
    await expectNoA11yViolations(container);

    await userEvent.click(within(row).getByRole('button', { name: 'Hide Part-time (evening) (part-time)' }));
    expect(await within(row).findByText('Hidden from pickers')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Restore the platform wording for part-time' }));
    expect(await screen.findByRole('button', { name: 'Relabel Part-time (part-time)' })).toBeInTheDocument();
    expect(screen.getAllByText('In use')).toHaveLength(2);
  });

  it('offers relabel but not hide for a lifecycle status, and keeps retired values out of the way', async () => {
    server.use(
      locales,
      http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)),
      http.get(`${API}/api/v1/value-sets/enrolment-status-code/members`, () => HttpResponse.json([
        member('enrolled', 'Enrolled'),
        member('legacy', 'Legacy status', { activeTo: '2020-01-01T00:00:00Z', active: false, selectable: false }),
      ])),
    );
    renderWithProviders(<ValueSetsPage />, { roles: ['tenant-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: /Enrolment Status/ }));
    expect(await screen.findByRole('button', { name: 'Relabel Enrolled (enrolled)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hide/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy status')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Show 1 retired value/));
    expect(screen.getByText('Legacy status')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });

  it('is read-only without config:write', async () => {
    server.use(
      locales,
      http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)),
      http.get(`${API}/api/v1/value-sets/mode-of-study-code/members`, () => HttpResponse.json([member('full-time', 'Full-time')])),
    );
    renderWithProviders(<ValueSetsPage />, { roles: ['registry-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: /Mode of Study/ }));
    expect(await screen.findByText('Full-time')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Relabel / })).not.toBeInTheDocument();
  });

  it('lists a value\'s translations and adds the institution\'s Welsh wording', async () => {
    let saved: unknown = null;
    const welsh = { scope: 'platform', localeCode: 'cy-GB', displayLabel: 'Amser llawn', description: null, updatedBy: 'system', updatedAt: '2026-11-18T00:00:00Z' };
    server.use(
      locales,
      http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)),
      http.get(`${API}/api/v1/value-sets/mode-of-study-code/members`, () => HttpResponse.json([member('full-time', 'Full-time', { wordings: [welsh] })])),
      http.put(`${API}/api/v1/value-sets/mode-of-study-code/members/full-time/wording`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(member('full-time', 'Full-time'));
      }),
    );
    const { container } = renderWithProviders(<ValueSetsPage />, { roles: ['tenant-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: /Mode of Study/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Languages for Full-time (full-time)' }));

    const table = await screen.findByRole('table', { name: 'Translations of full-time' });
    expect(within(table).getByText('Amser llawn')).toBeInTheDocument();
    expect(within(table).getByText('All institutions')).toBeInTheDocument();
    // A tenant administrator cannot remove the platform's translation.
    expect(within(table).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    // Nor write one: no 'For' choice is offered.
    expect(screen.queryByLabelText('For')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);

    await userEvent.type(screen.getByLabelText('Label'), 'Astudio amser llawn');
    await userEvent.click(screen.getByRole('button', { name: 'Save translation' }));
    await waitFor(() => expect(saved).toEqual({ localeCode: 'cy-GB', displayLabel: 'Astudio amser llawn', description: null, scope: 'tenant' }));
  });

  it('lets a platform translator word a value for all institutions', async () => {
    server.use(
      locales,
      http.get(`${API}/api/v1/value-sets`, () => HttpResponse.json(sets)),
      http.get(`${API}/api/v1/value-sets/mode-of-study-code/members`, () => HttpResponse.json([member('full-time', 'Full-time')])),
    );
    renderWithProviders(<ValueSetsPage />, { roles: ['system-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: /Mode of Study/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Languages for Full-time (full-time)' }));
    expect(await screen.findByLabelText('Language')).toBeInTheDocument();
    // A system administrator has no config:write, so the only scope is all institutions.
    expect(screen.queryByLabelText('For')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Relabel / })).not.toBeInTheDocument();
  });
});
