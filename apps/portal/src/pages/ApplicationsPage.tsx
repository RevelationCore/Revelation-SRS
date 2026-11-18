import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Card, CardBody, EmptyState, PageHeader, Problem, Spinner } from '@revelation-srs/ui';

import { listApplications } from '../api/applications.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

/** An applicant's applications (Phase 5 D-39). */
export function ApplicationsPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const fetch = useCallback(() => (personId ? listApplications(personId) : Promise.reject(new Error(''))), [personId]);
  const { data, loading, error } = useApiData(personId ? fetch : null);

  return (
    <div>
      <PageHeader title={t('portal.applications.title')} description={t('portal.applications.intro')} />
      {loading && <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>}
      {error && <Problem title={t('status.error')} detail={error} />}
      {data && data.length === 0 && <EmptyState title={t('portal.applications.none')} description={t('portal.applications.noneDetail')} />}
      <div className="space-y-3">
        {data?.map((a) => (
          <Card key={a.applicationId}>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link to={`/applications/${a.applicationId}`} className="text-sm font-semibold text-primary-700 hover:underline">
                    {a.programme.title ?? a.programme.code ?? t('portal.applications.programmeTbc')}
                  </Link>
                  <p className="text-xs text-neutral-600">{[a.intakeCode, a.modeOfStudyCode, t(`portal.applications.channel.${a.channelCode}`, { defaultValue: a.channelCode })].filter(Boolean).join(' · ')}</p>
                </div>
                <Badge value={a.status} label={t(`portal.applications.status.${a.status}`, { defaultValue: a.status })} />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
