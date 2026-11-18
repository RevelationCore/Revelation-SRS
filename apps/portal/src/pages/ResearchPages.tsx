import { type FormEvent, useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Problem, Select, Spinner, StatusNotice,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { getFieldValueSet } from '../api/me.js';
import {
  declareExaminerConflict, declareReviewConflict, downloadFile, getAssignments, getExamination, getPanelReview, getSupervisee,
  reviewEvidencePath, submitExaminerReport, submitSupervisorReport, thesisPath,
} from '../api/research.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

/**
 * Research staff self-service (Phase 5 D-40): a supervisor's research
 * students, the progress reviews a person sits on, and the examinations
 * they examine. Everything is scoped by the API to their own assignments.
 */

const Loading = () => {
  const { t } = useTranslation();
  return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
};

function useResearch<T>(load: (personId: string) => Promise<T>, deps: unknown[]) {
  const { personId } = useAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetch = useCallback(() => (personId ? load(personId) : Promise.reject(new Error(''))), [personId, ...deps]);
  return { personId, ...useApiData(personId ? fetch : null) };
}

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? (err.detail ?? err.message) : fallback);

export function ResearchPage() {
  const { t } = useTranslation();
  const { data, loading, error } = useResearch(getAssignments, []);
  if (loading && !data) return <Loading />;
  const empty = data && data.supervisees.length + data.panels.length + data.examinations.length === 0;
  return (
    <div>
      <PageHeader title={t('portal.research.title')} description={t('portal.research.intro')} />
      {error && <Problem title={t('status.error')} detail={error} />}
      {empty && <EmptyState title={t('portal.research.none')} description={t('portal.research.noneDetail')} />}
      {data && data.supervisees.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={t('portal.research.students')} />
          <CardBody>
            <ul className="space-y-2">
              {data.supervisees.map((s) => (
                <li key={s.enrolmentId} className="text-sm">
                  <Link to={`/research/students/${s.enrolmentId}`} className="font-medium text-primary-700 hover:underline">{s.studentName ?? s.enrolmentId}</Link>
                  <span className="ml-2 text-xs text-neutral-600">{[s.programme, t(`portal.research.supervisorRole.${s.role}`, { defaultValue: s.role })].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {data && data.panels.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={t('portal.research.panels')} />
          <CardBody>
            <ul className="space-y-2">
              {data.panels.map((p) => (
                <li key={p.reviewId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/research/reviews/${p.reviewId}`} className="font-medium text-primary-700 hover:underline">{p.studentName ?? p.reviewId}</Link>
                  <span className="text-xs text-neutral-600">{p.reviewTypeCode}</span>
                  <Badge value={p.statusCode} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {data && data.examinations.length > 0 && (
        <Card>
          <CardHeader title={t('portal.research.examinations')} />
          <CardBody>
            <ul className="space-y-2">
              {data.examinations.map((e) => (
                <li key={e.examinationCaseId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/research/examinations/${e.examinationCaseId}`} className="font-medium text-primary-700 hover:underline">{e.studentName ?? e.examinationCaseId}</Link>
                  <span className="text-xs text-neutral-600">{t(`portal.research.examinerRole.${e.examinerRoleCode}`, { defaultValue: e.examinerRoleCode })}</span>
                  <Badge value={e.reportSubmitted ? 'approved' : 'pending'} label={t(e.reportSubmitted ? 'portal.research.reportIn' : 'portal.research.reportDue')} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function SuperviseePage() {
  const { t } = useTranslation();
  const { enrolmentId = '' } = useParams();
  const { personId, data, loading, error } = useResearch((p) => getSupervisee(p, enrolmentId), [enrolmentId]);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  if (loading && !data) return <Loading />;
  if (error || !data || !personId) return <Problem title={t('status.error')} detail={error ?? ''} />;
  return (
    <div>
      <PageHeader title={data.studentName ?? t('portal.research.student')} description={data.programme ?? undefined}
        actions={<Link to="/research" className="text-sm text-primary-600 hover:underline">{t('portal.research.back')}</Link>} />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      {actionError && <p className="my-2 text-sm text-danger-600" role="alert">{actionError}</p>}
      <Card className="mb-4">
        <CardHeader title={t('portal.research.team')} />
        <CardBody>
          <ul className="space-y-1 text-sm">{data.team.map((m, i) => <li key={i}>{m.name} <span className="text-xs text-neutral-600">({t(`portal.research.supervisorRole.${m.roleDetailCode}`, { defaultValue: m.roleDetailCode })})</span></li>)}</ul>
        </CardBody>
      </Card>
      <Card className="mb-4">
        <CardHeader title={t('portal.research.reviews')} />
        <CardBody className="space-y-3">
          {data.progressReviews.length === 0 && <p className="text-sm text-neutral-600">{t('portal.research.noReviews')}</p>}
          {data.progressReviews.map((r) => (
            <div key={r.reviewId} className="rounded border border-neutral-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>{r.reviewTypeCode}</span><Badge value={r.statusCode} />
                {r.outcomeCode && <span className="text-xs text-neutral-600">{t('portal.research.outcome', { outcome: r.outcomeCode })}</span>}
              </div>
              {r.statusCode === 'open' && (
                <FileForm label={t('portal.research.supervisorReport')} onSubmit={async (file) => {
                  setActionError(''); setNotice('');
                  try { await submitSupervisorReport(personId, r.reviewId, file); setNotice(t('portal.research.reportSent')); }
                  catch (err) { setActionError(message(err, t('status.error'))); }
                }} />
              )}
            </div>
          ))}
        </CardBody>
      </Card>
      {data.milestones.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={t('portal.research.milestones')} />
          <CardBody><ul className="space-y-1 text-sm">{data.milestones.map((m, i) => <li key={i}>{m.milestoneTypeCode}: {m.achievedDate}</li>)}</ul></CardBody>
        </Card>
      )}
      {data.examinations.map((e) => (
        <Card key={e.examinationCaseId} className="mb-4">
          <CardHeader title={t('portal.research.examination')} description={e.ratifiedOutcomeCode ? t('portal.research.outcome', { outcome: e.ratifiedOutcomeCode }) : undefined} />
          <CardBody className="text-sm">
            <p>{t('portal.research.examiners')}: {e.examiners.map((x) => `${x.name ?? '?'} (${t(`portal.research.examinerRole.${x.examinerRoleCode}`, { defaultValue: x.examinerRoleCode })})`).join(', ') || '—'}</p>
            {e.correctionDeadlines.map((c, i) => <p key={i} className="text-xs text-neutral-600">{t(c.completed ? 'portal.research.correctionsDone' : 'portal.research.correctionsDue', { date: c.deadlineDate })}</p>)}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function PanelReviewPage() {
  const { t } = useTranslation();
  const { reviewId = '' } = useParams();
  const { personId, data, loading, error } = useResearch((p) => getPanelReview(p, reviewId), [reviewId]);
  const [actionError, setActionError] = useState('');
  if (loading && !data) return <Loading />;
  if (error || !data || !personId) return <Problem title={t('status.error')} detail={error ?? ''} />;
  return (
    <div>
      <PageHeader title={data.studentName ?? t('portal.research.student')} description={`${data.reviewTypeCode} · ${data.role}`}
        actions={<Link to="/research" className="text-sm text-primary-600 hover:underline">{t('portal.research.back')}</Link>} />
      {actionError && <p className="my-2 text-sm text-danger-600" role="alert">{actionError}</p>}
      <Card className="mb-4">
        <CardHeader title={t('portal.research.evidence')} />
        <CardBody>
          {data.evidence.length === 0 && <p className="text-sm text-neutral-600">{t('portal.research.noEvidence')}</p>}
          <ul className="space-y-2 text-sm">
            {data.evidence.map((e) => (
              <li key={e.evidenceId} className="flex flex-wrap items-center gap-2">
                <span>{e.sourceSystem}</span>
                <span className="text-xs text-neutral-600">{new Date(e.receivedAt).toLocaleDateString('en-GB')}</span>
                {e.downloadable && (
                  <Button size="sm" variant="secondary" onClick={() => void downloadFile(reviewEvidencePath(personId, reviewId, e.evidenceId), `evidence-${e.evidenceId.slice(0, 8)}`).catch((err: unknown) => setActionError(message(err, t('status.error'))))}>
                    {t('portal.research.download')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <ConflictForm onDeclare={(code) => declareReviewConflict(personId, data.memberId, code)} />
    </div>
  );
}

export function ExaminationPage() {
  const { t } = useTranslation();
  const { caseId = '' } = useParams();
  const [version, setVersion] = useState(0);
  const { personId, data, loading, error } = useResearch((p) => getExamination(p, caseId), [caseId, version]);
  const fetchCodes = useCallback(() => getFieldValueSet('examiner_report', 'recommendation_code'), []);
  const { data: codes } = useApiData(fetchCodes);
  const [recommendation, setRecommendation] = useState('');
  const [actionError, setActionError] = useState('');
  if (loading && !data) return <Loading />;
  if (error || !data || !personId) return <Problem title={t('status.error')} detail={error ?? ''} />;
  return (
    <div>
      <PageHeader title={data.studentName ?? t('portal.research.student')}
        description={t(`portal.research.examinerRole.${data.appointment.examinerRoleCode}`, { defaultValue: data.appointment.examinerRoleCode })}
        actions={<Link to="/research" className="text-sm text-primary-600 hover:underline">{t('portal.research.back')}</Link>} />
      {actionError && <p className="my-2 text-sm text-danger-600" role="alert">{actionError}</p>}
      {!data.appointment.confirmed && <StatusNotice>{t('portal.research.notConfirmed')}</StatusNotice>}
      {data.thesis && (
        <Card className="mb-4">
          <CardHeader title={t('portal.research.thesis', { version: data.thesis.versionNumber })} />
          <CardBody className="text-sm">
            {data.thesis.downloadable
              ? <Button size="sm" variant="secondary" onClick={() => void downloadFile(thesisPath(personId, caseId), 'thesis').catch((err: unknown) => setActionError(message(err, t('status.error'))))}>{t('portal.research.download')}</Button>
              : <p className="text-neutral-600">{t('portal.research.thesisElsewhere', { ref: data.thesis.storageRef })}</p>}
          </CardBody>
        </Card>
      )}
      <Card className="mb-4">
        <CardHeader title={t('portal.research.yourReport')} description={t('portal.research.coExaminers', { names: data.coExaminers.map((c) => c.name).join(', ') || '—' })} />
        <CardBody className="space-y-3 text-sm">
          {data.ownReport ? (
            <p>{t('portal.research.reportSubmitted', { date: new Date(data.ownReport.submittedAt).toLocaleDateString('en-GB') })}</p>
          ) : data.appointment.confirmed && data.statusCode === 'examiners-confirmed' ? (
            <>
              <label htmlFor="exam-recommendation" className="block text-xs text-neutral-700">{t('portal.research.recommendation')}</label>
              <Select id="exam-recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)} className="w-auto">
                <option value="">{t('portal.research.noRecommendation')}</option>
                {codes?.members.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
              </Select>
              <FileForm label={t('portal.research.submitReport')} onSubmit={async (file) => {
                setActionError('');
                try { await submitExaminerReport(personId, caseId, file, recommendation); setVersion((v) => v + 1); }
                catch (err) { setActionError(message(err, t('status.error'))); }
              }} />
            </>
          ) : null}
          {data.otherReports === null
            ? <p className="text-xs text-neutral-600">{t('portal.research.othersHidden')}</p>
            : data.otherReports.map((r, i) => <p key={i} className="text-xs">{t('portal.research.otherReport', { recommendation: r.recommendationCode ?? '—' })}</p>)}
        </CardBody>
      </Card>
      <ConflictForm onDeclare={(code) => declareExaminerConflict(personId, caseId, data.appointment.appointmentId, code)} />
    </div>
  );
}

function FileForm({ label, onSubmit }: { label: string; onSubmit: (file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `file-${label.replace(/\W+/g, '-').toLowerCase()}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try { await onSubmit(file); } finally { setBusy(false); }
  }
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => void submit(e)}>
      <label htmlFor={id} className="text-xs text-neutral-700">{label}</label>
      <input id={id} type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Button size="sm" type="submit" disabled={!file || busy}>{label}</Button>
    </form>
  );
}

function ConflictForm({ onDeclare }: { onDeclare: (code: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const fetchCodes = useCallback(() => getFieldValueSet('board_member_conflict', 'conflict_type_code'), []);
  const { data: codes } = useApiData(fetchCodes);
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'done' | string>('idle');
  return (
    <Card>
      <CardHeader title={t('portal.research.conflict')} description={t('portal.research.conflictIntro')} />
      <CardBody>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!code) return;
          void onDeclare(code).then(() => setState('done')).catch((err: unknown) => setState(message(err, t('status.error'))));
        }}>
          <label htmlFor="conflict-type" className="text-xs text-neutral-700">{t('portal.research.conflictType')}</label>
          <Select id="conflict-type" value={code} onChange={(e) => setCode(e.target.value)} className="w-auto">
            <option value="">—</option>
            {codes?.members.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
          </Select>
          <Button size="sm" type="submit" disabled={!code}>{t('portal.research.declare')}</Button>
        </form>
        {state === 'done' && <p className="mt-2 text-xs text-success-700">{t('portal.research.declared')}</p>}
        {state !== 'idle' && state !== 'done' && <p className="mt-2 text-xs text-danger-600" role="alert">{state}</p>}
      </CardBody>
    </Card>
  );
}
