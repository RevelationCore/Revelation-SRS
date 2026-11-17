import { type FormEvent, useState } from 'react';
import { PageHeader, Card, CardBody, Button, Input, LabelledField } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type VerificationResult, lookupDocuments, verifyDocument } from '../api/awards.js';

const SIGNATURE_LABELS: Record<string, string> = {
  valid: 'Signature valid', invalid: 'Signature does not match: treat as not genuine', 'key-withdrawn': 'Signed with a key the institution has withdrawn', unsigned: 'Issued before documents were signed',
};

/**
 * Verify an award document (BP-06-004; D-4, D-21). Anyone holding a document
 * can check it without an account at the public verification address printed
 * on it; staff can check a code here, or look up by name and date of birth
 * with the holder's recorded consent. Every check is logged.
 */
export function DocumentVerificationPage() {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setResult(null);
    try { setResult(await verifyDocument(code.trim(), note.trim() || undefined)); } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Verification failed'); }
  }

  return (
    <div>
      <PageHeader title="Verify a document" description="Check an award document's verification code. Every lookup is recorded in the audit log." />
      <Card className="mt-6">
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void submit(e)}>
            <LabelledField label="Verification code" htmlFor="verify-code" required>
              <Input id="verify-code" value={code} onChange={(e) => setCode(e.target.value)} className="w-64 font-mono" />
            </LabelledField>
            <LabelledField label="Who is asking, and why" htmlFor="verify-note" hint="e.g. employer reference check">
              <Input id="verify-note" value={note} onChange={(e) => setNote(e.target.value)} className="w-80" />
            </LabelledField>
            <Button type="submit" disabled={code.trim().length < 4}>Verify</Button>
          </form>
          {error && <p className="mt-4 text-sm text-danger-600" role="alert">{error}</p>}
          {result && (
            <div className="mt-6 rounded border border-neutral-200 p-4 text-sm" role="status">
              <p className="font-medium">
                {result.outcomeCode === 'valid' ? 'Valid document' : result.outcomeCode === 'revoked' ? 'This document has been revoked' : result.outcomeCode === 'superseded' ? 'This document has been replaced by a later issue' : 'No document matches this code'}
              </p>
              {result.signature && <p className="mt-1 text-neutral-700">{SIGNATURE_LABELS[result.signature.status] ?? result.signature.status}{result.issuer ? ` · issued by ${result.issuer}` : ''}</p>}
              {result.document && (
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
                  <dt className="text-neutral-500">Holder</dt><dd>{result.document.holderName}</dd>
                  <dt className="text-neutral-500">Document</dt><dd>{result.document.documentTypeCode}</dd>
                  <dt className="text-neutral-500">Award</dt><dd>{result.document.qualificationCode}, {result.document.classificationCode}</dd>
                  <dt className="text-neutral-500">Awarded</dt><dd>{result.document.awardDate}</dd>
                  <dt className="text-neutral-500">Issued</dt><dd>{new Date(result.document.issuedAt).toLocaleDateString('en-GB')}</dd>
                </dl>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <LookupCard />
    </div>
  );
}

/** A lookup without a code (an employer or HEDD request) needs the holder's consent (D-21). */
function LookupCard() {
  const [form, setForm] = useState({ legalFamilyName: '', dateOfBirth: '', consentEvidenceRef: '' });
  const [results, setResults] = useState<VerificationResult[] | null>(null);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setResults(null);
    try { setResults(await lookupDocuments({ legalFamilyName: form.legalFamilyName.trim(), dateOfBirth: form.dateOfBirth, consentEvidenceRef: form.consentEvidenceRef.trim() })); }
    catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Lookup failed'); }
  }
  return (
    <Card className="mt-6">
      <CardBody>
        <h2 className="text-sm font-semibold text-neutral-800">Look up by name and date of birth</h2>
        <p className="mt-1 text-sm text-neutral-600">Only with the holder&apos;s consent, for example a signed HEDD consent. Record where the consent is held.</p>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => void submit(e)}>
          <LabelledField label="Family name" htmlFor="lookup-family" required><Input id="lookup-family" value={form.legalFamilyName} onChange={(e) => setForm((f) => ({ ...f, legalFamilyName: e.target.value }))} /></LabelledField>
          <LabelledField label="Date of birth" htmlFor="lookup-dob" required><Input id="lookup-dob" type="date" value={form.dateOfBirth} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} /></LabelledField>
          <LabelledField label="Consent reference" htmlFor="lookup-consent" required><Input id="lookup-consent" value={form.consentEvidenceRef} onChange={(e) => setForm((f) => ({ ...f, consentEvidenceRef: e.target.value }))} /></LabelledField>
          <Button type="submit" disabled={!form.legalFamilyName.trim() || !form.dateOfBirth || !form.consentEvidenceRef.trim()}>Look up</Button>
        </form>
        {error && <p className="mt-4 text-sm text-danger-600" role="alert">{error}</p>}
        {results && (
          <div className="mt-4 text-sm" role="status">
            {results.length === 0 ? <p>No current document matches.</p> : (
              <ul className="list-disc pl-5">
                {results.map((r, i) => r.document && <li key={i}>{r.document.holderName}: {r.document.documentTypeCode}, {r.document.qualificationCode} {r.document.classificationCode}, awarded {r.document.awardDate}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
