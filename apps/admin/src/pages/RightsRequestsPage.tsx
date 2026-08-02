import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';
import {
  type RightsRequestType,
  type RightsDecisionType,
  type DispositionType,
  type IndividualRightsRequest,
  type RetentionSchedule,
  type RetentionAssignment,
  openRequest,
  addScope,
  recordSearch,
  decide,
  applyRestriction,
  liftRestriction,
  createSchedule,
  assignSchedule,
  placeHold,
  recordDisposition,
  listRequests,
  listSchedules,
  listAssignments,
} from '../api/rightsRequests.js';
import { useAuth } from '../auth/AuthContext.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

const REQUEST_TYPES: RightsRequestType[] = ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection'];

// The write-only flows below (request lifecycle, restriction apply/lift,
// retention schedule → assignment → hold → disposition) each carry an ID
// forward within a session; the Browse tab gives a read-side view onto the
// same tables so staff can find prior/open work.
export function RightsRequestsPage() {
  return (
    <div>
      <PageHeader
        title="Individual rights requests"
        description="Process Subject Access and other Article 15-22 requests, apply processing restrictions, and manage retention schedules."
      />
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="requests">Rights requests</TabsTrigger>
          <TabsTrigger value="restrictions">Restrictions</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
        </TabsList>
        <TabsContent value="browse"><BrowsePanel /></TabsContent>
        <TabsContent value="requests"><RequestFlow /></TabsContent>
        <TabsContent value="restrictions"><RestrictionsPanel /></TabsContent>
        <TabsContent value="retention"><RetentionFlow /></TabsContent>
      </Tabs>
    </div>
  );
}

