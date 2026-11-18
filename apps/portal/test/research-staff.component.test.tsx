import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ExaminationPage, ResearchPage } from '../src/pages/ResearchPages.js';

const API = 'http://localhost:3000';
const ME = 'examiner-001';
const valueSet = (members: Array<{ code: string; displayLabel: string }>) => ({ valueSetId: 'vs', setCode: 'x', displayName: 'x', members });

describe('research staff portal (D-40)', () => {
  it('lists an examiner\'s examinations with whether their report is in', async () => {
    server.use(http.get(`${API}/api/v1/research-staff/${ME}/pgr/assignments`, () => HttpResponse.json({
      supervisees: [], panels: [],
      examinations: [{ examinationCaseId: 'ex-1', studentName: 'Taylor Candidate', statusCode: 'examiners-confirmed', examinerRoleCode: 'external', reportSubmitted: false }],
    })));
    const { container } = renderWithProviders(<ResearchPage />, { roles: ['pgr-examiner'], srsPersonId: ME });
    expect(await screen.findByRole('link', { name: 'Taylor Candidate' })).toBeVisible();
    expect(screen.getByText('Report due')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('keeps the co-examiner\'s report hidden until the exchange rule allows', async () => {
    server.use(
      http.get(`${API}/api/v1/research-staff/${ME}/pgr/examinations/ex-1`, () => HttpResponse.json({
        examinationCaseId: 'ex-1', statusCode: 'examiners-confirmed', studentName: 'Taylor Candidate',
        thesis: { versionNumber: 1, formatCode: 'traditional', submittedAt: '2029-01-01T00:00:00Z', downloadable: false, storageRef: 'repo://thesis/1' },
        appointment: { appointmentId: 'ap-1', examinerRoleCode: 'external', confirmed: true, independenceChecked: true, conflictTypeCode: null },
        coExaminers: [{ name: 'Elena Vasquez', examinerRoleCode: 'internal' }],
        ownReport: null, reportExchange: 'after-all-submitted', otherReports: null,
      })),
      http.get(`${API}/api/v1/fields/examiner_report/recommendation_code/value-set`, () => HttpResponse.json(valueSet([{ code: 'pass', displayLabel: 'Pass' }]))),
      http.get(`${API}/api/v1/fields/board_member_conflict/conflict_type_code/value-set`, () => HttpResponse.json(valueSet([{ code: 'family', displayLabel: 'Family relationship' }]))),
    );
    const { container } = renderWithProviders(
      <Routes><Route path="/research/examinations/:caseId" element={<ExaminationPage />} /></Routes>,
      { roles: ['pgr-examiner'], srsPersonId: ME, route: '/research/examinations/ex-1' },
    );
    expect(await screen.findByText(/Co-examiners: Elena Vasquez/)).toBeVisible();
    expect(screen.getByText(/shown once the exchange rule allows/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });
});
