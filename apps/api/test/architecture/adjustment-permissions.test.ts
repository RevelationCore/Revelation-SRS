/**
 * ADR-033 Guard and SME-6: who holds the permissions that put an adjustment
 * on a student's record, and that no role both proposes and approves one.
 */
import { PERMISSION_ROLES } from '@revelation-srs/domain';
import { describe, expect, it } from 'vitest';

const holders = (p: keyof typeof PERMISSION_ROLES) => [...(PERMISSION_ROLES[p] as string[])].sort();

describe('adjustment authority permissions', () => {
  it('only the wellbeing service records a case adjustment; only an approver approves or releases', () => {
    expect(holders('adjustment:record-approved')).toEqual(['wellbeing-service']);
    expect(holders('adjustment:withdraw-approved')).toEqual(['wellbeing-service']);
    expect(holders('adjustment:approve-manual')).toEqual(['adjustment-approver']);
    expect(holders('adjustment:release-migrated')).toEqual(['adjustment-approver']);
    expect(holders('adjustment:approve-withdrawal')).toEqual(['adjustment-approver']);
  });

  it('SME-6: registry and adjustment-proposer propose; never a wellbeing adviser or an approver', () => {
    expect(holders('adjustment:propose')).toEqual(['adjustment-proposer', 'registry-administrator']);
  });

  it('no role holds both adjustment:propose and adjustment:approve-manual', () => {
    const both = holders('adjustment:propose').filter((r) => holders('adjustment:approve-manual').includes(r));
    expect(both).toEqual([]);
  });

  it('adjustment-proposer holds only the two propose permissions', () => {
    const held = Object.entries(PERMISSION_ROLES).filter(([, roles]) => (roles as string[]).includes('adjustment-proposer')).map(([p]) => p);
    expect(held).toEqual(['adjustment:propose', 'adjustment:propose-withdrawal']);
  });

  it('adjustment-approver holds only the approver permissions and read', () => {
    const held = Object.entries(PERMISSION_ROLES).filter(([, roles]) => (roles as string[]).includes('adjustment-approver')).map(([p]) => p).sort();
    expect(held).toEqual(['adjustment:approve-manual', 'adjustment:approve-withdrawal', 'adjustment:read:all', 'adjustment:release-migrated']);
  });

  it('ADR-034: withdrawals are proposed by registry, adjustment-proposer and wellbeing-advisor, and no role both proposes and approves one', () => {
    expect(holders('adjustment:propose-withdrawal')).toEqual(['adjustment-proposer', 'registry-administrator', 'wellbeing-advisor']);
    expect(holders('adjustment:propose-withdrawal').filter((r) => holders('adjustment:approve-withdrawal').includes(r))).toEqual([]);
  });
});
