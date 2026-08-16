import { type FormEvent, useCallback, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, CardHeader, CardBody, Button, Select, Spinner, Problem, Badge } from '@revelation-srs/ui';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getMyAdjustmentCase, deleteMyEvidence } from '../api/adjustmentCases.js';
import { uploadEvidence, downloadEvidence, ApiError } from '../api/wellbeingModule.js';

const STATUS_LABELS: Record<string, string> = {
  referral_received:  'Referral received',
  assessment_pending: 'Assessment pending',
  under_assessment:   'Being assessed',
  determination_made: 'Assessment complete',
  under_review:        'Under panel review',
  approved:            'Approved',
  rejected:            'Not approved',
  review_complete:     'Review complete',
  closed:              'Closed',
};

export function AdjustmentCaseDetailPage() {
  const { t } = useTranslation();
  const { caseId } = useParams<{ caseId: string }>();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchCase = useCallback(
    () => caseId ? getMyAdjustmentCase(caseId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is an intentional cache-buster after evidence upload/delete
    [caseId, refreshKey],
  );
  const { data: c, loading, error } = useApiData(caseId ? fetchCase : null);

  if (loading) return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  if (error || !c) return <Problem title={t('status.error')} detail={error ?? 'Request not found'} />;

  const isOpen = !['approved', 'rejected', 'closed'].includes(c.statusCode);

  return (
    <div>
      <PageHeader
        title="Your adjustment request"
        description={<span className="capitalize">{c.adjustmentTypeCode.replace(/-/g, ' ')}</span>}
        actions={<Badge value={c.statusCode} label={STATUS_LABELS[c.statusCode] ?? c.statusCode} />}
      />

      {notice && <p className="mb-4 text-sm text-success-700">{notice}</p>}

      <div className="space-y-6">
        <Card>
          <CardHeader title="Status" />
          <CardBody>
            <p className="text-sm text-neutral-700">
              {isOpen
                ? 'Your request is being reviewed. You can add supporting evidence below while it is open.'
                : c.statusCode === 'approved'
                  ? 'Your request has been approved. See your adjustments list for the confirmed details.'
                  : 'Your request has been closed.'}
            </p>
            {c.rationale && (
              <div className="mt-4">
                <p className="text-xs font-medium text-neutral-500">What you told us</p>
                <p className="mt-0.5 text-sm text-neutral-900 whitespace-pre-line">{c.rationale}</p>
              </div>
            )}
            {c.recommendedAdjustment && (
              <div className="mt-4">
                <p className="text-xs font-medium text-neutral-500">Recommended adjustment</p>
                <p className="mt-0.5 text-sm text-neutral-900">{c.recommendedAdjustment}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <EvidenceSection caseId={c.id} isOpen={isOpen} evidence={c.evidence} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>
    </div>
  );
}

function EvidenceSection({
  caseId, isOpen, evidence, onChanged,
}: {
  caseId: string;
  isOpen: boolean;
  evidence: Array<{ id: string; evidenceTypeCode: string; uploadedAt: string }>;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [evidenceTypeCode, setEvidenceTypeCode] = useState('medical-letter');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true); setError('');
    try {
      await uploadEvidence(caseId, file, evidenceTypeCode);
      setFile(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to upload evidence');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(evidenceId: string, hint: string) {
    setError('');
    try {
      const blob = await downloadEvidence(caseId, evidenceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = hint;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to download evidence');
    }
  }

  async function handleRemove(evidenceId: string) {
    setError('');
    try {
      await deleteMyEvidence(caseId, evidenceId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to remove evidence');
    }
  }

  return (
    <Card>
      <CardHeader title="Supporting evidence" description="A DSA medical letter, assessor report, or DSA award letter." />
      <CardBody>
        {error && <p className="mb-3 text-sm text-danger-600" role="alert">{error}</p>}

        {evidence.length === 0 ? (
          <p className="text-sm text-neutral-600">No evidence uploaded yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-neutral-100">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="capitalize">{e.evidenceTypeCode.replace(/-/g, ' ')}</span>
                <div className="flex gap-3">
                  <button type="button" onClick={() => void handleDownload(e.id, e.evidenceTypeCode)} className="text-primary-600 hover:underline">
                    Download
                  </button>
                  {isOpen && (
                    <button type="button" onClick={() => void handleRemove(e.id)} className="text-danger-600 hover:underline">
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {isOpen ? (
          <form onSubmit={(e) => void handleUpload(e)} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="portal-evidence-type" className="block text-sm font-medium text-neutral-700">Type</label>
              <Select id="portal-evidence-type" value={evidenceTypeCode} onChange={(e) => setEvidenceTypeCode(e.target.value)} className="w-auto">
                <option value="medical-letter">Medical letter</option>
                <option value="assessor-report">Assessor report</option>
                <option value="dsa-award-letter">DSA award letter</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="portal-evidence-file" className="block text-sm font-medium text-neutral-700">File</label>
              <input
                id="portal-evidence-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
              />
            </div>
            <Button type="submit" disabled={uploading || !file}>{uploading ? 'Uploading…' : 'Upload'}</Button>
          </form>
        ) : (
          <p className="text-xs text-neutral-500">This request is closed, so no further evidence can be added.</p>
        )}
      </CardBody>
    </Card>
  );
}
