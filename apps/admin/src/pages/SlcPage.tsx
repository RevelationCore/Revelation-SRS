import { useState } from 'react';
import { type SlcConfirmationRecord, generateSlcConfirmations } from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

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
      <h1 className="text-xl font-semibold text-gray-900 mb-6">SLC loan data &amp; triggers</h1>

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
                  done    ? 'bg-green-500 text-white' :
                  active  ? 'bg-indigo-600 text-white' :
                            'bg-gray-200 text-gray-500'
                }`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`text-sm ${active || done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                  {label === 'preview' ? 'Preview' : label === 'review' ? 'Review records' : 'Submit to SLC'}
                </span>
                {i < 2 && <span className="text-gray-300 mx-1">›</span>}
              </span>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Step 1 — idle */}
        {step === 'idle' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Enrolment confirmations</h2>
            <p className="text-sm text-gray-600 mb-4">
              This process collects all pending SLC triggers (new enrolments, withdrawals, and
              intermissions) and generates confirmation records for transmission to the Student
              Loans Company. Preview the records before submitting to ensure accuracy.
            </p>
            <button
              onClick={() => void handlePreview()}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none"
            >
              Preview confirmations
            </button>
          </div>
        )}

        {/* Step 1 — loading preview */}
        {step === 'previewing' && (
          <div className="flex items-center gap-3 py-8 text-sm text-gray-500">
            <Spinner /> Loading pending triggers…
          </div>
        )}

        {/* Step 2 — review */}
        {(step === 'preview' || step === 'submitting' || step === 'submitted') && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">
                {records.length} confirmation{records.length !== 1 ? 's' : ''} pending
                {step === 'submitted' && ' — submitted'}
              </span>
              {step === 'submitted' && (
                <span className="text-xs text-green-600 font-medium">Transmitted to SLC</span>
              )}
            </div>

            {records.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400">No pending SLC triggers found.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLC Reference</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expected end</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map(r => (
                    <tr key={r.triggerId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.slcReference}</td>
                      <td className="px-4 py-3"><Badge value={r.confirmationType} /></td>
                      <td className="px-4 py-3 text-xs text-gray-600">{r.modeOfStudyCode}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{r.feeAmount ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{r.startDate}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{r.expectedEndDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Step 3 — actions */}
        {step === 'preview' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSubmit()}
              disabled={records.length === 0}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus:outline-none"
            >
              Submit {records.length} confirmation{records.length !== 1 ? 's' : ''} to SLC
            </button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'submitting' && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <Spinner /> Transmitting to SLC…
          </div>
        )}

        {step === 'submitted' && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-green-600">
              {records.length} confirmation{records.length !== 1 ? 's' : ''} successfully transmitted to SLC.
            </p>
            <button
              onClick={handleReset}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              Start new batch
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
