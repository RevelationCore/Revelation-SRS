import { useEffect, useState } from 'react';
import {
  type OfsB3Extract,
  generateOfsB3Extract,
  generateOfsParticipationReport,
  getOfsB3Extract,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';

const OFS_ACADEMIC_YEARS = ['2025-26', '2024-25', '2023-24', '2022-23'];

type Tab = 'b3' | 'participation';

interface ParticipationReport {
  extractId:   string;
  academicYear: string;
  recordCount: number;
  generatedAt: string;
  payload:     Record<string, unknown>;
}

// ── B3 Extract tab ────────────────────────────────────────────────────────────

function B3Tab({
  extracts, setExtracts,
}: {
  extracts: OfsB3Extract[];
  setExtracts: React.Dispatch<React.SetStateAction<OfsB3Extract[]>>;
}) {
  const [academicYear, setAcademicYear] = useState(OFS_ACADEMIC_YEARS[0]!);
  const [generating,   setGenerating]   = useState(false);
  const [polling,      setPolling]      = useState<string | null>(null);
  const [selected,     setSelected]     = useState<OfsB3Extract | null>(null);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const ext = await getOfsB3Extract(polling);
        if (ext.statusCode !== 'pending') {
          setPolling(null);
          setExtracts(prev => prev.map(e => e.extractId === ext.extractId ? ext : e));
          if (selected?.extractId === ext.extractId) setSelected(ext);
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [polling, selected, setExtracts]);

  async function handleGenerate() {
    (document.activeElement as HTMLElement | null)?.blur();
    setGenerating(true); setError(''); setSuccessMsg('');
    try {
      const { extractId } = await generateOfsB3Extract(academicYear);
      const ext = await getOfsB3Extract(extractId);
      setExtracts(prev => [ext, ...prev]);
      setSelected(ext);
      if (ext.statusCode === 'pending') setPolling(extractId);
      setSuccessMsg(`B3 extract for ${academicYear} generated successfully.`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate B3 extract');
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected.payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ofs-b3-${selected.extractId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Generate the OfS B3 student data extract for a given academic year. The extract can be
        downloaded as JSON for submission to the OfS data portal.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Academic year</label>
        <select
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus:outline-none"
        >
          {generating ? <span className="flex items-center gap-2"><Spinner />Generating…</span> : 'Generate extract'}
        </button>
      </div>

      {error      && <p className="text-sm text-red-600">{error}</p>}
      {successMsg && <p className="text-sm text-green-600">{successMsg}</p>}

      {extracts.length === 0 && !generating ? (
        <p className="text-sm text-gray-400">No extracts generated in this session.</p>
      ) : extracts.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Extract ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {extracts.map(e => (
                  <tr
                    key={e.extractId}
                    onClick={() => setSelected(selected?.extractId === e.extractId ? null : e)}
                    className={`cursor-pointer hover:bg-gray-50 ${selected?.extractId === e.extractId ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.extractId}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{e.academicYear ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{e.recordCount ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <Badge value={e.statusCode} />
                        {polling === e.extractId && <Spinner />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {e.generatedAt ? new Date(e.generatedAt).toLocaleString('en-GB') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Payload — {selected.academicYear} ({selected.recordCount} records)
                </h2>
                <button
                  onClick={handleDownload}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 focus:outline-none"
                >
                  Download JSON
                </button>
              </div>
              <pre className="bg-gray-50 rounded p-3 text-xs text-gray-700 overflow-auto max-h-96">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Participation Report tab ───────────────────────────────────────────────────

function ParticipationTab({
  reports, setReports,
}: {
  reports: ParticipationReport[];
  setReports: React.Dispatch<React.SetStateAction<ParticipationReport[]>>;
}) {
  const [academicYear, setAcademicYear] = useState(OFS_ACADEMIC_YEARS[0]!);
  const [generating,   setGenerating]   = useState(false);
  const [selected,     setSelected]     = useState<ParticipationReport | null>(null);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  async function handleGenerate() {
    (document.activeElement as HTMLElement | null)?.blur();
    setGenerating(true); setError(''); setSuccessMsg('');
    try {
      const result = await generateOfsParticipationReport(academicYear);
      const report: ParticipationReport = {
        extractId:   result.extractId,
        academicYear,
        recordCount: result.recordCount,
        generatedAt: new Date().toISOString(),
        payload:     result.payload,
      };
      setReports(prev => [report, ...prev]);
      setSelected(report);
      setSuccessMsg(`Participation report for ${academicYear} generated successfully.`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected.payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ofs-participation-${selected.extractId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Generate the OfS participation report for a given academic year. This report covers
        widening participation metrics and equality of opportunity data.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Academic year</label>
        <select
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus:outline-none"
        >
          {generating ? <span className="flex items-center gap-2"><Spinner />Generating…</span> : 'Generate report'}
        </button>
      </div>

      {error      && <p className="text-sm text-red-600">{error}</p>}
      {successMsg && <p className="text-sm text-green-600">{successMsg}</p>}

      {reports.length === 0 && !generating ? (
        <p className="text-sm text-gray-400">No reports generated in this session.</p>
      ) : reports.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Report ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reports.map(r => (
                  <tr
                    key={r.extractId}
                    onClick={() => setSelected(selected?.extractId === r.extractId ? null : r)}
                    className={`cursor-pointer hover:bg-gray-50 ${selected?.extractId === r.extractId ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.extractId}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{r.academicYear}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{r.recordCount}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(r.generatedAt).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Payload — {selected.academicYear} ({selected.recordCount} records)
                </h2>
                <button
                  onClick={handleDownload}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 focus:outline-none"
                >
                  Download JSON
                </button>
              </div>
              <pre className="bg-gray-50 rounded p-3 text-xs text-gray-700 overflow-auto max-h-96">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OfsPage() {
  const [tab,     setTab]     = useState<Tab>('b3');
  const [b3s,     setB3s]     = useState<OfsB3Extract[]>([]);
  const [reports, setReports] = useState<ParticipationReport[]>([]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Office for Students (OfS)</h1>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          {([
            { id: 'b3',            label: 'B3 Extract' },
            { id: 'participation', label: 'Participation Report' },
          ] as { id: Tab; label: string }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium border-b-2 focus:outline-none ${
                tab === t.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'b3'            && <B3Tab extracts={b3s} setExtracts={setB3s} />}
      {tab === 'participation' && <ParticipationTab reports={reports} setReports={setReports} />}
    </div>
  );
}
