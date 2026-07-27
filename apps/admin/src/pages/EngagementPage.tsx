import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  createEngagementPolicy, listEngagementAlerts, listEngagementEvents, listEngagementPolicies,
  triageAlert, type EngagementAlert, type EngagementEvent, type EngagementPolicy,
} from '../api/engagement.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

type Tab = 'events' | 'alerts' | 'policies';

export function EngagementPage() {
  const { roles } = useAuth();
  const canReadEvidence = roles.some((role) =>
    ['module-tutor', 'personal-tutor', 'engagement-officer', 'registry-administrator'].includes(role));
  const [tab, setTab] = useState<Tab>(canReadEvidence ? 'alerts' : 'policies');
  const [events, setEvents] = useState<EngagementEvent[]>([]);
  const [alerts, setAlerts] = useState<EngagementAlert[]>([]);
  const [policies, setPolicies] = useState<EngagementPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canManagePolicy = roles.includes('tenant-administrator');
  const canManageCases = roles.some((role) => ['engagement-officer', 'registry-administrator'].includes(role));

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [eventRows, alertRows, policyRows] = await Promise.all([
        canReadEvidence ? listEngagementEvents() : Promise.resolve([]),
        canReadEvidence ? listEngagementAlerts() : Promise.resolve([]),
        roles.some((role) => ['engagement-officer', 'registry-administrator', 'tenant-administrator'].includes(role))
          ? listEngagementPolicies() : Promise.resolve([]),
      ]);
      setEvents(eventRows); setAlerts(alertRows); setPolicies(policyRows);
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.detail ?? cause.message) : 'Unable to load engagement workspace');
    } finally { setLoading(false); }
  }, [canReadEvidence, roles]);
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
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 id="engagement-heading" className="text-xl font-semibold text-gray-900">Academic engagement</h1>
          <p className="mt-1 text-sm text-gray-600">Evidence supports human review; it never determines academic status or sponsor reporting.</p>
        </div>
        <button onClick={() => void load()} className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-white">Refresh</button>
      </div>
      <div className="mb-5 flex gap-1 border-b border-gray-200" role="tablist" aria-label="Engagement workspace">
        {canReadEvidence && <TabButton active={tab === 'alerts'} onClick={() => setTab('alerts')}>Alert queue ({alerts.length})</TabButton>}
        {canReadEvidence && <TabButton active={tab === 'events'} onClick={() => setTab('events')}>Evidence worklist ({events.length})</TabButton>}
        <TabButton active={tab === 'policies'} onClick={() => setTab('policies')}>Policies ({policies.length})</TabButton>
      </div>
      {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <>
          {tab === 'alerts' && <AlertQueue alerts={alerts} canManage={canManageCases} onOpen={openCase} />}
          {tab === 'events' && <EventWorklist events={events} />}
          {tab === 'policies' && <PolicyPanel policies={policies} canManage={canManagePolicy} onCreated={load} />}
        </>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button role="tab" aria-selected={active} onClick={onClick}
    className={`px-4 py-2 text-sm font-medium ${active ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-gray-500 hover:text-gray-800'}`}>{children}</button>;
}

function AlertQueue({ alerts, canManage, onOpen }: {
  alerts: EngagementAlert[]; canManage: boolean; onOpen: (alert: EngagementAlert) => Promise<void>;
}) {
  if (!alerts.length) return <Empty text="No engagement alerts require review." />;
  return <div className="space-y-3">{alerts.map((alert) => {
    const unsafe = alert.statusCode === 'suspended-reconciliation' || alert.reevaluationRequired;
    return <article key={alert.alertId} className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge value={alert.statusCode} /><Badge value={alert.severityCode} /></div>
          <p className="mt-2 text-sm font-medium text-gray-900">Student {alert.personId.slice(0, 8)}</p>
          <p className="text-xs text-gray-500">Policy {alert.explanation.policyCode} v{alert.explanation.policyVersion}</p>
        </div>
        {canManage && alert.statusCode === 'open' && <button onClick={() => void onOpen(alert)}
          className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Open intervention</button>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Expected" value={alert.evidenceSnapshot.expectedEventCount} />
        <Metric label="Absences" value={alert.evidenceSnapshot.absenceCount} />
        <Metric label="Absence rate" value={alert.evidenceSnapshot.absenceRate === undefined ? '—' : `${Math.round(alert.evidenceSnapshot.absenceRate * 100)}%`} />
        <Metric label="Unsafe evidence" value={alert.evidenceSnapshot.unsafeEvidenceCount} />
      </dl>
      {unsafe && <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">Evidence needs reconciliation. Intervention escalation is suspended.</p>}
    </article>;
  })}</div>;
}

function EventWorklist({ events }: { events: EngagementEvent[] }) {
  if (!events.length) return <Empty text="No expected engagement events found." />;
  return <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white"><table className="min-w-full text-sm">
    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr>
      <th className="px-4 py-3">Scheduled</th><th className="px-4 py-3">Student</th>
      <th className="px-4 py-3">Activity</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3">Source</th>
    </tr></thead><tbody className="divide-y divide-gray-100">{events.map((event) => <tr key={event.expectedEventId}>
      <td className="px-4 py-3">{new Date(event.scheduledFrom).toLocaleString('en-GB')}</td>
      <td className="px-4 py-3"><Link className="text-indigo-600" to={`/students/${event.personId}`}>{event.personId.slice(0, 8)}</Link></td>
      <td className="px-4 py-3">{event.activityReference ?? event.activityTypeCode}</td>
      <td className="px-4 py-3">{event.eventModeCode}</td><td className="px-4 py-3">{event.sourceSystemCode}</td>
    </tr>)}</tbody></table></div>;
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
    {canManage && <button onClick={() => setShowForm(!showForm)} className="mb-4 rounded bg-indigo-600 px-3 py-2 text-sm text-white">New policy version</button>}
    {showForm && <form onSubmit={(event) => void submit(event)} className="mb-5 grid gap-3 rounded border bg-white p-4 sm:grid-cols-2">
      <label className="text-sm">Policy code<input required name="policyCode" className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label className="text-sm">Display name<input required name="displayName" className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label className="text-sm">Version<input required name="versionNumber" type="number" min="1" defaultValue="1" className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label className="text-sm">Effective from<input required name="validFrom" type="date" className="mt-1 w-full rounded border px-3 py-2" /></label>
      <button className="rounded bg-indigo-600 px-3 py-2 text-sm text-white sm:col-span-2">Create approved version</button>
    </form>}
    <div className="space-y-2">{policies.map((policy) => <div key={policy.policyVersionId} className="rounded border bg-white p-4">
      <div className="flex justify-between"><strong>{policy.displayName}</strong><Badge value={policy.statusCode} /></div>
      <p className="mt-1 text-sm text-gray-600">{policy.policyCode} · version {policy.versionNumber} · from {new Date(policy.validFrom).toLocaleDateString('en-GB')}</p>
    </div>)}</div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number | undefined }) {
  return <div><dt className="text-xs text-gray-500">{label}</dt><dd className="font-semibold text-gray-900">{value ?? '—'}</dd></div>;
}
function Empty({ text }: { text: string }) { return <p className="rounded border border-dashed bg-white py-12 text-center text-sm text-gray-500">{text}</p>; }
