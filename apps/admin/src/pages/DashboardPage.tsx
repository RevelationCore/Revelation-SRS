import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Field, formatDate, formatNumber, PageHeader, StatCard, Card, CardHeader, CardBody, Button } from '@revelation-srs/ui';
import { getEnrolmentVolumes } from '../api/reporting.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

const quickSearchSchema = z.object({
  query: z.string().min(1, 'Enter a search term.').max(200),
});

type QuickSearchForm = z.infer<typeof quickSearchSchema>;

export function DashboardPage() {
  const { t } = useTranslation();
  const { roles } = useAuth();
  const canReadEnrolmentReporting = userHasAnyPermission(roles, ['enrolment:read:all']);
  const canSearchStudents = userHasAnyPermission(roles, ['student:read:all']);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<QuickSearchForm>({
    resolver: zodResolver(quickSearchSchema),
  });

  function onSubmit(_data: QuickSearchForm) {
    // Stub — full search wired in Stage 5a
  }

  const today = formatDate(new Date());
  const [enrolledCount, setEnrolledCount] = useState<number | null>(null);

  useEffect(() => {
    if (!canReadEnrolmentReporting) return;
    getEnrolmentVolumes()
      .then(v => setEnrolledCount(v.byStatus['enrolled'] ?? v.total))
      .catch(() => { /* leave as null — shown as — */ });
  }, [canReadEnrolmentReporting]);

  const enrolled = enrolledCount === null ? '—' : formatNumber(enrolledCount);

  return (
    <div>
      <PageHeader title="Dashboard" description={today} />

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        {canReadEnrolmentReporting && <StatCard label="Enrolled students" value={enrolled} />}
        <StatCard label="Pending tasks"     value="—" />
        <StatCard label="Active workflows"  value="—" />
      </div>

      {canSearchStudents && (
        <Card className="max-w-md" aria-labelledby="quick-search-heading">
          <CardHeader title="Quick student search" />
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
              <Field
                label="Student number or name"
                registration={register('query')}
                error={errors.query}
                required
                placeholder="e.g. STU-0001 or Smith"
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('status.loading') : t('actions.view')}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
