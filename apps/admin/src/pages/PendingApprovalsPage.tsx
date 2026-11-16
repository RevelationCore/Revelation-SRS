import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, CardHeader, Button, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import {
  type PendingApprovals, type PendingSubject,
  listPendingApprovals, decideRecognisedCredit, decideRuleException,
} from '../api/academicExceptions.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { DecideControl, message, ruleLabel } from './AcademicExceptionsTab.js';
import { type BindingChange, decideBindingChange, listPendingBindingChanges } from '../api/programmeRules.js';

/**
 * Recognised credit and rule exceptions awaiting a decision, across all
 * students (BPR-D05). An approver decides here without needing access to
 * the full student record; the proposer is told someone else must decide.
 */
export function PendingApprovalsPage() {
  const { roles, user } = useAuth();
  const [pending, setPending] = useState<PendingApprovals | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const canOpenRecord = userHasAnyPermission(roles, ['student:read:all']);
  const canApproveBindings = userHasAnyPermission(roles, ['curriculum-binding:approve']);
  const [bindingChanges, setBindingChanges] = useState<BindingChange[]>([]);

  const loadBindingChanges = useCallback(async () => {
    if (canApproveBindings) setBindingChanges(await listPendingBindingChanges().catch(() => []));
  }, [canApproveBindings]);
  useEffect(() => { void loadBindingChanges(); }, [loadBindingChanges]);

  const load = useCallback(async () => {
    setError('');
    try {
      setPending(await listPendingApprovals());
    } catch (err) { setError(message(err, 'Failed to load pending approvals')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await Promise.all([load(), loadBindingChanges()]); return true; } catch (err) { setActionError(message(err, 'The decision failed')); return false; }
  }, [load, loadBindingChanges]);

  const student = (s: PendingSubject) => (
    <>
      {canOpenRecord && s.personId
        ? <Link to={`/students/${s.personId}`} className="text-primary-600 hover:underline">{s.studentName}</Link>
        : s.studentName}
      <div className="text-xs text-neutral-500">{[s.studentNumber, s.programmeCode].filter(Boolean).join(' · ')}</div>
    </>
  );
  const proposed = (by: string, at: string) => (
    <span className="text-xs">{by}<div>{new Date(at).toLocaleDateString('en-GB')}</div></span>
  );

  return (
    <div>
      <PageHeader
        title="Credit & exception approvals"
        description="Recognised credit and rule exceptions proposed for students, awaiting a decision. Once approved they change the rules applied at registration, module selection and progression."
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      {actionError && <p className="mb-4 text-sm text-danger-600" role="alert">{actionError}</p>}

      {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
        : !pending ? <div className="flex justify-center py-16"><Spinner /></div>
          : (
            <div className="mt-6 flex flex-col gap-6">
              <Card>
                <CardHeader title={`Recognised credit (${pending.credits.length})`} />
                {pending.credits.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">No recognised credit awaits a decision.</p> : (
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Recognition</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>
                        <TableHeaderCell>Credits</TableHeaderCell><TableHeaderCell>Proposed</TableHeaderCell><TableHeaderCell><span className="sr-only">Decide</span></TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {pending.credits.map((c) => (
                        <TableRow key={c.recognisedCreditId}>
                          <TableCell>{student(c.subject)}</TableCell>
                          <TableCell>{c.recognitionTypeCode}{c.fheqLevel ? <div className="text-xs text-neutral-500">Level {c.fheqLevel}</div> : null}</TableCell>
                          <TableCell className="text-sm">{c.sourceDescription}{c.evidenceRef ? <div className="text-xs text-neutral-500">{c.evidenceRef}</div> : null}</TableCell>
                          <TableCell>{c.creditValue}{c.academicYear ? <div className="text-xs text-neutral-500">{c.academicYear}</div> : null}</TableCell>
                          <TableCell>{proposed(c.createdBy, c.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <DecideControl
                              subject={`credit ${c.sourceDescription} for ${c.subject.studentName}`}
                              ownProposal={c.createdBy === user?.sub}
                              onDecide={(code, reason) => act(() => decideRecognisedCredit(c.recognisedCreditId, code, reason))}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>

              {canApproveBindings && (
                <Card>
                  <CardHeader title={`Rule-set changes (${bindingChanges.length})`} />
                  {bindingChanges.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">No rule-set change awaits a decision.</p> : (
                    <Table>
                      <TableHead>
                        <tr><TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Change</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>Proposed</TableHeaderCell><TableHeaderCell><span className="sr-only">Decide</span></TableHeaderCell></tr>
                      </TableHead>
                      <TableBody>
                        {bindingChanges.map((c) => (
                          <TableRow key={c.curriculumBindingChangeId}>
                            <TableCell>{c.subject ? student(c.subject) : c.enrolmentId}</TableCell>
                            <TableCell className="text-sm">{c.changeReasonCode}<div className="text-xs text-neutral-500">{c.reason}</div></TableCell>
                            <TableCell className="text-sm">{c.effectiveDate}</TableCell>
                            <TableCell>{proposed(c.proposedBy, c.proposedAt)}</TableCell>
                            <TableCell className="text-right">
                              <DecideControl
                                subject={`rule-set change for ${c.subject?.studentName ?? c.enrolmentId}`}
                                ownProposal={c.proposedBy === user?.sub}
                                onDecide={(code, reason) => act(() => decideBindingChange(c.curriculumBindingChangeId, code, reason))}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              )}

              <Card>
                <CardHeader title={`Rule exceptions (${pending.exceptions.length})`} />
                {pending.exceptions.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">No rule exception awaits a decision.</p> : (
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Rule</TableHeaderCell><TableHeaderCell>Exception</TableHeaderCell>
                        <TableHeaderCell>In force</TableHeaderCell><TableHeaderCell>Proposed</TableHeaderCell><TableHeaderCell><span className="sr-only">Decide</span></TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {pending.exceptions.map((x) => (
                        <TableRow key={x.ruleExceptionId}>
                          <TableCell>{student(x.subject)}</TableCell>
                          <TableCell>{ruleLabel(x.ruleCode)}<div className="text-xs text-neutral-500">{x.description}</div></TableCell>
                          <TableCell className="text-sm">
                            {x.exceptionTypeCode === 'variation' && x.variationValue
                              ? `Variation: ${Object.entries(x.variationValue).map(([k, v]) => `${k} ${v ?? 'none'}`).join(', ')}`
                              : 'Waiver'}
                            {x.authorityRef && <div className="text-xs text-neutral-500">{x.authorityRef}</div>}
                          </TableCell>
                          <TableCell className="text-sm">{x.validFrom} – {x.validTo ?? 'open'}</TableCell>
                          <TableCell>{proposed(x.createdBy, x.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <DecideControl
                              subject={`exception to ${ruleLabel(x.ruleCode)} for ${x.subject.studentName}`}
                              ownProposal={x.createdBy === user?.sub}
                              onDecide={(code, reason) => act(() => decideRuleException(x.ruleExceptionId, code, reason))}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>
          )}
    </div>
  );
}
