import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getProfile, getEnrolments } from '../api/me.js';
import {
  Spinner, Problem, formatDate, getDisplayName,
  PageHeader, StatCard, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge,
} from '@revelation-srs/ui';

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
    <div>
      <PageHeader title={`${t('nav.home')}, ${displayName}`} description={formatDate(new Date())} />

      {error && <Problem title={t('status.error')} detail={error} />}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <StatCard label="Student number" value={profile?.studentNumber ?? '—'} />
        <StatCard label="Programme" value={currentEnrol?.programmeName ?? currentEnrol?.programmeCode ?? '—'} />
        <StatCard
          label="Enrolment status"
          value={currentEnrol
            ? t(`portal.enrolment.status.${currentEnrol.statusCode}`, { defaultValue: currentEnrol.statusCode })
            : '—'}
        />
        <StatCard label="Academic year" value={currentEnrol?.academicYearOfEntry ?? '—'} />
      </div>

      {/* Quick links */}
      <section aria-labelledby="quick-links-heading" className="mb-6">
        <h2 id="quick-links-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
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
          <h2 id="enrolments-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Enrolments
          </h2>
          <Card>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Programme</TableHeaderCell>
                  <TableHeaderCell>Academic year</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Mode</TableHeaderCell>
                  <TableHeaderCell>Start</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {enrolments.map(e => (
                  <TableRow key={e.enrolmentId}>
                    <TableCell className="text-neutral-900">
                      {e.programmeName ?? e.programmeCode ?? <span className="text-neutral-400">—</span>}
                    </TableCell>
                    <TableCell className="text-neutral-900">{e.academicYearOfEntry}</TableCell>
                    <TableCell>
                      <Badge value={e.statusCode} label={t(`portal.enrolment.status.${e.statusCode}`, { defaultValue: e.statusCode })} />
                    </TableCell>
                    <TableCell>{e.modeOfStudyCode}</TableCell>
                    <TableCell>{formatDate(e.startDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Link to="/enrolments" className="mt-2 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
            View all enrolments <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </section>
      )}
    </div>
  );
}

function QuickLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card hover:border-primary-300 hover:shadow-card-hover"
    >
      <div>
        <p className="text-sm font-medium text-neutral-900 group-hover:text-primary-700">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{desc}</p>
      </div>
      <ArrowRight className="ml-auto h-4 w-4 text-neutral-300 group-hover:text-primary-400" aria-hidden="true" />
    </Link>
  );
}
