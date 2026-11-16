import { type FormEvent, useState } from 'react';
import { PageHeader, Card, CardBody, Button, Input, LabelledField } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type VerificationResult, verifyDocument } from '../api/awards.js';

/**
 * Verify an award document by its code (BP-06-004; D-4). Each lookup is
 * audited. Verification by third parties without an account comes later.
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
    </div>
  );
}
