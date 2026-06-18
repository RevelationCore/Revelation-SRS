import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getProfile, getEnrolments } from '../api/me.js';
import { Spinner, Problem, formatDate, getDisplayName } from '@revelation-srs/ui';

export function DashboardPage() {
  const { t }  = useTranslation();
  const { user, personId } = useAuth();

  const fetchProfile    = useCallback(() => personId ? getProfile(personId)    : Promise.reject(new Error('Not authenticated')), [personId]);
  const fetchEnrolments = useCallback(() => personId ? getEnrolments(personId) : Promise.reject(new Error('Not authenticated')), [personId]);

  const { data: profile,    loading: pLoading, error: pError    } = useApiData(personId ? fetchProfile    : null);
  const { data: enrolments, loading: eLoading, error: eError    } = useApiData(personId ? fetchEnrolments : null);

  const loading = pLoading || eLoading;
  const error   = pError ?? eError;

  const displayName  = user ? getDisplayName(user) : t('status.loading');
  const activeEnrol  = enrolments?.find(e => e.statusCode === 'enrolled');
  const latestEnrol  = enrolments?.[0] ?? null;
  const currentEnrol = activeEnrol ?? latestEnrol;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" label={t('status.loading')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t('nav.home')}, {displayName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{formatDate(new Date())}</p>
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Student number"
          value={profile?.studentNumber ?? '—'}
        />
        <SummaryCard
          label="Enrolment status"
          value={currentEnrol
            ? t(`portal.enrolment.status.${currentEnrol.statusCode}`, { defaultValue: currentEnrol.statusCode })
            : '—'}
        />
        <SummaryCard
          label="Academic year"
          value={currentEnrol?.academicYearOfEntry ?? '—'}
        />
      </div>

      {/* Quick links */}
      <section aria-labelledby="quick-links-heading">
        <h2 id="quick-links-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Quick links
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink to="/modules"       label={t('portal.nav.modules')}       desc="View registered modules" />
          <QuickLink to="/timetable"     label={t('portal.nav.timetable')}     desc="Class schedule by period" />
          <QuickLink to="/exams"         label={t('portal.nav.exams')}         desc="Exam entries and candidate numbers" />
          <QuickLink to="/adjustments"   label={t('portal.nav.adjustments')}   desc="Approved learning support" />
          <QuickLink to="/circumstances" label={t('portal.nav.circumstances')} desc="Extenuating circumstances" />
          <QuickLink to="/profile"       label={t('portal.nav.profile')}       desc="Identity and contact details" />
        </div>
      </section>

      {/* Enrolments summary */}
      {enrolments && enrolments.length > 0 && (
        <section aria-labelledby="enrolments-heading">
          <h2 id="enrolments-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Enrolments
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase text-xs tracking-wide">Academic year</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase text-xs tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase text-xs tracking-wide">Mode</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase text-xs tracking-wide">Start</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {enrolments.map(e => (
                  <tr key={e.enrolmentId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{e.academicYearOfEntry}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColour(e.statusCode)}`}>
                        {t(`portal.enrolment.status.${e.statusCode}`, { defaultValue: e.statusCode })}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{e.modeOfStudyCode}</td>
                    <td className="px-4 py-2.5 text-gray-600">{formatDate(e.startDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/enrolments" className="mt-2 block text-sm text-indigo-600 hover:underline">
            View all enrolments →
          </Link>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function QuickLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow"
    >
      <div>
        <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
      </div>
      <span className="ml-auto text-gray-300 group-hover:text-indigo-400" aria-hidden>→</span>
    </Link>
  );
}

function statusColour(code: string): string {
  const map: Record<string, string> = {
    enrolled:     'bg-green-100 text-green-700',
    intermitting: 'bg-yellow-100 text-yellow-700',
    suspended:    'bg-orange-100 text-orange-700',
    withdrawn:    'bg-red-100 text-red-700',
    graduated:    'bg-blue-100 text-blue-700',
  };
  return map[code] ?? 'bg-gray-100 text-gray-700';
}
