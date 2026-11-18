import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type ComplianceAlert,
  type SponsorDecision,
  type UkviOperationalStatus,
  authoriseSponsorDecision,
  evaluateComplianceAlerts,
  listComplianceAlerts,
  listSponsorDecisions,
  resolveComplianceAlert,
  getUkviOperationalStatus,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { type CasCase, exportCasForSms, listCasCaseWorklist } from '../api/casCases.js';
import { CasCasePanel } from '../components/CasCasePanel.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardHeader, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, StatCard, Tabs, TabsList, TabsTrigger, TabsContent, CodeBadge, CodeLabel,
} from '@revelation-srs/ui';

type Tab = 'cas' | 'compliance' | 'decisions';

export function UkviPage() {
  const [tab, setTab] = useState<Tab>('cas');

  return (
    <div>
      <PageHeader title="UKVI" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="cas">CAS</TabsTrigger>
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
                    <CodeBadge entity="ukvi_sponsor_decision" field="outcome_code" code={decision.outcomeCode} />
                    <CodeBadge entity="ukvi_sponsor_decision" field="status_code" code={decision.statusCode} />
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
  const canPrepare = userHasAnyPermission(roles, ['cas:prepare']);
  const [cases, setCases] = useState<CasCase[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [exported, setExported] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setCases(await listCasCaseWorklist(showAll ? {} : { open: true })); } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed to load CAS cases'); }
  }, [showAll]);
  useEffect(() => { void load(); }, [load]);

  async function handleExport() {
    setError(''); setExported('');
    try {
      const file = await exportCasForSms();
      if (file.processedCount > 0) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = `cas-sms-export-${file.generatedAt.slice(0, 10)}.json`; a.click();
        URL.revokeObjectURL(url);
      }
      setExported(file.processedCount === 0 ? 'Nothing approved is waiting to be sent.' : `${file.processedCount} CAS request(s) exported for SMS. Upload the file to SMS, then record each CAS number.`);
      await load();
    } catch (e) { setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Export failed'); }
  }

  return (
    <Card>
      <CardHeader
        title="CAS cases"
        description="Each CAS is prepared, approved by someone else, sent to SMS in an export file, and its CAS number recorded here. Open a case from the applicant's application page."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Open cases only' : 'Include assigned and withdrawn'}</Button>
            {canPrepare && <Button size="sm" onClick={() => void handleExport()}>Export approved for SMS</Button>}
          </div>
        }
      />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}
        {exported && <p className="mb-3 text-sm text-success-700" role="status">{exported}</p>}
        {!cases ? <div className="flex justify-center py-8"><Spinner /></div>
          : cases.length === 0 ? <p className="text-sm text-neutral-600">No CAS cases.</p> : (
            <ul className="flex flex-col gap-4">
              {cases.map((c) => (
                <li key={c.casCaseId} className="rounded-md border border-neutral-200 p-4">
                  <p className="mb-2 font-medium text-neutral-900">
                    <Link to={`/students/${c.personId}`} className="text-primary-600 hover:underline">{c.subject.studentName ?? c.personId}</Link>
                    {c.subject.programmeCode ? <span className="ml-2 text-sm font-normal text-neutral-600">{c.subject.programmeCode}</span> : null}
                    {c.applicationId ? <Link to={`/applications/${c.applicationId}`} className="ml-2 text-sm font-normal text-primary-600 hover:underline">application</Link> : null}
                  </p>
                  <CasCasePanel item={c} onChanged={() => void load()} />
                </li>
              ))}
            </ul>
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
                  <p className="text-sm font-medium text-neutral-900"><CodeLabel entity="ukvi_compliance_alert" field="alert_type_code" code={a.alertTypeCode} /></p>
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
