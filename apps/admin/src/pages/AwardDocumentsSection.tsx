import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type DocumentIssue, type RevocationRequest, decideRevocation, downloadDocumentPdf, issueAwardDocument, listAwardDocuments, listRevocationRequests, revokeDocumentIssue } from '../api/awards.js';
import { useAuth } from '../auth/AuthContext.js';
import { useValueSet } from '../hooks/useValueSet.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Documents issued for a conferred award (BP-06-004; D-4, D-20). Each issue is
 * rendered to a PDF from its frozen content and signed; the PDF carries the
 * verification code. Revoking needs a reason and a second registry
 * administrator's decision.
 */
export function AwardDocumentsSection({ awardId, canIssue, canRevoke }: { awardId: string; canIssue: boolean; canRevoke: boolean }) {
  const [issues, setIssues] = useState<DocumentIssue[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [requests, setRequests] = useState<RevocationRequest[]>([]);
  const { user } = useAuth();

  const load = useCallback(async () => {
    try {
      const list = await listAwardDocuments(awardId);
      setIssues(list);
      if (canRevoke) {
        const ids = new Set(list.map((d) => d.documentIssueId));
        setRequests((await listRevocationRequests()).filter((r) => ids.has(r.documentIssueId)));
      }
    } catch (err) { setError(message(err, 'Failed to load documents')); }
  }, [awardId, canRevoke]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!issues) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card>
      <CardHeader title="Award documents" description="Certificates, transcripts, the HEAR and award letters issued for this award. Each is a signed PDF carrying its verification code, which anyone holding it can check online." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {issues.length === 0 ? <p className="text-sm text-neutral-600">No documents issued.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Document</TableHeaderCell><TableHeaderCell>Issue</TableHeaderCell><TableHeaderCell>Delivery</TableHeaderCell>
                  <TableHeaderCell>Verification code</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Revoke</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {issues.map((d) => (
                  <TableRow key={d.documentIssueId}>
                    <TableCell>{d.documentTypeCode}<div className="text-xs text-neutral-500">Issued {new Date(d.issuedAt).toLocaleDateString('en-GB')} by {d.issuedBy}</div></TableCell>
                    <TableCell className="text-sm">#{d.issueNumber} ({d.issueTypeCode})</TableCell>
                    <TableCell className="text-sm">{d.channelCode}</TableCell>
                    <TableCell className="font-mono text-xs">{d.verificationCode}</TableCell>
                    <TableCell>
                      <Badge value={d.statusCode === 'issued' ? 'approved' : 'rejected'} label={d.statusCode} />
                      {d.revocation && <div className="text-xs text-neutral-500">{d.revocation.reasonCode}: {d.revocation.reasonText}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        {d.rendered && (
                          <Button size="sm" variant="ghost" onClick={() => void act(() => downloadDocumentPdf(d.documentIssueId, `${d.documentTypeCode}-${d.issueNumber}.pdf`))}>
                            Download PDF<span className="sr-only"> of {d.documentTypeCode} issue {d.issueNumber}</span>
                          </Button>
                        )}
                        {(() => {
                          const pending = requests.find((r) => r.documentIssueId === d.documentIssueId && r.statusCode === 'open');
                          if (pending) {
                            return pending.requestedBy === user?.sub
                              ? <p className="text-xs text-neutral-600">Revocation requested; another registry administrator decides it.</p>
                              : (
                                <div className="flex gap-2">
                                  <span className="text-xs text-neutral-600">Revoke requested ({pending.reasonCode})</span>
                                  <Button size="sm" variant="danger" onClick={() => void act(() => decideRevocation(pending.caseId, 'approved'))}>Approve revocation</Button>
                                  <Button size="sm" variant="ghost" onClick={() => void act(() => decideRevocation(pending.caseId, 'rejected'))}>Reject</Button>
                                </div>
                              );
                          }
                          return canRevoke && d.statusCode === 'issued'
                            ? <RevokeControl issue={d} onRevoke={(body) => act(() => revokeDocumentIssue(d.documentIssueId, body))} />
                            : null;
                        })()}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canIssue && <IssueForm hasIssues={issues.length > 0} onSubmit={(body) => act(() => issueAwardDocument(awardId, body))} />}
        </div>
      </CardBody>
    </Card>
  );
}

function IssueForm({ hasIssues, onSubmit }: { hasIssues: boolean; onSubmit: (body: { documentTypeCode: string; channelCode: string; issueTypeCode?: string }) => Promise<boolean> }) {
  const { members: types } = useValueSet('student_document', 'document_type_code');
  const { members: channels } = useValueSet('document_issue', 'channel_code');
  const { members: issueTypes } = useValueSet('document_issue', 'issue_type_code');
  const [type, setType] = useState('');
  const [channel, setChannel] = useState('');
  const [issueType, setIssueType] = useState('original');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSubmit({ documentTypeCode: type, channelCode: channel, issueTypeCode: issueType })) { setType(''); setChannel(''); setIssueType('original'); }
  }
  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <LabelledField label="Document" htmlFor="doc-type" required>
        <Select id="doc-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Delivery" htmlFor="doc-channel" required>
        <Select id="doc-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Choose…</option>
          {channels.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Issue" htmlFor="doc-issue-type" hint={hasIssues ? 'A replacement or correction supersedes the earlier issue' : undefined}>
        <Select id="doc-issue-type" value={issueType} onChange={(e) => setIssueType(e.target.value)}>
          {issueTypes.length === 0 ? <option value="original">Original</option> : issueTypes.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <Button type="submit" disabled={!type || !channel}>Issue document</Button>
    </form>
  );
}

function RevokeControl({ issue, onRevoke }: { issue: DocumentIssue; onRevoke: (body: { reasonCode: string; reasonText: string }) => Promise<boolean> }) {
  const { members: reasons } = useValueSet('document_revocation', 'reason_code');
  const [stage, setStage] = useState<'closed' | 'form' | 'confirm'>('closed');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const id = `revoke-doc-${issue.documentIssueId}`;
  if (stage === 'closed') return <Button size="sm" variant="secondary" onClick={() => setStage('form')}>Revoke<span className="sr-only"> {issue.documentTypeCode} #{issue.issueNumber}</span></Button>;
  if (stage === 'confirm') {
    return (
      <div className="inline-flex flex-col items-end gap-2">
        <p className="text-sm">Ask to revoke {issue.documentTypeCode} #{issue.issueNumber}? Another registry administrator must approve it; verification will then report it as revoked.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void onRevoke({ reasonCode, reasonText: reasonText.trim() }).then((ok) => { if (ok) setStage('closed'); })}>Request revocation</Button>
          <Button size="sm" variant="ghost" onClick={() => setStage('form')}>Back</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="inline-flex flex-col items-end gap-2" onSubmit={(e) => { e.preventDefault(); setStage('confirm'); }}>
      <LabelledField label="Reason" htmlFor={`${id}-code`} required>
        <Select id={`${id}-code`} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          <option value="">Choose…</option>
          {reasons.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Explanation" htmlFor={`${id}-text`} required>
        <Input id={`${id}-text`} value={reasonText} onChange={(e) => setReasonText(e.target.value)} className="w-64" />
      </LabelledField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!reasonCode || !reasonText.trim()}>Continue</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setStage('closed')}>Cancel</Button>
      </div>
    </form>
  );
}
