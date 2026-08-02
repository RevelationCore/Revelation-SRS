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
import {
  PageHeader, Button, Select, Card, CardBody, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

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
      <p className="text-sm text-neutral-500">
        Generate the OfS B3 student data extract for a given academic year. The extract can be
        downloaded as JSON for submission to the OfS data portal.
      </p>

      <div className="flex items-center gap-3">
        <label htmlFor="ofs-b3-academic-year" className="text-sm font-medium text-neutral-700">Academic year</label>
        <Select
          id="ofs-b3-academic-year"
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="w-auto"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Button onClick={() => void handleGenerate()} disabled={generating} icon={generating ? <Spinner /> : undefined}>
          {generating ? 'Generating…' : 'Generate extract'}
        </Button>
      </div>

      {error      && <p className="text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="text-sm text-success-600">{successMsg}</p>}

      {extracts.length === 0 && !generating ? (
        <p className="text-sm text-neutral-600">No extracts generated in this session.</p>
      ) : extracts.length > 0 && (
        <div className="space-y-4">
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Extract ID</TableHeaderCell>
                  <TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Records</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {extracts.map(e => (
                  <TableRow
                    key={e.extractId}
                    onClick={() => setSelected(selected?.extractId === e.extractId ? null : e)}
                    className={`cursor-pointer ${selected?.extractId === e.extractId ? 'bg-primary-50' : ''}`}
                  >
                    <TableCell className="font-mono text-xs text-neutral-700">{e.extractId}</TableCell>
                    <TableCell className="text-xs">{e.academicYear ?? '—'}</TableCell>
                    <TableCell className="text-xs">{e.recordCount ?? '—'}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Badge value={e.statusCode} />
                        {polling === e.extractId && <Spinner />}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {e.generatedAt ? new Date(e.generatedAt).toLocaleString('en-GB') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {selected && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    Payload — {selected.academicYear} ({selected.recordCount} records)
                  </h2>
                  <Button variant="secondary" size="sm" onClick={handleDownload}>Download JSON</Button>
                </div>
                <pre className="bg-neutral-50 rounded p-3 text-xs text-neutral-700 overflow-auto max-h-96">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </CardBody>
            </Card>
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
      <p className="text-sm text-neutral-500">
        Generate the OfS participation report for a given academic year. This report covers
        widening participation metrics and equality of opportunity data.
      </p>

      <div className="flex items-center gap-3">
        <label htmlFor="ofs-participation-academic-year" className="text-sm font-medium text-neutral-700">Academic year</label>
        <Select
          id="ofs-participation-academic-year"
          value={academicYear}
          onChange={e => setAcademicYear(e.target.value)}
          className="w-auto"
        >
          {OFS_ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Button onClick={() => void handleGenerate()} disabled={generating} icon={generating ? <Spinner /> : undefined}>
          {generating ? 'Generating…' : 'Generate report'}
        </Button>
      </div>

      {error      && <p className="text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="text-sm text-success-600">{successMsg}</p>}

      {reports.length === 0 && !generating ? (
        <p className="text-sm text-neutral-600">No reports generated in this session.</p>
      ) : reports.length > 0 && (
        <div className="space-y-4">
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Report ID</TableHeaderCell>
                  <TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Records</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {reports.map(r => (
                  <TableRow
                    key={r.extractId}
                    onClick={() => setSelected(selected?.extractId === r.extractId ? null : r)}
                    className={`cursor-pointer ${selected?.extractId === r.extractId ? 'bg-primary-50' : ''}`}
                  >
                    <TableCell className="font-mono text-xs text-neutral-700">{r.extractId}</TableCell>
                    <TableCell className="text-xs">{r.academicYear}</TableCell>
                    <TableCell className="text-xs">{r.recordCount}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(r.generatedAt).toLocaleString('en-GB')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {selected && (
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-neutral-700">
                    Payload — {selected.academicYear} ({selected.recordCount} records)
                  </h2>
                  <Button variant="secondary" size="sm" onClick={handleDownload}>Download JSON</Button>
                </div>
                <pre className="bg-neutral-50 rounded p-3 text-xs text-neutral-700 overflow-auto max-h-96">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </CardBody>
            </Card>
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
      <PageHeader title="Office for Students (OfS)" />

      <div className="border-b border-neutral-200 mb-6">
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
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
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
