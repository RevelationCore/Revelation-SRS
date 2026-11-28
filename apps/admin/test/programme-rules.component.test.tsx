import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ProgrammeRulesPage } from '../src/pages/ProgrammeRulesPage.js';

const API = 'http://localhost:3000/bff/srs';
const group = {
  moduleGroupId: 'g-1', programmeRuleSetId: 'rs-1', fheqLevel: 4, groupCode: 'CORE', title: 'Core modules', groupTypeCode: 'compulsory',
  minModules: 2, maxModules: null, minCredits: null, maxCredits: null, minFheqLevel: null, maxFheqLevel: null,
  members: [{ moduleGroupMemberId: 'gm-1', moduleId: 'm-1', moduleCode: 'CS101', moduleTitle: 'Programming', isDefault: true, isNonCondonable: true }],
};

function handlers() {
  return [
    http.get(`${API}/api/v1/programmes`, () => HttpResponse.json([{ programmeId: 'p-1', code: 'BSC-CS', title: 'BSc Computer Science' }])),
    http.get(`${API}/api/v1/modules`, () => HttpResponse.json([
      { moduleId: 'm-1', code: 'CS101', title: 'Programming', creditValue: 20 }, { moduleId: 'm-2', code: 'CS102', title: 'Maths', creditValue: 20 },
    ])),
    http.get(`${API}/api/v1/programme-rule-sets`, () => HttpResponse.json([{ programmeRuleSetId: 'rs-1', programmeId: 'p-1', programmeRouteId: null, entryAcademicYear: '2027-28', ruleSetCode: 'DEFAULT', description: null }])),
    http.get(`${API}/api/v1/module-groups`, () => HttpResponse.json([group])),
  ];
}

describe('programme rules (BP-03-002)', () => {
  it('shows a rule set\'s diet groups and adds a module to a group', async () => {
    let body: unknown;
    server.use(...handlers(), http.post(`${API}/api/v1/module-groups/g-1/members`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ moduleGroupMemberId: 'gm-2' }, { status: 201 }); }));
    const { container } = renderWithProviders(<ProgrammeRulesPage />, { roles: ['tenant-administrator'] });
    expect(await screen.findByText(/Compulsory · level 4 · 2–any modules/)).toBeVisible();
    await expectNoA11yViolations(container);
    // Modules already in the group are not offered again.
    // A module already in the group is not offered again for it.
    expect(within(screen.getByLabelText('Add a module to Core modules')).queryByRole('option', { name: 'CS101 — Programming' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Add a module to Core modules'), 'm-2');
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await screen.findByText(/Compulsory · level 4/);
    expect(body).toEqual({ moduleId: 'm-2', isDefault: true, isNonCondonable: false });
  });

  it('a programme approver sees the rules read-only', async () => {
    server.use(...handlers());
    renderWithProviders(<ProgrammeRulesPage />, { roles: ['programme-approver'] });
    expect(await screen.findByText('Core modules', { exact: false })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add diet group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add rule set' })).toBeNull();
  });
});
