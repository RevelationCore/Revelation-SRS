import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Card, CardHeader, CardBody, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type FeeStatusReassessment, type FinancialRegistration, type RightToStudyWorkItem,
  financialRegistrationWorklist, listFeeStatusReassessments, rightToStudyWorklist,
} from '../api/registrationChecks.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

import { FINANCIAL_STATUS_LABELS, FeeStatusDecision } from './FinancialRegistrationSection.js';

const REASON_LABELS: Record<RightToStudyWorkItem['reason'], string> = {
  'share-code-submitted': 'Student shared a code', referred: 'Referred for a decision', 'recheck-required': 'Recheck needed after a visa change',
  expiring: 'Permission expiring soon', expired: 'Permission expired',
};

/**
 * The checks around registration (Phase 3 D-17, D-18): right-to-study checks
 * to complete or decide, years not financially arranged or on hold, and
 * fee-status reassessments to decide.
 */
export function RegistrationChecksPage() {
  const { roles } = useAuth();
  const canRts = userHasAnyPermission(roles, ['right-to-study:read']);
  const canFin = userHasAnyPermission(roles, ['financial-registration:read']);
  const canDecideFees = userHasAnyPermission(roles, ['fee-status:decide']);
  const [rts, setRts] = useState<RightToStudyWorkItem[] | null>(null);
  const [fin, setFin] = useState<FinancialRegistration[] | null>(null);
  const [fees, setFees] = useState<FeeStatusReassessment[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [a, b, c] = await Promise.all([
        canRts ? rightToStudyWorklist() : Promise.resolve([]),
        canFin ? financialRegistrationWorklist() : Promise.resolve([]),
        canDecideFees ? listFeeStatusReassessments({ open: true }) : Promise.resolve([]),
      ]);
      setRts(a); setFin(b); setFees(c);
    } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load'); }
  }, [canRts, canFin, canDecideFees]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader breadcrumbs={[{ label: 'Registration', to: '/registration' }]} title="Registration checks" description="Right to study, financial registration and fee status: the checks that sit alongside registration." />
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      <div className="flex flex-col gap-6">
        {canRts && (
          <Card>
            <CardHeader title="Right to study" description="Checks to complete or decide, and permissions expiring within the warning period. Open the student record to act." />
            {!rts ? <div className="p-6"><Spinner /></div> : rts.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">Nothing needs attention.</p> : (
              <Table>
                <TableHead><tr><TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Why</TableHeaderCell><TableHeaderCell>Expires</TableHeaderCell></tr></TableHead>
                <TableBody>
                  {rts.map((w) => (
                    <TableRow key={w.check.checkId}>
                      <TableCell><Link to={`/students/${w.check.personId}`} className="text-primary-600 hover:underline">Open student record<span className="sr-only"> for {w.check.personId}</span></Link></TableCell>
                      <TableCell><Badge value={w.reason === 'expired' ? 'rejected' : 'pending'} label={REASON_LABELS[w.reason]} /></TableCell>
                      <TableCell>{w.check.permissionExpiresOn ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}
        {canDecideFees && fees.length > 0 && (
          <Card>
            <CardHeader title="Fee-status reassessments to decide" />
            <CardBody>
              <ul className="flex flex-col gap-4">
                {fees.map((r) => (
                  <li key={r.caseId} className="rounded-md border border-neutral-200 p-3 text-sm">
                    <p className="font-medium">{r.subject?.studentName ?? r.enrolmentId}: {r.currentFeeStatusCode ?? 'not recorded'} → {r.proposedFeeStatusCode}</p>
                    <p className="mb-2 text-neutral-700">{r.reason} (proposed by {r.proposedBy})</p>
                    <FeeStatusDecision item={r} onDone={() => void load()} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {canFin && (
          <Card>
            <CardHeader title="Financial registration" description="Years not yet arranged or on hold. A hold does not block academic registration unless the institution has chosen to block on a tuition hold." />
            {!fin ? <div className="p-6"><Spinner /></div> : fin.length === 0 ? <p className="px-6 pb-6 text-sm text-neutral-600">Every year is arranged.</p> : (
              <Table>
                <TableHead><tr><TableHeaderCell>Student</TableHeaderCell><TableHeaderCell>Year</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></tr></TableHead>
                <TableBody>
                  {fin.map((f) => (
                    <TableRow key={f.liabilityId}>
                      <TableCell><Link to={`/students/${f.personId}`} className="text-primary-600 hover:underline">{f.subject?.studentName ?? f.personId}</Link><div className="text-xs text-neutral-500">{f.subject?.studentNumber}</div></TableCell>
                      <TableCell>{f.academicYear}</TableCell>
                      <TableCell><Badge value={f.financialStatusCode === 'hold' ? 'rejected' : 'pending'} label={FINANCIAL_STATUS_LABELS[f.financialStatusCode]} />{f.holdReasonCode && <span className="ml-2 text-xs text-neutral-500">{f.holdReasonCode}</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
