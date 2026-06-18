import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Field, formatDate, formatNumber } from '@revelation-srs/ui';

const quickSearchSchema = z.object({
  query: z.string().min(1, 'Enter a search term.').max(200),
});

type QuickSearchForm = z.infer<typeof quickSearchSchema>;

export function DashboardPage() {
  const { t } = useTranslation();

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

  const today    = formatDate(new Date());
  const enrolled = formatNumber(0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">{today}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Enrolled students" value={enrolled} />
        <StatCard label="Pending tasks"     value="—" />
        <StatCard label="Active workflows"  value="—" />
      </div>

      <section
        aria-labelledby="quick-search-heading"
        className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm max-w-md"
      >
        <h2 id="quick-search-heading" className="mb-4 text-base font-medium text-gray-700">
          Quick student search
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Field
            label="Student number or name"
            registration={register('query')}
            error={errors.query}
            required
            placeholder="e.g. STU-0001 or Smith"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? t('status.loading') : t('actions.view')}
          </button>
        </form>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
