import { type FormEvent, useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Problem, Spinner, StatusNotice } from '@revelation-srs/ui';

import { type ApplicantApplication, getApplication, respondToOffer, uploadConditionEvidence, withdrawApplication } from '../api/applications.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

/**
 * One application (Phase 5 D-39): its offer and conditions, and what the
 * applicant may do. UCAS applicants reply and withdraw in UCAS Hub.
 */
export function ApplicationDetailPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const { applicationId = '' } = useParams();
  const [override, setOverride] = useState<ApplicantApplication | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const fetch = useCallback(() => (personId ? getApplication(personId, applicationId) : Promise.reject(new Error(''))), [personId, applicationId]);
  const { data, loading, error } = useApiData(personId ? fetch : null);
  const app = override ?? data;

  /** Runs an action, then shows the application as it now stands. */
  async function act(run: () => Promise<unknown>) {
    if (!personId) return;
    setBusy(true); setActionError('');
    try {
      const result = await run();
      setOverride(result && typeof result === 'object' && 'applicationId' in result
        ? result as ApplicantApplication
        : await getApplication(personId, applicationId));
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.detail ?? err.message) : t('status.error'));
    } finally { setBusy(false); }
  }

  if (loading && !app) return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  if (error || !app || !personId) return <Problem title={t('status.error')} detail={error ?? ''} />;
  const offer = app.offer;
  const canAct = !app.respondElsewhere;

  return (
    <div>
      <PageHeader
        title={app.programme.title ?? app.programme.code ?? t('portal.applications.programmeTbc')}
        description={[app.intakeCode, app.modeOfStudyCode].filter(Boolean).join(' · ')}
        actions={<Link to="/applications" className="text-sm text-primary-600 hover:underline">{t('portal.applications.back')}</Link>}
      />
      <div className="mb-4 flex items-center gap-3">
        <Badge value={app.status} label={t(`portal.applications.status.${app.status}`, { defaultValue: app.status })} />
        {app.cas && <span className="text-xs text-neutral-600">{t('portal.applications.cas', { status: app.cas.statusCode })}{app.cas.casNumber ? ` (${app.cas.casNumber})` : ''}</span>}
      </div>
      {app.respondElsewhere && <StatusNotice>{t('portal.applications.ucasHub')}</StatusNotice>}
      {actionError && <p className="my-3 text-sm text-danger-600" role="alert">{actionError}</p>}

      {offer && (
        <Card className="mt-4">
          <CardHeader title={t('portal.applications.offerTitle', { type: t(`portal.applications.offerType.${offer.offerTypeCode}`, { defaultValue: offer.offerTypeCode }) })}
            description={offer.expiresOn ? t('portal.applications.expires', { date: offer.expiresOn }) : undefined} />
          <CardBody className="space-y-4">
            {offer.statusCode === 'made' && canAct && (
              <div className="flex gap-3">
                <Button disabled={busy} onClick={() => void act(() => respondToOffer(personId, offer.offerId, 'accept'))}>{t('portal.applications.accept')}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => void act(() => respondToOffer(personId, offer.offerId, 'decline'))}>{t('portal.applications.decline')}</Button>
              </div>
            )}
            {offer.responseCode && <p className="text-sm text-neutral-700">{t(`portal.applications.responded.${offer.responseCode}`)}</p>}
            {offer.conditions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-neutral-800">{t('portal.applications.conditions')}</h2>
                <ul className="mt-2 space-y-3">
                  {offer.conditions.map((c) => (
                    <li key={c.conditionId} className="rounded border border-neutral-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm">{c.description}{c.requiredValue ? ` (${c.requiredValue})` : ''}</span>
                        <Badge value={c.statusCode} label={t(`portal.applications.conditionStatus.${c.statusCode}`, { defaultValue: c.statusCode })} />
                      </div>
                      {c.evidence.map((e) => (
                        <p key={e.evidenceId} className="mt-1 text-xs text-neutral-600">
                          {t(e.verified ? 'portal.applications.evidenceVerified' : 'portal.applications.evidenceReceived', { date: new Date(e.receivedAt).toLocaleDateString('en-GB') })}
                        </p>
                      ))}
                      {c.statusCode === 'pending' && ['made', 'accepted'].includes(offer.statusCode) && (
                        <EvidenceUpload label={t('portal.applications.upload')} busy={busy}
                          onUpload={(file) => void act(() => uploadConditionEvidence(personId, c.conditionId, file))} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {app.confirmation && <p className="mt-4 text-sm text-neutral-700">{t(`portal.applications.confirmation.${app.confirmation.outcomeCode}`, { defaultValue: app.confirmation.outcomeCode })}</p>}

      {canAct && !['withdrawn', 'unsuccessful', 'confirmed', 'confirmed-alternative'].includes(app.status) && (
        <WithdrawControl busy={busy} onWithdraw={() => void act(() => withdrawApplication(personId, app.applicationId))} />
      )}
    </div>
  );
}

function EvidenceUpload({ label, busy, onUpload }: { label: string; busy: boolean; onUpload: (file: File) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const id = `evidence-${Math.random().toString(36).slice(2, 8)}`;
  function submit(e: FormEvent) { e.preventDefault(); if (file) onUpload(file); }
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={submit}>
      <label htmlFor={id} className="text-xs text-neutral-700">{t('portal.applications.chooseFile')}</label>
      <input id={id} type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Button size="sm" type="submit" disabled={!file || busy}>{label}</Button>
    </form>
  );
}

function WithdrawControl({ busy, onWithdraw }: { busy: boolean; onWithdraw: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-6">
      {confirming ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-sm text-neutral-700">{t('portal.applications.withdrawConfirm')}</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={onWithdraw}>{t('portal.applications.withdrawYes')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t('portal.applications.cancel')}</Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>{t('portal.applications.withdraw')}</Button>
      )}
    </div>
  );
}
