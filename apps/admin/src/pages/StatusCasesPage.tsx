import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, Button, Select, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel, useCodes, CodeSelect,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type StatusCase, listOpenStatusCases } from '../api/statusCases.js';

/**
 * Status cases awaiting a decision (BP-02-006 to 009, 012): interruptions,
 * suspensions, returns, withdrawals, transfers and leaver closures. Each row
 * names its student, so assessors without student-record access can act.
 */
export function StatusCasesPage() {
  const caseTypes = useCodes('student_status_case', 'case_type_code');
  const assessorRoles = useCodes('status_case_assessment', 'assessor_role_code');
  const assessmentOutcomes = useCodes('status_case_assessment', 'outcome_code');
  const [cases, setCases] = useState<StatusCase[] | null>(null);
  const [type, setType] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setCases(await listOpenStatusCases()); } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load status cases'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = (cases ?? []).filter((c) => !type || c.caseTypeCode === type);

  return (
    <div>
      <PageHeader
        title="Status cases"
        description="Requests to interrupt, return, withdraw or transfer, required suspensions and leaver closures, awaiting advice and a decision. The enrolment changes only when a case is approved."
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="status-case-type" className="text-sm text-neutral-500">Type:</label>
            <CodeSelect entity="student_status_case" field="case_type_code" id="status-case-type" value={type} onChange={setType} className="w-auto" emptyLabel="All types" />
            <Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />
      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : cases === null ? <div className="flex justify-center py-16"><Spinner /></div>
            : shown.length === 0 ? <p className="text-sm text-neutral-600">No status cases await a decision.</p>
              : (
                <Card>
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Case</TableHeaderCell><TableHeaderCell>From</TableHeaderCell>
                        <TableHeaderCell>Requested by</TableHeaderCell><TableHeaderCell>Advice</TableHeaderCell><TableHeaderCell>Opened</TableHeaderCell>
                        <TableHeaderCell><span className="sr-only">Open</span></TableHeaderCell>
                      </tr>
                    </TableHead>
                    <TableBody>
                      {shown.map((c) => (
                        <TableRow key={c.statusCaseId}>
                          <TableCell>
                            {c.subject?.studentName ?? c.personId}
                            <div className="text-xs text-neutral-500">{[c.subject?.studentNumber, c.subject?.programmeCode].filter(Boolean).join(' · ')}</div>
                          </TableCell>
                          <TableCell><CodeLabel entity="student_status_case" field="case_type_code" code={c.caseTypeCode} /></TableCell>
                          <TableCell className="text-sm">{c.requestedEffectiveDate}</TableCell>
                          <TableCell className="text-sm"><CodeLabel entity="student_status_case" field="initiated_by_code" code={c.initiatedByCode} /></TableCell>
                          <TableCell className="text-sm">{c.assessments.length === 0 ? 'None yet' : c.assessments.map((a) => `${assessorRoles.label(a.assessorRoleCode)}: ${assessmentOutcomes.label(a.outcomeCode)}`).join(', ')}</TableCell>
                          <TableCell className="text-xs text-neutral-600">{new Date(c.createdAt).toLocaleDateString('en-GB')}</TableCell>
                          <TableCell className="text-right">
                            <Link to={`/status-cases/${c.statusCaseId}`} className="text-sm text-primary-600 hover:underline">
                              View<span className="sr-only"> {caseTypes.label(c.caseTypeCode)} case for {c.subject?.studentName}</span>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
      </div>
    </div>
  );
}

export function CaseStatusBadge({ status }: { status: string }) {
  const caseStatuses = useCodes('student_status_case', 'status_code');
  return <Badge value={status === 'requested' ? 'pending' : status} label={status === 'requested' ? 'Awaiting decision' : caseStatuses.label(status)} />;
}
