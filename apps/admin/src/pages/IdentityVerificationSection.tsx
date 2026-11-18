import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeSelect,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type VerificationCheck, completeVerificationCheck, listVerificationChecks, requestVerificationCheck } from '../api/identityVerification.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Identity verification checks (BP-02-002; D-6). No document images are
 * held. Right to study is recorded with UKVI, not here.
 */
export function IdentityVerificationSection({ personId, canWrite }: { personId: string; canWrite: boolean }) {
  const [checks, setChecks] = useState<VerificationCheck[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [provider, setProvider] = useState('');

  const load = useCallback(async () => {
    try { setChecks(await listVerificationChecks(personId)); } catch (err) { setError(message(err, 'Failed to load verification checks')); }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!checks) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <Card>
      <CardHeader title="Identity verification" description="Checks that the student is who they say they are. Document images are not held. Right to study is recorded with UKVI." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {checks.length === 0 ? <p className="text-sm text-neutral-600">No verification checks.</p> : (
            <Table>
              <TableHead><tr><TableHeaderCell>Requested</TableHeaderCell><TableHeaderCell>Provider reference</TableHeaderCell><TableHeaderCell>Result</TableHeaderCell><TableHeaderCell>Confidence</TableHeaderCell><TableHeaderCell><span className="sr-only">Complete</span></TableHeaderCell></tr></TableHead>
              <TableBody>
                {checks.map((c) => (
                  <TableRow key={c.verificationCheckId}>
                    <TableCell className="text-sm">{new Date(c.requestedAt).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="font-mono text-xs">{c.providerReference ?? '—'}</TableCell>
                    <TableCell>
                      <Badge value={c.statusCode === 'verified' ? 'approved' : c.statusCode === 'requested' ? 'pending' : 'rejected'} label={c.statusCode} />
                      {c.fraudFlag && <div className="text-xs text-danger-700">Fraud flagged</div>}
                      {c.completedAt && <div className="text-xs text-neutral-500">{new Date(c.completedAt).toLocaleDateString('en-GB')}</div>}
                    </TableCell>
                    <TableCell>{c.confidenceScore ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canWrite && !c.completedAt && <CompleteControl check={c} onComplete={(body) => act(() => completeVerificationCheck(personId, c.verificationCheckId, body))} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void act(() => requestVerificationCheck(personId, provider.trim() || undefined)).then((ok) => { if (ok) setProvider(''); }); }}>
              <LabelledField label="Provider reference" htmlFor="iv-provider" hint="Optional">
                <Input id="iv-provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
              </LabelledField>
              <Button type="submit" variant="secondary">Request a check</Button>
            </form>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function CompleteControl({ check, onComplete }: {
  check: VerificationCheck;
  onComplete: (body: { statusCode: 'verified' | 'failed' | 'fraud-flagged'; confidenceScore?: number; fraudFlag?: boolean }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<'verified' | 'failed' | 'fraud-flagged'>('verified');
  const [confidence, setConfidence] = useState('');
  const id = `iv-complete-${check.verificationCheckId}`;
  const send = () => void onComplete({ statusCode: status, ...(confidence ? { confidenceScore: Number(confidence) } : {}), ...(status === 'fraud-flagged' ? { fraudFlag: true } : {}) })
    .then((ok) => { if (ok) { setOpen(false); setConfirming(false); } });

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record result</Button>;
  if (confirming) {
    return (
      <div className="inline-flex flex-col items-end gap-2">
        <p className="text-sm">Mark this check as fraud flagged? This is recorded against the student and reported as special category data.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={send}>Confirm fraud flag</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="inline-flex flex-col items-end gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); if (status === 'fraud-flagged') setConfirming(true); else send(); }}>
      <LabelledField label="Result" htmlFor={`${id}-status`}>
        <CodeSelect entity="identity_verification_check" field="status_code" id={`${id}-status`} value={status} onChange={(v) => setStatus(v as typeof status)} only={['verified', 'failed', 'fraud-flagged']} />
      </LabelledField>
      <LabelledField label="Confidence (0–100)" htmlFor={`${id}-confidence`}>
        <Input id={`${id}-confidence`} type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(e.target.value)} className="w-28" />
      </LabelledField>
      <div className="flex gap-2">
        <Button type="submit" size="sm">Save result</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
