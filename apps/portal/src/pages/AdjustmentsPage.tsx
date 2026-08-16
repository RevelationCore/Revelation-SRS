import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getEnrolments, getAdjustments, getFieldValueSet, downloadAdjustmentOutcomeDocument } from '../api/me.js';
import { ApiError } from '../api/client.js';
import { listMyAdjustmentCases, type AdjustmentCase } from '../api/adjustmentCases.js';
import { Spinner, Problem, EmptyState, formatDate, PageHeader, Card, CardBody, Button, Badge } from '@revelation-srs/ui';

const REQUEST_STATUS_LABELS: Record<string, string> = {
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

export function AdjustmentsPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);

  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchAdjustments = useCallback(
    () => personId ? getAdjustments(personId, currentEnrolment?.enrolmentId) : Promise.reject(new Error('')),
    [personId, currentEnrolment?.enrolmentId],
  );
  const { data: adjustments, loading: aLoading, error: aError } = useApiData(
    personId ? fetchAdjustments : null,
  );

  const fetchMyCases = useCallback(
    () => personId ? listMyAdjustmentCases(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: myCases, loading: casesLoading } = useApiData(personId ? fetchMyCases : null);
  const openCases = myCases?.items.filter((c) => !['approved', 'rejected', 'closed'].includes(c.statusCode)) ?? [];

  const fetchTypeSet  = useCallback(() => getFieldValueSet('reasonable_adjustment', 'adjustment_type_code'), []);
  const fetchScopeSet = useCallback(() => getFieldValueSet('reasonable_adjustment', 'scope_code'), []);
  const { data: typeSet  } = useApiData(fetchTypeSet);
  const { data: scopeSet } = useApiData(fetchScopeSet);

  const typeLabel  = (code: string) => typeSet?.members.find(m => m.code === code)?.displayLabel  ?? code;
  const scopeLabel = (code: string) => scopeSet?.members.find(m => m.code === code)?.displayLabel ?? code;

  const loading = eLoading || aLoading;
  const error   = eError ?? aError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.nav.adjustments')}
        description="Your learning support adjustments and reasonable adjustments"
        actions={<Link to="/adjustments/request"><Button>Request an adjustment</Button></Link>}
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-600">My adjustment requests</h2>
        {casesLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : openCases.length === 0 ? (
          <p className="text-sm text-neutral-600">You have no open adjustment requests.</p>
        ) : (
          <div className="space-y-3">
            {openCases.map((c: AdjustmentCase) => (
              <Link
                key={c.id}
                to={`/adjustments/requests/${c.id}`}
                className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-4 py-3 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
              >
                <span className="text-sm font-medium capitalize text-neutral-900">{c.adjustmentTypeCode.replace(/-/g, ' ')}</span>
                <Badge value={c.statusCode} label={REQUEST_STATUS_LABELS[c.statusCode] ?? c.statusCode} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-600">Approved and in effect</h2>

      {error && <Problem title={t('status.error')} detail={error} />}

      {!error && adjustments?.length === 0 && (
        <EmptyState title="No adjustments are recorded against your account." />
      )}

      {adjustments && adjustments.length > 0 && (
        <div className="space-y-4">
          {adjustments.map(adj => (
            <Card key={adj.adjustmentId} aria-labelledby={`adj-${adj.adjustmentId}`}>
              <CardBody>
              <div className="flex items-start justify-between gap-4">
                <h2 id={`adj-${adj.adjustmentId}`} className="text-base font-semibold text-neutral-900">
                  {typeLabel(adj.adjustmentTypeCode)}
                </h2>
                <span className="flex-none rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  {scopeLabel(adj.scopeCode)}
                </span>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Valid from</dt>
                  <dd className="mt-0.5 text-neutral-900">{formatDate(adj.validFrom)}</dd>
                </div>
                {adj.validTo && (
                  <div>
                    <dt className="text-xs font-medium text-neutral-500">Valid to</dt>
                    <dd className="mt-0.5 text-neutral-900">{formatDate(adj.validTo)}</dd>
                  </div>
                )}
                {adj.notes && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs font-medium text-neutral-500">Notes</dt>
                    <dd className="mt-0.5 text-neutral-900 whitespace-pre-line">{adj.notes}</dd>
                  </div>
                )}
                {adj.outcomeDocumentId && (
                  <div className="sm:col-span-3">
                    <dt className="text-xs font-medium text-neutral-500">Detail document</dt>
                    <dd className="mt-0.5">
                      <OutcomeDocumentDownloadLink personId={adj.personId} adjustmentId={adj.adjustmentId} />
                    </dd>
                  </div>
                )}
              </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeDocumentDownloadLink({ personId, adjustmentId }: { personId: string; adjustmentId: string }) {
  const [error, setError] = useState('');

  async function handleDownload() {
    setError('');
    try {
      const blob = await downloadAdjustmentOutcomeDocument(personId, adjustmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adjustment-detail-${adjustmentId.slice(0, 8)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to download document');
    }
  }

  return (
    <>
      <button type="button" onClick={() => void handleDownload()} className="text-sm text-primary-600 hover:underline">
        Download detail document
      </button>
      {error && <span className="ml-2 text-xs text-danger-600">{error}</span>}
    </>
  );
}
