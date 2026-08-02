import { useCallback, useEffect, useState } from 'react';
import {
  type CasRequest,
  type ComplianceAlert,
  type SponsorDecision,
  type UkviOperationalStatus,
  authoriseSponsorDecision,
  evaluateComplianceAlerts,
  generateCasRequests,
  listCasRequests,
  listComplianceAlerts,
  listSponsorDecisions,
  resolveComplianceAlert,
  getUkviOperationalStatus,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, StatCard,
} from '@revelation-srs/ui';

type Tab = 'cas' | 'compliance' | 'decisions';

export function UkviPage() {
  const [tab, setTab] = useState<Tab>('cas');

  return (
    <div>
      <PageHeader title="UKVI" />

      <div className="flex gap-1 mb-6 border-b border-neutral-200">
        {(['cas', 'compliance', 'decisions'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t === 'cas' ? 'CAS requests' : t === 'compliance' ? 'Compliance alerts' : 'Sponsor decisions'}
          </button>
        ))}
      </div>

      {tab === 'cas'        && <CasTab />}
      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'decisions'  && <SponsorDecisionsTab />}
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
  const [requests,   setRequests]   = useState<CasRequest[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [generating, setGenerating] = useState(false);
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

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    setSuccessMsg('');
    try {
      const result = await generateCasRequests();
      setSuccessMsg(`Generated ${result.processedCount} CAS request(s).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate CAS requests');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-neutral-600">Confirmation of Acceptance for Studies (CAS) requests for international students.</p>
        <Button onClick={() => void handleGenerate()} disabled={generating}>
          {generating ? 'Generating…' : 'Generate CAS requests'}
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
    </div>
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
