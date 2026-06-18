import { useState } from 'react';
import { generateSlcConfirmations } from '../api/regulatory.js';
import { ApiError } from '../api/client.js';

export function SlcPage() {
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState('');
  const [successMsg,  setSuccessMsg]  = useState('');

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    setSuccessMsg('');
    try {
      await generateSlcConfirmations();
      setSuccessMsg('SLC confirmations generated and queued for transmission.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate SLC confirmations');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">Regulatory</p>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">SLC confirmations</h1>

      <div className="max-w-xl bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Enrolment confirmations</h2>
        <p className="text-sm text-gray-600 mb-4">
          Generate and transmit confirmation of enrolment records to the Student Loans Company.
          This process runs against all currently active enrolments and produces an electronic
          notification file.
        </p>

        {error      && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {successMsg && <p className="mb-4 text-sm text-green-600">{successMsg}</p>}

        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating…' : 'Generate SLC confirmations'}
        </button>
      </div>
    </div>
  );
}
