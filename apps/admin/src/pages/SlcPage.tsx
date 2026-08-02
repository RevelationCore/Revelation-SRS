import { useState } from 'react';
import { type SlcConfirmationRecord, generateSlcConfirmations } from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

type Step = 'idle' | 'previewing' | 'preview' | 'submitting' | 'submitted';

export function SlcPage() {
  const [step,     setStep]     = useState<Step>('idle');
  const [records,  setRecords]  = useState<SlcConfirmationRecord[]>([]);
  const [error,    setError]    = useState('');

  async function handlePreview() {
    (document.activeElement as HTMLElement | null)?.blur();
    setStep('previewing'); setError('');
    try {
      const result = await generateSlcConfirmations({ dryRun: true });
      setRecords(result.payload.confirmations);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to preview confirmations');
      setStep('idle');
    }
  }

  async function handleSubmit() {
    (document.activeElement as HTMLElement | null)?.blur();
    setStep('submitting'); setError('');
    try {
      const result = await generateSlcConfirmations({ dryRun: false });
      setRecords(result.payload.confirmations);
      setStep('submitted');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to submit confirmations');
      setStep('preview');
    }
  }

  function handleReset() {
    setStep('idle'); setRecords([]); setError('');
  }

  return (
    <div>
      <PageHeader title="SLC loan data & triggers" />

      <div className="max-w-4xl space-y-6">

        {/* Step indicator */}
        <div className="flex items-center gap-3">
          {(['preview', 'review', 'submit'] as const).map((label, i) => {
            const active = (i === 0 && (step === 'previewing' || step === 'preview')) ||
                           (i === 1 && step === 'preview') ||
                           (i === 2 && (step === 'submitting' || step === 'submitted'));
            const done   = (i === 0 && step !== 'idle' && step !== 'previewing') ||
                           (i === 2 && step === 'submitted');
            return (
              <span key={label} className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  done    ? 'bg-success-500 text-white' :
                  active  ? 'bg-primary-600 text-white' :
                            'bg-neutral-200 text-neutral-500'
                }`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`text-sm ${active || done ? 'text-neutral-900 font-medium' : 'text-neutral-600'}`}>
                  {label === 'preview' ? 'Preview' : label === 'review' ? 'Review records' : 'Submit to SLC'}
                </span>
                {i < 2 && <span className="text-neutral-300 mx-1">›</span>}
              </span>
            );
          })}
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        {/* Step 1 — idle */}
        {step === 'idle' && (
          <Card>
            <CardBody>
              <h2 className="text-sm font-semibold text-neutral-700 mb-2">Enrolment confirmations</h2>
              <p className="text-sm text-neutral-600 mb-4">
                This process collects all pending SLC triggers (new enrolments, withdrawals, and
                intermissions) and generates confirmation records for transmission to the Student
                Loans Company. Preview the records before submitting to ensure accuracy.
              </p>
              <Button onClick={() => void handlePreview()}>Preview confirmations</Button>
            </CardBody>
          </Card>
        )}

        {/* Step 1 — loading preview */}
        {step === 'previewing' && (
          <div className="flex items-center gap-3 py-8 text-sm text-neutral-500">
            <Spinner /> Loading pending triggers…
          </div>
        )}

        {/* Step 2 — review */}
        {(step === 'preview' || step === 'submitting' || step === 'submitted') && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-b border-neutral-200">
              <span className="text-sm font-medium text-neutral-700">
                {records.length} confirmation{records.length !== 1 ? 's' : ''} pending
                {step === 'submitted' && ' — submitted'}
              </span>
              {step === 'submitted' && (
                <span className="text-xs text-success-600 font-medium">Transmitted to SLC</span>
              )}
            </div>

            {records.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-600">No pending SLC triggers found.</p>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>SLC Reference</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Mode</TableHeaderCell>
                    <TableHeaderCell>Fee</TableHeaderCell>
                    <TableHeaderCell>Start date</TableHeaderCell>
                    <TableHeaderCell>Expected end</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {records.map(r => (
                    <TableRow key={r.triggerId}>
                      <TableCell className="font-mono text-xs text-neutral-700">{r.slcReference}</TableCell>
                      <TableCell><Badge value={r.confirmationType} /></TableCell>
                      <TableCell className="text-xs">{r.modeOfStudyCode}</TableCell>
                      <TableCell className="text-xs">{r.feeAmount ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.startDate}</TableCell>
                      <TableCell className="text-xs">{r.expectedEndDate ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {/* Step 3 — actions */}
        {step === 'preview' && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void handleSubmit()} disabled={records.length === 0}>
              Submit {records.length} confirmation{records.length !== 1 ? 's' : ''} to SLC
            </Button>
            <Button variant="ghost" onClick={handleReset}>Cancel</Button>
          </div>
        )}

        {step === 'submitting' && (
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <Spinner /> Transmitting to SLC…
          </div>
        )}

        {step === 'submitted' && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-success-600">
              {records.length} confirmation{records.length !== 1 ? 's' : ''} successfully transmitted to SLC.
            </p>
            <Button variant="ghost" onClick={handleReset}>Start new batch</Button>
          </div>
        )}

      </div>
    </div>
  );
}
