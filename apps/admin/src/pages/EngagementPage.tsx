import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  createEngagementPolicy, listEngagementAlerts, listEngagementEvents, listEngagementPolicies,
  triageAlert, type EngagementAlert, type EngagementEvent, type EngagementPolicy,
} from '../api/engagement.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  LabelledField, Input, Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

type Tab = 'events' | 'alerts' | 'policies';

export function EngagementPage() {
  const { roles } = useAuth();
  const canReadEvents = userHasAnyPermission(roles, ['engagement:event:read']);
  const canReadAlerts = userHasAnyPermission(roles, ['engagement:alert:read']);
  const canReadPolicies = userHasAnyPermission(roles, ['engagement:policy:read']);
  const [tab, setTab] = useState<Tab>(canReadAlerts ? 'alerts' : canReadEvents ? 'events' : 'policies');
  const [events, setEvents] = useState<EngagementEvent[]>([]);
  const [alerts, setAlerts] = useState<EngagementAlert[]>([]);
  const [policies, setPolicies] = useState<EngagementPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canManagePolicy = userHasAnyPermission(roles, ['engagement:policy:manage']);
  const canManageCases = userHasAnyPermission(roles, ['engagement:case:manage']);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [eventRows, alertRows, policyRows] = await Promise.all([
        canReadEvents ? listEngagementEvents() : Promise.resolve([]),
        canReadAlerts ? listEngagementAlerts() : Promise.resolve([]),
        canReadPolicies ? listEngagementPolicies() : Promise.resolve([]),
      ]);
      setEvents(eventRows); setAlerts(alertRows); setPolicies(policyRows);
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Unable to load engagement workspace');
    } finally { setLoading(false); }
  }, [canReadAlerts, canReadEvents, canReadPolicies]);
  useEffect(() => { void load(); }, [load]);

  async function openCase(alert: EngagementAlert) {
    setError('');
    try {
      const result = await triageAlert(alert.alertId, {
        decision: 'open-intervention', assignedRoleCode: 'engagement-officer',
        dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), reasonCode: 'human-triage',
      });
      if (result.interventionCaseId) window.location.assign(`/engagement/cases/${result.interventionCaseId}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Unable to open intervention');
    }
  }

  return (
    <section aria-labelledby="engagement-heading">
      <PageHeader
        title={<span id="engagement-heading">Academic engagement</span>}
        description="Evidence supports human review; it never determines academic status or sponsor reporting."
        actions={<Button variant="secondary" onClick={() => void load()}>Refresh</Button>}
      />
      {error && <div role="alert" className="mb-4 rounded border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">{error}</div>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Engagement workspace" className="mb-5">
          {canReadAlerts && <TabsTrigger value="alerts">Alert queue ({alerts.length})</TabsTrigger>}
          {canReadEvents && <TabsTrigger value="events">Evidence worklist ({events.length})</TabsTrigger>}
          {canReadPolicies && <TabsTrigger value="policies">Policies ({policies.length})</TabsTrigger>}
        </TabsList>
        {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
          <>
            <TabsContent value="alerts"><AlertQueue alerts={alerts} canManage={canManageCases} onOpen={openCase} /></TabsContent>
            <TabsContent value="events"><EventWorklist events={events} /></TabsContent>
            <TabsContent value="policies"><PolicyPanel policies={policies} canManage={canManagePolicy} onCreated={load} /></TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}

function AlertQueue({ alerts, canManage, onOpen }: {
  alerts: EngagementAlert[]; canManage: boolean; onOpen: (alert: EngagementAlert) => Promise<void>;
}) {
  if (!alerts.length) return <Empty text="No engagement alerts require review." />;
  return <div className="space-y-3">{alerts.map((alert) => {
    const unsafe = alert.statusCode === 'suspended-reconciliation' || alert.reevaluationRequired;
    return <Card key={alert.alertId}><CardBody>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge value={alert.statusCode} /><Badge value={alert.severityCode} /></div>
          <p className="mt-2 text-sm font-medium text-neutral-900">Student {alert.personId.slice(0, 8)}</p>
          <p className="text-xs text-neutral-500">Policy {alert.explanation.policyCode} v{alert.explanation.policyVersion}</p>
        </div>
        {canManage && alert.statusCode === 'open' && <Button onClick={() => void onOpen(alert)}>Open intervention</Button>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Expected" value={alert.evidenceSnapshot.expectedEventCount} />
        <Metric label="Absences" value={alert.evidenceSnapshot.absenceCount} />
        <Metric label="Absence rate" value={alert.evidenceSnapshot.absenceRate === undefined ? '—' : `${Math.round(alert.evidenceSnapshot.absenceRate * 100)}%`} />
        <Metric label="Unsafe evidence" value={alert.evidenceSnapshot.unsafeEvidenceCount} />
      </dl>
      {unsafe && <p className="mt-3 rounded bg-warning-50 p-2 text-sm text-warning-800">Evidence needs reconciliation. Intervention escalation is suspended.</p>}
    </CardBody></Card>;
  })}</div>;
}

function EventWorklist({ events }: { events: EngagementEvent[] }) {
  if (!events.length) return <Empty text="No expected engagement events found." />;
  return <Card>
    <Table>
      <TableHead><tr>
        <TableHeaderCell>Scheduled</TableHeaderCell><TableHeaderCell>Student</TableHeaderCell>
        <TableHeaderCell>Activity</TableHeaderCell><TableHeaderCell>Mode</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>
      </tr></TableHead>
      <TableBody>{events.map((event) => <TableRow key={event.expectedEventId}>
        <TableCell>{new Date(event.scheduledFrom).toLocaleString('en-GB')}</TableCell>
        <TableCell><Link className="text-primary-600" to={`/students/${event.personId}`}>{event.personId.slice(0, 8)}</Link></TableCell>
        <TableCell>{event.activityReference ?? event.activityTypeCode}</TableCell>
        <TableCell>{event.eventModeCode}</TableCell><TableCell>{event.sourceSystemCode}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </Card>;
}

function PolicyPanel({ policies, canManage, onCreated }: {
  policies: EngagementPolicy[]; canManage: boolean; onCreated: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await createEngagementPolicy({
      policyCode: String(data.get('policyCode')), displayName: String(data.get('displayName')),
      versionNumber: Number(data.get('versionNumber')), statusCode: 'approved',
      validFrom: new Date(String(data.get('validFrom'))).toISOString(), evidenceWindowDays: 14,
      minimumExpectedEvents: 3, minimumAbsenceCount: 2, minimumAbsenceRate: 0.5,
      severityCode: 'medium', reviewDeadlineDays: 5,
    });
    setShowForm(false); await onCreated();
  }
  return <div>
    {canManage && <Button onClick={() => setShowForm(!showForm)} className="mb-4">New policy version</Button>}
    {showForm && (
      <Card className="mb-5">
        <CardBody>
          <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-2">
            <LabelledField label="Policy code" htmlFor="ep-code" required><Input id="ep-code" required name="policyCode" /></LabelledField>
            <LabelledField label="Display name" htmlFor="ep-name" required><Input id="ep-name" required name="displayName" /></LabelledField>
            <LabelledField label="Version" htmlFor="ep-version" required><Input id="ep-version" required name="versionNumber" type="number" min="1" defaultValue="1" /></LabelledField>
            <LabelledField label="Effective from" htmlFor="ep-from" required><Input id="ep-from" required name="validFrom" type="date" /></LabelledField>
            <Button type="submit" className="sm:col-span-2">Create approved version</Button>
          </form>
        </CardBody>
      </Card>
    )}
    <div className="space-y-2">{policies.map((policy) => (
      <Card key={policy.policyVersionId}><CardBody>
        <div className="flex justify-between"><strong>{policy.displayName}</strong><Badge value={policy.statusCode} /></div>
        <p className="mt-1 text-sm text-neutral-600">{policy.policyCode} · version {policy.versionNumber} · from {new Date(policy.validFrom).toLocaleDateString('en-GB')}</p>
      </CardBody></Card>
    ))}</div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number | undefined }) {
  return <div><dt className="text-xs text-neutral-500">{label}</dt><dd className="font-semibold text-neutral-900">{value ?? '—'}</dd></div>;
}
function Empty({ text }: { text: string }) { return <p className="rounded border border-dashed bg-white py-12 text-center text-sm text-neutral-500">{text}</p>; }
