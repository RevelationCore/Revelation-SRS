import { useCallback, useEffect, useState } from 'react';
import {
  type CasRequest,
  type ComplianceAlert,
  type SponsorDecision,
  type UkviOperationalStatus,
  type UkviCasSubmissionRequest,
  authoriseSponsorDecision,
  evaluateComplianceAlerts,
  listCasRequests,
  listComplianceAlerts,
  listSponsorDecisions,
  resolveComplianceAlert,
  getUkviOperationalStatus,
  requestUkviCasSubmission,
  listUkviCasSubmissionRequests,
  decideUkviCasSubmissionRequest,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, StatCard,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

type Tab = 'cas' | 'compliance' | 'decisions';

export function UkviPage() {
  const [tab, setTab] = useState<Tab>('cas');

  return (
    <div>
      <PageHeader title="UKVI" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="cas">CAS requests</TabsTrigger>
          <TabsTrigger value="compliance">Compliance alerts</TabsTrigger>
          <TabsTrigger value="decisions">Sponsor decisions</TabsTrigger>
        </TabsList>
        <TabsContent value="cas"><CasTab /></TabsContent>
        <TabsContent value="compliance"><ComplianceTab /></TabsContent>
        <TabsContent value="decisions"><SponsorDecisionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function SponsorDecisionsTab() {
  const [decisions, setDecisions] = useState<SponsorDecision[]>([]);
  const [status, setStatus] = useState<UkviOperationalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorising, setAuthorising] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextDecisions, nextStatus] = await Promise.all([
        listSponsorDecisions(),
        getUkviOperationalStatus(),
      ]);
      setDecisions(nextDecisions);
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load sponsor decisions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleAuthorise(decisionId: string) {
    setAuthorising(decisionId);
    setError('');
    try {
      await authoriseSponsorDecision(decisionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Authorisation failed');
    } finally {
      setAuthorising(null);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div>
      <div className="rounded border border-primary-200 bg-primary-50 p-4 mb-5 text-sm text-primary-900">
        Engagement evidence supports a human sponsor decision. It never automatically changes academic
        status or submits a UKVI report. A different authorised officer must approve each decision.
      </div>
      {status && (
        <div className="grid gap-3 sm:grid-cols-3 mb-5">
          <StatCard label="Pending authorisation" value={status.pendingAuthorisation} />
          <StatCard label="Evidence reconciliation" value={status.reconciliationRequired} />
          <StatCard label="Failed/dead-letter exchanges" value={status.failedExchanges} />
        </div>
      )}
      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      {decisions.length === 0 ? (
        <p className="text-sm text-neutral-600">No sponsor decisions have been recorded.</p>
      ) : (
        <div className="space-y-3">
          {decisions.map(decision => (
            <Card key={decision.decisionId}>
              <CardBody className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge value={decision.outcomeCode} />
                    <Badge value={decision.statusCode} />
                  </div>
                  <p className="mt-2 text-sm text-neutral-700">{decision.rationaleCode}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Guidance: {decision.guidanceVersion} · Decision maker: {decision.decidedBy}
                  </p>
                  {decision.externalReportId && (
                    <p className="mt-1 font-mono text-xs text-success-700">
                      Outbound report: {decision.externalReportId}
                    </p>
                  )}
                </div>
                {decision.statusCode === 'pending-authorisation' && (
                  <Button
                    onClick={() => void handleAuthorise(decision.decisionId)}
                    disabled={authorising === decision.decisionId}
                  >
                    {authorising === decision.decisionId ? 'Authorising…' : 'Authorise decision'}
                  </Button>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CasTab() {
  const { roles } = useAuth();
  const canDecide = userHasAnyPermission(roles, ['regulatory:decide']);
  const [requests,   setRequests]   = useState<CasRequest[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [requesting, setRequesting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(await listCasRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load CAS requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleRequestSubmission() {
    setRequesting(true);
    setError('');
    setSuccessMsg('');
    try {
      await requestUkviCasSubmission();
      setSuccessMsg('Approval requested to submit pending CAS requests.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to request CAS submission');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-neutral-600">Confirmation of Acceptance for Studies (CAS) requests for international students.</p>
        <Button onClick={() => void handleRequestSubmission()} disabled={requesting}>
          {requesting ? 'Requesting…' : 'Request approval to submit'}
        </Button>
      </div>

      {error      && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-success-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-neutral-600">No CAS requests found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Enrolment</TableHeaderCell>
                <TableHeaderCell>CAS reference</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Requested</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.casRequestId}>
                  <TableCell className="font-mono text-xs text-neutral-700">{r.enrolmentId}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.casReference ?? <span className="text-neutral-600">pending</span>}
                  </TableCell>
                  <TableCell><Badge value={r.statusCode} /></TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.requestedAt).toLocaleDateString('en-GB')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canDecide && (
        <div className="mt-8">
          <UkviCasSubmissionRequestsQueue onDecided={load} />
        </div>
      )}
    </div>
  );
}

function UkviCasSubmissionRequestsQueue({ onDecided }: { onDecided: () => void }) {
  const [requests, setRequests] = useState<UkviCasSubmissionRequest[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setRequests(await listUkviCasSubmissionRequests());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load submission requests');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecide(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    setBusyId(workflowInstanceId); setError('');
    try {
      await decideUkviCasSubmissionRequest(workflowInstanceId, decisionCode, reasonById[workflowInstanceId]?.trim() || undefined);
      setDeciding(null);
      await load();
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to record decision');
    } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader
        title="Pending CAS submission requests"
        actions={<Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>}
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-neutral-600">No pending submission requests.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>CAS requests</TableHeaderCell>
                <TableHeaderCell>Requested</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.workflowInstanceId}>
                  <TableCell className="text-xs">{r.recordCount}</TableCell>
                  <TableCell className="text-neutral-500">
                    {new Date(r.startedAt).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="text-right">
                    {deciding === r.workflowInstanceId ? (
                      <div className="inline-flex flex-col items-end gap-2">
                        <input
                          type="text"
                          placeholder="Reason (optional)"
                          className="rounded border border-neutral-300 px-2 py-1 text-xs w-56"
                          value={reasonById[r.workflowInstanceId] ?? ''}
                          onChange={(e) => setReasonById(v => ({ ...v, [r.workflowInstanceId]: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busyId === r.workflowInstanceId}
                            className="bg-success-600 hover:bg-success-700"
                            onClick={() => void handleDecide(r.workflowInstanceId, 'approved')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="border-danger-300 text-danger-700 hover:bg-danger-50"
                            disabled={busyId === r.workflowInstanceId}
                            onClick={() => void handleDecide(r.workflowInstanceId, 'rejected')}
                          >
                            Reject
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDeciding(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" onClick={() => setDeciding(r.workflowInstanceId)}>
                        Decide
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function ComplianceTab() {
  const [alerts,     setAlerts]     = useState<ComplianceAlert[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAlerts(await listComplianceAlerts());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load compliance alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleEvaluate() {
    setEvaluating(true);
    setError('');
    setSuccessMsg('');
    try {
      await evaluateComplianceAlerts();
      setSuccessMsg('Compliance evaluation complete.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }

  async function handleResolve(alertId: string) {
    setResolvingId(alertId);
    setError('');
    try {
      await resolveComplianceAlert(alertId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Resolve failed');
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-neutral-600">Attendance and compliance alerts for Tier 4 / Student visa holders.</p>
        <Button variant="secondary" onClick={() => void handleEvaluate()} disabled={evaluating}>
          {evaluating ? 'Evaluating…' : 'Re-evaluate alerts'}
        </Button>
      </div>

      {error      && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-success-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-neutral-600">No compliance alerts.</p>
      ) : (
        <div className="space-y-3">
          {alerts.map(a => (
            <Card key={a.alertId} className={a.resolvedAt ? '' : 'border-warning-300'}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-neutral-900 capitalize">{a.alertTypeCode}</p>
                  <p className="text-xs text-neutral-500 font-mono mt-0.5">{a.enrolmentId}</p>
                  {a.casReference && (
                    <p className="text-xs text-neutral-500 mt-0.5">CAS: {a.casReference}</p>
                  )}
                </div>
                <div className="text-right text-xs text-neutral-500">
                  <p>Triggered: {new Date(a.triggeredAt).toLocaleDateString('en-GB')}</p>
                  {a.resolvedAt && <p className="text-success-600">Resolved: {new Date(a.resolvedAt).toLocaleDateString('en-GB')}</p>}
                </div>
              </div>
              {!a.resolvedAt && (
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-success-300 text-success-700 hover:bg-success-50"
                    onClick={() => void handleResolve(a.alertId)}
                    disabled={resolvingId === a.alertId}
                  >
                    {resolvingId === a.alertId ? 'Resolving…' : 'Mark resolved'}
                  </Button>
                </div>
              )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
