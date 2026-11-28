import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge, CodeBadge, CodeSelect,
} from '@revelation-srs/ui';
import {
  type FactChoice,
  type IdentityDecisionType,
  type IdentityResolutionCase,
  type DataCorrectionCase,
  type MergeProposal,
  openCase,
  addCandidate,
  decide,
  getProposal,
  putProposal,
  linkPersons,
  openCorrectionCase,
  listCases,
  listCorrectionCases,
} from '../api/identityResolution.js';
import { useAuth } from '../auth/AuthContext.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

// No list endpoint exists for identity-resolution cases (write-only DPO
// workflow API) — this console covers duplicate-person resolution
// (case → candidates → decision), direct person linking, and opening a
// data-correction case, each a standalone action producing an ID.
export function IdentityResolutionPage() {
  return (
    <div>
      <PageHeader
        title="Identity resolution"
        description="Resolve duplicate person records, link related identities, and open data-correction cases."
      />
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse cases</TabsTrigger>
          <TabsTrigger value="cases">Duplicate resolution</TabsTrigger>
          <TabsTrigger value="decide">Decide a case</TabsTrigger>
          <TabsTrigger value="links">Link persons</TabsTrigger>
          <TabsTrigger value="corrections">Data correction</TabsTrigger>
        </TabsList>
        <TabsContent value="browse"><BrowseCasesPanel /></TabsContent>
        <TabsContent value="cases"><ResolutionCaseFlow /></TabsContent>
        <TabsContent value="decide"><DecideCasePanel /></TabsContent>
        <TabsContent value="links"><LinkPersonsPanel /></TabsContent>
        <TabsContent value="corrections"><CorrectionCasePanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function ResolutionCaseFlow() {
  const { user } = useAuth();
  const [subjectPersonId, setSubjectPersonId] = useState('');
  const [caseId, setCaseId]                   = useState<string | null>(null);
  const [error, setError]                     = useState('');
  const [creating, setCreating]               = useState(false);

  async function handleOpen(e: FormEvent) {
    e.preventDefault();
    setCreating(true); setError('');
    try {
      const { identityResolutionCaseId } = await openCase({
        subjectPersonId: subjectPersonId.trim(),
        ownerId: user?.sub ?? '',
      });
      setCaseId(identityResolutionCaseId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open case');
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-6 mt-4">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <Card>
        <CardHeader title="1. Open resolution case" />
        <CardBody>
          {caseId ? (
            <p className="text-sm text-success-700">Case opened: <span className="font-mono text-xs">{caseId}</span></p>
          ) : (
            <form onSubmit={(e) => void handleOpen(e)} className="flex items-end gap-3">
              <LabelledField label="Subject person ID" htmlFor="ir-subject" required>
                <Input id="ir-subject" value={subjectPersonId} onChange={(e) => setSubjectPersonId(e.target.value)} />
              </LabelledField>
              <Button type="submit" disabled={creating}>{creating ? 'Opening…' : 'Open case'}</Button>
            </form>
          )}
        </CardBody>
      </Card>
      {caseId && <CandidateStep caseId={caseId} onError={setError} />}
      {caseId && <ProposalStep caseId={caseId} subjectPersonId={subjectPersonId.trim()} onError={setError} />}
    </div>
  );
}

function CandidateStep({ caseId, onError }: { caseId: string; onError: (msg: string) => void }) {
  const [candidatePersonId, setCandidatePersonId] = useState('');
  const [matchScore, setMatchScore]               = useState('0.8');
  const [matchReasonCode, setMatchReasonCode]     = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [candidates, setCandidates]               = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { candidateId } = await addCandidate(caseId, {
        candidatePersonId: candidatePersonId.trim(),
        matchScore: Number(matchScore),
        matchReasonCode: matchReasonCode.trim(),
      });
      setCandidates(c => [...c, candidateId]);
      setCandidatePersonId(''); setMatchReasonCode('');
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to add candidate');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="2. Add candidate matches" />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
          <LabelledField label="Candidate person ID" htmlFor="ir-cand" required>
            <Input id="ir-cand" value={candidatePersonId} onChange={(e) => setCandidatePersonId(e.target.value)} />
          </LabelledField>
          <LabelledField label="Match score (0-1)" htmlFor="ir-score" required>
            <Input id="ir-score" type="number" min="0" max="1" step="0.01" value={matchScore} onChange={(e) => setMatchScore(e.target.value)} />
          </LabelledField>
          <LabelledField label="Match reason code" htmlFor="ir-reason" required>
            <Input id="ir-reason" value={matchReasonCode} onChange={(e) => setMatchReasonCode(e.target.value)} placeholder="name-dob-match" />
          </LabelledField>
          <div className="col-span-3">
            <Button type="submit" size="sm" variant="secondary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add candidate'}
            </Button>
          </div>
        </form>
        {candidates.length > 0 && <p className="mt-3 text-xs text-neutral-500">{candidates.length} candidate(s) added this session.</p>}
      </CardBody>
    </Card>
  );
}

/**
 * ADR-031: the preparer proposes which record survives and resolves any
 * conflicting statutory identifiers. Another officer decides, on the
 * "Decide a case" tab: whoever prepares a case may not decide it.
 */
function ProposalStep({ caseId, subjectPersonId, onError }: { caseId: string; subjectPersonId: string; onError: (msg: string) => void }) {
  const [survivorPersonId, setSurvivorPersonId] = useState('');
  const [twoAccountsConfirmed, setTwoAccountsConfirmed] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, { keep: FactChoice; reason: string }>>({});
  const [proposal, setProposal] = useState<MergeProposal | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      setProposal(await putProposal(caseId, {
        survivorPersonId: survivorPersonId.trim(), mergedPersonId: subjectPersonId, identifierResolutions: resolutions, twoAccountsConfirmed,
      }));
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to save the proposal');
    } finally { setSubmitting(false); }
  }

  const unresolved = proposal?.identifierConflicts.filter((c) => !c.resolved) ?? [];
  return (
    <Card>
      <CardHeader title="3. Propose" description="The record that survives is one of the candidates; the case subject is merged into it. Another officer decides." />
      <CardBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
          <LabelledField label="Surviving person ID (a candidate)" htmlFor="ir-survivor" required>
            <Input id="ir-survivor" value={survivorPersonId} onChange={(e) => setSurvivorPersonId(e.target.value)} />
          </LabelledField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={twoAccountsConfirmed} onChange={(e) => setTwoAccountsConfirmed(e.target.checked)} />
            Both people have an institutional account, and the merged person&apos;s account will be ended
          </label>
          {(proposal?.identifierConflicts ?? []).map((c) => (
            <div key={c.identifierClass} className="col-span-2 grid grid-cols-3 gap-3 items-end">
              <p className="text-sm">
                <span className="font-medium">{c.identifierClass}</span>: survivor {c.survivorValues.join(', ')}; merged {c.mergedValues.join(', ')}
              </p>
              <LabelledField label="Keep" htmlFor={`ir-keep-${c.identifierClass}`}>
                <CodeSelect entity="identity_merge_proposal" field="identifier_keep" id={`ir-keep-${c.identifierClass}`} value={resolutions[c.identifierClass]?.keep ?? ''}
                  onChange={(v) => setResolutions({ ...resolutions, [c.identifierClass]: { keep: v as FactChoice, reason: resolutions[c.identifierClass]?.reason ?? '' } })} />
              </LabelledField>
              <LabelledField label="Why" htmlFor={`ir-why-${c.identifierClass}`}>
                <Input id={`ir-why-${c.identifierClass}`} value={resolutions[c.identifierClass]?.reason ?? ''}
                  onChange={(e) => setResolutions({ ...resolutions, [c.identifierClass]: { keep: resolutions[c.identifierClass]?.keep ?? 'survivor', reason: e.target.value } })} />
              </LabelledField>
            </div>
          ))}
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : proposal ? 'Save a new version' : 'Save proposal'}</Button>
            {proposal && (
              <p className="text-sm text-neutral-700">
                Version {proposal.version} saved{unresolved.length > 0 ? `; resolve ${unresolved.map((c) => c.identifierClass).join(', ')} before it can be decided` : '. Ask another officer to decide it.'}
              </p>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** ADR-031: decide a case someone else prepared, on the proposal version shown. */
function DecideCasePanel() {
  const [caseId, setCaseId] = useState('');
  const [proposal, setProposal] = useState<MergeProposal | null>(null);
  const [decisionTypeCode, setDecisionTypeCode] = useState<IdentityDecisionType>('merge');
  const [reason, setReason] = useState('');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setDecisionId(null);
    try { setProposal(await getProposal(caseId.trim())); } catch (err) {
      setProposal(null);
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load the proposal');
    } finally { setBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { decisionId: id } = await decide(caseId.trim(), {
        decisionTypeCode, reason: reason.trim(), ...(decisionTypeCode === 'reject' ? {} : { proposalVersion: proposal?.version }),
      });
      setDecisionId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record the decision');
    } finally { setBusy(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Decide a case" description="You cannot decide a case you opened, added a candidate to or proposed, or one about your own record." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={(e) => void load(e)} className="flex items-end gap-3 mb-4">
          <LabelledField label="Case ID" htmlFor="ir-decide-case" required>
            <Input id="ir-decide-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          </LabelledField>
          <Button type="submit" disabled={busy}>Load proposal</Button>
        </form>
        {proposal && !decisionId && (
          <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3 items-end">
            <p className="col-span-2 text-sm">
              Version {proposal.version}: merge <span className="font-mono text-xs">{proposal.mergedPersonId}</span> into{' '}
              <span className="font-mono text-xs">{proposal.survivorPersonId}</span>, proposed by {proposal.proposedBy}.
              {proposal.identifierConflicts.length > 0 && ` Identifier conflicts: ${proposal.identifierConflicts.map((c) => `${c.identifierClass} (${c.resolved ? 'resolved' : 'unresolved'})`).join(', ')}.`}
            </p>
            <LabelledField label="Decision" htmlFor="ir-decision">
              <CodeSelect entity="identity_resolution_decision" field="decision_type_code" id="ir-decision" value={decisionTypeCode} onChange={(v) => setDecisionTypeCode(v as IdentityDecisionType)} />
            </LabelledField>
            <LabelledField label="Reason" htmlFor="ir-reason" required>
              <Input id="ir-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </LabelledField>
            <div className="col-span-2">
              <Button type="submit" disabled={busy || !reason.trim()}>{busy ? 'Recording…' : 'Record decision'}</Button>
            </div>
          </form>
        )}
        {decisionId && <p className="text-sm text-success-700">Decision recorded: <span className="font-mono text-xs">{decisionId}</span></p>}
      </CardBody>
    </Card>
  );
}

function LinkPersonsPanel() {
  const [sourcePersonId, setSourcePersonId] = useState('');
  const [targetPersonId, setTargetPersonId] = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [linkId, setLinkId]                 = useState<string | null>(null);
  const [error, setError]                   = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { linkId: id } = await linkPersons({
        sourcePersonId: sourcePersonId.trim(),
        targetPersonId: targetPersonId.trim(),
        linkTypeCode: 'related-record',
      });
      setLinkId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to link persons');
    } finally { setSubmitting(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Link related persons" description="Record that two person records are related, without merging them. A merge is made by a decision on a resolution case." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {linkId ? (
          <p className="text-sm text-success-700">Link recorded: <span className="font-mono text-xs">{linkId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Source person ID" htmlFor="ir-src" required>
              <Input id="ir-src" value={sourcePersonId} onChange={(e) => setSourcePersonId(e.target.value)} />
            </LabelledField>
            <LabelledField label="Target person ID" htmlFor="ir-tgt" required>
              <Input id="ir-tgt" value={targetPersonId} onChange={(e) => setTargetPersonId(e.target.value)} />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Linking…' : 'Link persons'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function CorrectionCasePanel() {
  const { user } = useAuth();
  const [personId, setPersonId]                     = useState('');
  const [correctedEntityType, setCorrectedEntityType] = useState('');
  const [correctedFieldName, setCorrectedFieldName] = useState('');
  const [submitting, setSubmitting]                 = useState(false);
  const [caseId, setCaseId]                         = useState<string | null>(null);
  const [error, setError]                           = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const { dataCorrectionCaseId } = await openCorrectionCase({
        personId: personId.trim(),
        correctedEntityType: correctedEntityType.trim(),
        correctedFieldName: correctedFieldName.trim(),
        ownerId: user?.sub ?? '',
      });
      setCaseId(dataCorrectionCaseId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to open correction case');
    } finally { setSubmitting(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Open data-correction case" description="Record an identity data-quality issue for follow-up (e.g. a mismatched name or DOB source)." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {caseId ? (
          <p className="text-sm text-success-700">Case opened: <span className="font-mono text-xs">{caseId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-3 gap-3 items-end">
            <LabelledField label="Person ID" htmlFor="ir-cc-person" required>
              <Input id="ir-cc-person" value={personId} onChange={(e) => setPersonId(e.target.value)} />
            </LabelledField>
            <LabelledField label="Entity type" htmlFor="ir-cc-entity" required>
              <Input id="ir-cc-entity" value={correctedEntityType} onChange={(e) => setCorrectedEntityType(e.target.value)} placeholder="person_identity" />
            </LabelledField>
            <LabelledField label="Field name" htmlFor="ir-cc-field" required>
              <Input id="ir-cc-field" value={correctedFieldName} onChange={(e) => setCorrectedFieldName(e.target.value)} placeholder="dateOfBirth" />
            </LabelledField>
            <div className="col-span-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Opening…' : 'Open case'}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// Read-side view onto the write-only case APIs above — lets staff find an
// existing case's ID and status rather than only creating new cases blind.
function BrowseCasesPanel() {
  const [resolutionCases, setResolutionCases] = useState<IdentityResolutionCase[]>([]);
  const [correctionCases, setCorrectionCases] = useState<DataCorrectionCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [resolutions, corrections] = await Promise.all([listCases(), listCorrectionCases()]);
      setResolutionCases(resolutions);
      setCorrectionCases(corrections);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load cases');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="space-y-6 mt-4">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <Button variant="secondary" size="sm" onClick={() => void load()}>Refresh</Button>

      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Duplicate resolution cases</h3>
        {resolutionCases.length === 0 ? (
          <p className="text-sm text-neutral-500">No cases found.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Case ID</TableHeaderCell>
                  <TableHeaderCell>Subject person</TableHeaderCell>
                  <TableHeaderCell>Owner</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Opened</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {resolutionCases.map((c) => (
                  <TableRow key={c.identityResolutionCaseId}>
                    <TableCell className="font-mono text-xs">{c.identityResolutionCaseId}</TableCell>
                    <TableCell className="font-mono text-xs">{c.subjectPersonId}</TableCell>
                    <TableCell className="text-xs">{c.ownerId}</TableCell>
                    <TableCell><CodeBadge entity="business_case" field="status_code" code={c.statusCode} /></TableCell>
                    <TableCell className="text-neutral-500">{new Date(c.createdAt).toLocaleDateString('en-GB')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Data correction cases</h3>
        {correctionCases.length === 0 ? (
          <p className="text-sm text-neutral-500">No cases found.</p>
        ) : (
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Case ID</TableHeaderCell>
                  <TableHeaderCell>Person</TableHeaderCell>
                  <TableHeaderCell>Entity / field</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Opened</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {correctionCases.map((c) => (
                  <TableRow key={c.dataCorrectionCaseId}>
                    <TableCell className="font-mono text-xs">{c.dataCorrectionCaseId}</TableCell>
                    <TableCell className="font-mono text-xs">{c.personId}</TableCell>
                    <TableCell className="text-xs">{c.correctedEntityType} / {c.correctedFieldName}</TableCell>
                    <TableCell><CodeBadge entity="business_case" field="status_code" code={c.statusCode} /></TableCell>
                    <TableCell className="text-neutral-500">{new Date(c.createdAt).toLocaleDateString('en-GB')}</TableCell>
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