function RequestFlow() {
  const { user } = useAuth();
  const [personId, setPersonId]                         = useState('');
  const [requestTypeCode, setRequestTypeCode]           = useState<RightsRequestType>('access');
  const [statutoryDeadlineDate, setStatutoryDeadlineDate] = useState('');
  const [submitting, setSubmitting]                     = useState(false);
  const [requestId, setRequestId]                       = useState<string | null>(null);
  const [error, setError]                               = useState('');

  async function handleOpen(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { requestId: id } = await openRequest({
        personId: personId.trim(),
        requestTypeCode,
        statutoryDeadlineDate: statutoryDeadlineDate || new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
        ownerId: user?.sub ?? '',
      });
      setRequestId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open request');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-6 mt-4">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <Card>
        <CardHeader title="1. Open request" />
        <CardBody>
          {requestId ? (
            <p className="text-sm text-success-700">Request opened: <span className="font-mono text-xs">{requestId}</span></p>
          ) : (
            <form onSubmit={(e) => void handleOpen(e)} className="grid grid-cols-3 gap-3 items-end">
              <LabelledField label="Person ID" htmlFor="rr-person" required>
                <Input id="rr-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
              </LabelledField>
              <LabelledField label="Request type" htmlFor="rr-type">
                <Select id="rr-type" value={requestTypeCode} onChange={(e) => setRequestTypeCode(e.target.value as RightsRequestType)}>
                  {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </LabelledField>
              <LabelledField label="Statutory deadline" htmlFor="rr-deadline" hint="Defaults to +30 days">
                <Input id="rr-deadline" type="date" value={statutoryDeadlineDate} onChange={(e) => setStatutoryDeadlineDate(e.target.value)} />
              </LabelledField>
              <div className="col-span-3">
                <Button type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open request'}</Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
      {requestId && <ScopeStep requestId={requestId} onError={setError} />}
      {requestId && <SearchStep requestId={requestId} onError={setError} />}
      {requestId && <DecisionStep requestId={requestId} onError={setError} />}
    </div>
  );
}

function ScopeStep({ requestId, onError }: { requestId: string; onError: (msg: string) => void }) {
  const [scopeEntityType, setScopeEntityType]   = useState('');
  const [scopeDescription, setScopeDescription] = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [scopes, setScopes]                     = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { scopeId } = await addScope(requestId, {
        scopeEntityType: scopeEntityType.trim(),
        ...(scopeDescription.trim() ? { scopeDescription: scopeDescription.trim() } : {}),
      });
      setScopes(s => [...s, scopeId]);
      setScopeEntityType(''); setScopeDescription('');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add scope');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="2. Define scope" />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Entity type" htmlFor="rr-scope-entity" required>
            <Input id="rr-scope-entity" value={scopeEntityType} onChange={(e) => setScopeEntityType(e.target.value)} placeholder="enrolment" />
          </LabelledField>
          <LabelledField label="Description" htmlFor="rr-scope-desc" hint="Optional">
            <Input id="rr-scope-desc" value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add scope'}
            </Button>
          </div>
        </form>
        {scopes.length > 0 && <p className="mt-3 text-xs text-neutral-500">{scopes.length} scope(s) added this session.</p>}
      </CardBody>
    </Card>
  );
}

function SearchStep({ requestId, onError }: { requestId: string; onError: (msg: string) => void }) {
  const [searchedSystem, setSearchedSystem] = useState('');
  const [recordCount, setRecordCount]       = useState('0');
  const [submitting, setSubmitting]         = useState(false);
  const [manifests, setManifests]           = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { manifestId } = await recordSearch(requestId, {
        searchedSystem: searchedSystem.trim(),
        recordCount: Number(recordCount),
      });
      setManifests(m => [...m, manifestId]);
      setSearchedSystem(''); setRecordCount('0');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record search');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="3. Record search manifest" description="Log each system searched to fulfil the request." />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Searched system" htmlFor="rr-system" required>
            <Input id="rr-system" value={searchedSystem} onChange={(e) => setSearchedSystem(e.target.value)} placeholder="student-records" />
          </LabelledField>
          <LabelledField label="Record count" htmlFor="rr-count" required>
            <Input id="rr-count" type="number" min="0" value={recordCount} onChange={(e) => setRecordCount(e.target.value)} />
          </LabelledField>
          <div className="col-span-2">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Recording…' : 'Record search'}
            </Button>
          </div>
        </form>
        {manifests.length > 0 && <p className="mt-3 text-xs text-neutral-500">{manifests.length} system(s) recorded this session.</p>}
      </CardBody>
    </Card>
  );
}

function DecisionStep({ requestId, onError }: { requestId: string; onError: (msg: string) => void }) {
  const [decisionTypeCode, setDecisionTypeCode] = useState<RightsDecisionType>('granted');
  const [legalBasis, setLegalBasis]             = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [decisionId, setDecisionId]             = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { decisionId: id } = await decide(requestId, {
        decisionTypeCode,
        ...(legalBasis.trim() ? { legalBasis: legalBasis.trim() } : {}),
      });
      setDecisionId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record decision');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="4. Decide" />
      <CardBody>
        {decisionId ? (
          <p className="text-sm text-success-700">Decision recorded: <span className="font-mono text-xs">{decisionId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
            <LabelledField label="Decision" htmlFor="rr-decision">
              <Select id="rr-decision" value={decisionTypeCode} onChange={(e) => setDecisionTypeCode(e.target.value as RightsDecisionType)}>
                <option value="granted">Granted</option>
                <option value="partially-granted">Partially granted</option>
                <option value="refused">Refused</option>
              </Select>
            </LabelledField>
            <LabelledField label="Legal basis" htmlFor="rr-basis" hint="Optional">
              <Input id="rr-basis" value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} />
            </LabelledField>
            <div className="col-span-2">
              <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record decision'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function RestrictionsPanel() {
  const [personId, setPersonId]                   = useState('');
  const [restrictionTypeCode, setRestrictionTypeCode] = useState('');
  const [rightsDecisionId, setRightsDecisionId]   = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [restrictionId, setRestrictionId]         = useState<string | null>(null);
  const [lifting, setLifting]                     = useState(false);
  const [lifted, setLifted]                       = useState(false);
  const [error, setError]                         = useState('');

  async function handleApply(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { restrictionId: id } = await applyRestriction({
        personId: personId.trim(),
        restrictionTypeCode: restrictionTypeCode.trim(),
        ...(rightsDecisionId.trim() ? { rightsDecisionId: rightsDecisionId.trim() } : {}),
      });
      setRestrictionId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to apply restriction');
    } finally { setSubmitting(false); }
  }

  async function handleLift() {
    if (!restrictionId) return;
    setLifting(true); setError('');
    try {
      await liftRestriction(restrictionId);
      setLifted(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to lift restriction');
    } finally { setLifting(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Processing restrictions" description="Apply or lift a restriction on processing a person's data (Art. 18)." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {!restrictionId ? (
          <form onSubmit={(e) => void handleApply(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Person ID" htmlFor="rst-person" required>
              <Input id="rst-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
            </LabelledField>
            <LabelledField label="Restriction type" htmlFor="rst-type" required>
              <Input id="rst-type" value={restrictionTypeCode} onChange={(e) => setRestrictionTypeCode(e.target.value)} placeholder="dispute-pending" />
            </LabelledField>
            <LabelledField label="Rights decision ID" htmlFor="rst-decision" hint="Optional">
              <Input id="rst-decision" value={rightsDecisionId} onChange={(e) => setRightsDecisionId(e.target.value)} />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Applying…' : 'Apply restriction'}</Button>
            </div>
          </form>
        ) : lifted ? (
          <p className="text-sm text-success-700">Restriction lifted.</p>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-neutral-700">
              Restriction applied: <span className="font-mono text-xs">{restrictionId}</span>
            </p>
            <Button variant="secondary" size="sm" onClick={() => void handleLift()} disabled={lifting}>
              {lifting ? 'Lifting…' : 'Lift restriction'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RetentionFlow() {
  const [scheduleId, setScheduleId]     = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [error, setError]               = useState('');

  return (
    <div className="space-y-6 mt-4">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <ScheduleStep onCreated={(id) => { setScheduleId(id); setError(''); }} onError={setError} />
      {scheduleId && (
        <AssignmentStep scheduleId={scheduleId} onCreated={(id) => { setAssignmentId(id); setError(''); }} onError={setError} />
      )}
      {assignmentId && <HoldStep assignmentId={assignmentId} onError={setError} />}
      {assignmentId && <DispositionStep assignmentId={assignmentId} onError={setError} />}
    </div>
  );
}

function ScheduleStep({ onCreated, onError }: { onCreated: (id: string) => void; onError: (msg: string) => void }) {
  const [entityType, setEntityType]                   = useState('');
  const [retentionPeriodMonths, setRetentionPeriodMonths] = useState('');
  const [triggerEventCode, setTriggerEventCode]       = useState('');
  const [submitting, setSubmitting]                   = useState(false);
  const [id, setId]                                   = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { retentionScheduleId } = await createSchedule({
        entityType: entityType.trim(),
        retentionPeriodMonths: retentionPeriodMonths.trim(),
        triggerEventCode: triggerEventCode.trim(),
      });
      setId(retentionScheduleId);
      onCreated(retentionScheduleId);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create schedule');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="1. Create retention schedule" />
      <CardBody>
        {id ? (
          <p className="text-sm text-success-700">Schedule created: <span className="font-mono text-xs">{id}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Entity type" htmlFor="ret-entity" required>
              <Input id="ret-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="enrolment" />
            </LabelledField>
            <LabelledField label="Retention period (months)" htmlFor="ret-period" required>
              <Input id="ret-period" value={retentionPeriodMonths} onChange={(e) => setRetentionPeriodMonths(e.target.value)} placeholder="72" />
            </LabelledField>
            <LabelledField label="Trigger event" htmlFor="ret-trigger" required>
              <Input id="ret-trigger" value={triggerEventCode} onChange={(e) => setTriggerEventCode(e.target.value)} placeholder="enrolment-end" />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create schedule'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function AssignmentStep({ scheduleId, onCreated, onError }: { scheduleId: string; onCreated: (id: string) => void; onError: (msg: string) => void }) {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [id, setId]                 = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { retentionAssignmentId } = await assignSchedule(scheduleId, {
        entityType: entityType.trim(),
        entityId: entityId.trim(),
      });
      setId(retentionAssignmentId);
      onCreated(retentionAssignmentId);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to assign schedule');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="2. Assign to a record" />
      <CardBody>
        {id ? (
          <p className="text-sm text-success-700">Assignment created: <span className="font-mono text-xs">{id}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
            <LabelledField label="Entity type" htmlFor="reta-entity" required>
              <Input id="reta-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="enrolment" />
            </LabelledField>
            <LabelledField label="Entity ID" htmlFor="reta-entity-id" required>
              <Input id="reta-entity-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
            </LabelledField>
            <div className="col-span-2">
              <Button type="submit" disabled={submitting}>{submitting ? 'Assigning…' : 'Assign schedule'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function HoldStep({ assignmentId, onError }: { assignmentId: string; onError: (msg: string) => void }) {
  const [holdReasonCode, setHoldReasonCode] = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [holdId, setHoldId]                 = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { holdId: id } = await placeHold(assignmentId, holdReasonCode.trim());
      setHoldId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to place hold');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="3. Place a hold (optional)" description="Prevents disposition — e.g. litigation or an open FOI request." />
      <CardBody>
        {holdId ? (
          <p className="text-sm text-success-700">Hold placed: <span className="font-mono text-xs">{holdId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-3">
            <LabelledField label="Hold reason code" htmlFor="ret-hold" required>
              <Input id="ret-hold" value={holdReasonCode} onChange={(e) => setHoldReasonCode(e.target.value)} placeholder="litigation-hold" />
            </LabelledField>
            <Button type="submit" variant="secondary" disabled={submitting}>{submitting ? 'Placing…' : 'Place hold'}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function DispositionStep({ assignmentId, onError }: { assignmentId: string; onError: (msg: string) => void }) {
  const [dispositionTypeCode, setDispositionTypeCode] = useState<DispositionType>('anonymised');
  const [evidenceRef, setEvidenceRef]                 = useState('');
  const [submitting, setSubmitting]                   = useState(false);
  const [dispositionId, setDispositionId]             = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { dispositionId: id } = await recordDisposition(assignmentId, {
        dispositionTypeCode,
        ...(evidenceRef.trim() ? { evidenceRef: evidenceRef.trim() } : {}),
      });
      setDispositionId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record disposition');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="4. Record disposition" description="Records how the record was finally handled once retention expired." />
      <CardBody>
        {dispositionId ? (
          <p className="text-sm text-success-700">Disposition recorded: <span className="font-mono text-xs">{dispositionId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
            <LabelledField label="Disposition" htmlFor="ret-disp">
              <Select id="ret-disp" value={dispositionTypeCode} onChange={(e) => setDispositionTypeCode(e.target.value as DispositionType)}>
                <option value="anonymised">Anonymised</option>
                <option value="deleted">Deleted</option>
                <option value="transferred">Transferred</option>
              </Select>
            </LabelledField>
            <LabelledField label="Evidence reference" htmlFor="ret-evidence" hint="Optional">
              <Input id="ret-evidence" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
            </LabelledField>
            <div className="col-span-2">
              <Button type="submit" disabled={submitting}>{submitting ? 'Recording…' : 'Record disposition'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function BrowsePanel() {
  const [requests, setRequests] = useState<IndividualRightsRequest[]>([]);
  const [schedules, setSchedules] = useState<RetentionSchedule[]>([]);
  const [assignments, setAssignments] = useState<RetentionAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r, s, a] = await Promise.all([listRequests(), listSchedules(), listAssignments()]);
      setRequests(r); setSchedules(s); setAssignments(a);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8 mt-4"><Spinner /></div>;

  return (
    <div className="space-y-6 mt-4">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>

      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Rights requests</h3>
        {requests.length === 0 ? <p className="text-sm text-neutral-500">No requests found.</p> : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Request ID</TableHeaderCell>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Deadline</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.individualRightsRequestId}>
                    <TableCell className="font-mono text-xs">{r.individualRightsRequestId}</TableCell>
                    <TableCell className="font-mono text-xs">{r.personId}</TableCell>
                    <TableCell className="text-xs">{r.requestTypeCode}</TableCell>
                    <TableCell><Badge value={r.statusCode} /></TableCell>
                    <TableCell className="text-neutral-500">{r.statutoryDeadlineDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Retention schedules</h3>
        {schedules.length === 0 ? <p className="text-sm text-neutral-500">No schedules configured.</p> : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Schedule ID</TableHeaderCell>
                  <TableHeaderCell>Entity type</TableHeaderCell>
                  <TableHeaderCell>Retention period</TableHeaderCell>
                  <TableHeaderCell>Trigger event</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.retentionScheduleId}>
                    <TableCell className="font-mono text-xs">{s.retentionScheduleId}</TableCell>
                    <TableCell className="text-xs">{s.entityType}</TableCell>
                    <TableCell>{s.retentionPeriodMonths}</TableCell>
                    <TableCell className="text-xs">{s.triggerEventCode}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Retention assignments</h3>
        {assignments.length === 0 ? <p className="text-sm text-neutral-500">No assignments found.</p> : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Assignment ID</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell>Scheduled disposal</TableHeaderCell>
                  <TableHeaderCell>Hold</TableHeaderCell>
                  <TableHeaderCell>Disposed</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.retentionAssignmentId}>
                    <TableCell className="font-mono text-xs">{a.retentionAssignmentId}</TableCell>
                    <TableCell className="text-xs">{a.entityType} / {a.entityId}</TableCell>
                    <TableCell className="text-neutral-500">{a.scheduledDisposalDate ?? '—'}</TableCell>
                    <TableCell>{a.hasActiveHold ? <Badge value="held" /> : <span className="text-xs text-neutral-400">None</span>}</TableCell>
                    <TableCell>{a.disposed ? <Badge value="disposed" /> : <span className="text-xs text-neutral-400">No</span>}</TableCell>
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
