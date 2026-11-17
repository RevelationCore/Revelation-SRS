import { expect } from 'vitest';

import type { TestApp } from './test-app.js';

/**
 * Fixtures for module-selection tests (Phase 4). Every call creates fresh
 * rows with unique codes, so tests in one tenant do not interfere; rules
 * should be scoped to the programme a test creates.
 */
export function selectionFixtures(ctx: TestApp, tokens: { staff: string; admin: string }) {
  let seq = 0;
  const uniq = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${(seq += 1)}`.toUpperCase();
  const inject = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, token = tokens.staff) =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const created = async <T>(method: 'POST' | 'PUT', url: string, payload: unknown, token?: string): Promise<T> => {
    const res = await inject(method, url, payload, token);
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json<T>();
  };

  return {
    inject,
    uniq,
    async period(input: { academicYear?: string; startDate?: string; endDate?: string } = {}): Promise<string> {
      return (await created<{ academicPeriodId: string }>('POST', '/api/v1/academic-periods', {
        academicYear: input.academicYear ?? '2026-27', periodCode: uniq('P'), periodTypeCode: 'semester',
        startDate: input.startDate ?? '2026-09-21', endDate: input.endDate ?? '2027-01-15',
      })).academicPeriodId;
    },
    async programme(): Promise<string> {
      return (await created<{ programmeId: string }>('POST', '/api/v1/programmes', { code: uniq('PR'), title: 'Programme', fheqLevel: 4, creditTotal: 120 })).programmeId;
    },
    async ruleSet(programmeId: string): Promise<string> {
      return (await created<{ programmeRuleSetId: string }>('POST', '/api/v1/programme-rule-sets', { programmeId, ruleSetCode: uniq('RS') }, tokens.admin)).programmeRuleSetId;
    },
    async group(programmeRuleSetId: string, input: { groupTypeCode: string; minModules?: number; maxModules?: number; title?: string }): Promise<string> {
      return (await created<{ moduleGroupId: string }>('POST', '/api/v1/module-groups', {
        programmeRuleSetId, groupCode: uniq('G'), title: input.title ?? 'Group', ...input,
      }, tokens.admin)).moduleGroupId;
    },
    async member(moduleGroupId: string, moduleId: string, extra: Record<string, unknown> = {}): Promise<void> {
      await created('POST', `/api/v1/module-groups/${moduleGroupId}/members`, { moduleId, isDefault: false, ...extra }, tokens.admin);
    },
    async module(creditValue = 20, fheqLevel = 4): Promise<{ moduleId: string; code: string }> {
      const code = uniq('M');
      return { code, moduleId: (await created<{ moduleId: string }>('POST', '/api/v1/modules', { code, title: `Module ${code}`, creditValue, fheqLevel })).moduleId };
    },
    async offering(moduleId: string, academicPeriodId: string, capacity = 50): Promise<string> {
      return (await created<{ moduleOfferingId: string }>('POST', '/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity })).moduleOfferingId;
    },
    async student(programmeId: string, opts: { modeOfStudyCode?: string } = {}): Promise<{ personId: string; enrolmentId: string }> {
      const personId = (await created<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: 'Test', legalFamilyName: uniq('S') })).personId;
      const enrolmentId = (await created<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
        personId, programmeId, modeOfStudyCode: opts.modeOfStudyCode ?? 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
      })).enrolmentId;
      return { personId, enrolmentId };
    },
    async rule(programmeId: string, ruleTypeCode: string, ruleKey: string, ruleValue: Record<string, unknown>): Promise<void> {
      await created('POST', '/api/v1/academic-rules', { programmeId, ruleTypeCode, ruleKey, ruleValue, validFrom: '2020-01-01T00:00:00.000Z' }, tokens.admin);
    },
    async proposal(enrolmentId: string, academicPeriodId: string, fheqLevel = 4): Promise<string> {
      return (await created<{ moduleSelectionProposalId: string }>('POST', '/api/v1/module-selection-proposals', { enrolmentId, academicPeriodId, fheqLevel })).moduleSelectionProposalId;
    },
    async item(proposalId: string, moduleId: string, moduleOfferingId: string, extra: Record<string, unknown> = {}): Promise<string> {
      return (await created<{ proposalItemId: string }>('POST', `/api/v1/module-selection-proposals/${proposalId}/items`, { moduleId, moduleOfferingId, ...extra })).proposalItemId;
    },
    async clearItems(proposalId: string): Promise<void> {
      const p = (await inject('GET', `/api/v1/module-selection-proposals/${proposalId}`)).json<{ items: Array<{ proposalItemId: string }> }>();
      for (const i of p.items) await inject('DELETE', `/api/v1/module-selection-proposals/${proposalId}/items/${i.proposalItemId}`);
    },
    async submit(proposalId: string, body?: unknown, token?: string) {
      return inject('POST', `/api/v1/module-selection-proposals/${proposalId}/submission`, body, token);
    },
    async getProposal(proposalId: string) {
      return (await inject('GET', `/api/v1/module-selection-proposals/${proposalId}`)).json<ProposalWire>();
    },
  };
}

export interface ProposalWire {
  moduleSelectionProposalId: string;
  statusCode: string;
  decisionReason: string | null;
  decisionAuthorityCode: string | null;
  workflowInstanceId: string | null;
  items: Array<{
    proposalItemId: string; moduleId: string; moduleOfferingId: string | null; sourceCode: string; choiceSlot: number | null;
    reassessmentPlanId: string | null; isReplacement: boolean; validationStateCode: string;
    validationMessages: Array<{ ruleTypeCode: string; message: string; severity: 'error' | 'warning' }>;
  }>;
}

/** Every validation message on a proposal, item-level and the overall reason. */
export function messages(p: ProposalWire): Array<{ ruleTypeCode: string; message: string; severity: string }> {
  return p.items.flatMap((i) => i.validationMessages);
}
