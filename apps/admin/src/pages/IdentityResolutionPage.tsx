import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, PageHeader, LabelledField, Input, Select, Tabs, TabsList, TabsTrigger, TabsContent,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';
import {
  type IdentityDecisionType,
  type IdentityResolutionCase,
  type DataCorrectionCase,
  openCase,
  addCandidate,
  decide,
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
          <TabsTrigger value="links">Link persons</TabsTrigger>
          <TabsTrigger value="corrections">Data correction</TabsTrigger>
        </TabsList>
        <TabsContent value="browse"><BrowseCasesPanel /></TabsContent>
        <TabsContent value="cases"><ResolutionCaseFlow /></TabsContent>
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
      {caseId && <DecisionStep caseId={caseId} onError={setError} />}
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

function DecisionStep({ caseId, onError }: { caseId: string; onError: (msg: string) => void }) {
  const [decisionTypeCode, setDecisionTypeCode] = useState<IdentityDecisionType>('link');
  const [survivorPersonId, setSurvivorPersonId] = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [decisionId, setDecisionId]             = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true); onError('');
    try {
      const { decisionId: id } = await decide(caseId, {
        decisionTypeCode,
        ...(survivorPersonId.trim() ? { survivorPersonId: survivorPersonId.trim() } : {}),
      });
      setDecisionId(id);
    } catch (err) {
      onError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to record decision');
    } finally { setSubmitting(false); }
  }

  return (
    <Card>
      <CardHeader title="3. Decide" />
      <CardBody>
        {decisionId ? (
          <p className="text-sm text-success-700">Decision recorded: <span className="font-mono text-xs">{decisionId}</span></p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-3 items-end">
            <LabelledField label="Decision" htmlFor="ir-decision">
              <Select id="ir-decision" value={decisionTypeCode} onChange={(e) => setDecisionTypeCode(e.target.value as IdentityDecisionType)}>
                <option value="link">Link</option>
                <option value="merge">Merge</option>
                <option value="reject">Reject</option>
              </Select>
            </LabelledField>
            <LabelledField label="Survivor person ID" htmlFor="ir-survivor" hint="Required for merge">
              <Input id="ir-survivor" value={survivorPersonId} onChange={(e) => setSurvivorPersonId(e.target.value)} />
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

function LinkPersonsPanel() {
  const [sourcePersonId, setSourcePersonId] = useState('');
  const [targetPersonId, setTargetPersonId] = useState('');
  const [linkTypeCode, setLinkTypeCode]     = useState('');
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
        linkTypeCode: linkTypeCode.trim(),
      });
      setLinkId(id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to link persons');
    } finally { setSubmitting(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader title="Link related persons" description="Record a direct relationship between two person records without opening a resolution case." />
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
            <LabelledField label="Link type" htmlFor="ir-linktype" required>
              <Input id="ir-linktype" value={linkTypeCode} onChange={(e) => setLinkTypeCode(e.target.value)} placeholder="sibling-record" />
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
                    <TableCell><Badge value={c.statusCode} /></TableCell>
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
                    <TableCell><Badge value={c.statusCode} /></TableCell>
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
