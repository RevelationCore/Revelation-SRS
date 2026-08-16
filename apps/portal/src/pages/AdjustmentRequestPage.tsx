import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, CardBody, Button, Select, Problem } from '@revelation-srs/ui';
import { useAuth } from '../auth/AuthContext.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { requestAdjustment } from '../api/adjustmentCases.js';

const ADJUSTMENT_TYPES = [
  { code: 'exam-time',  label: 'Extra time in exams' },
  { code: 'venue',      label: 'Alternative venue (e.g. separate room)' },
  { code: 'coursework', label: 'Coursework deadline extension' },
  { code: 'placement',  label: 'Placement adjustment' },
  { code: 'other',      label: 'Other' },
];

const schema = z.object({
  adjustmentTypeCode: z.string().min(1, 'Select the kind of adjustment you need.'),
  rationale:          z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AdjustmentRequestPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const navigate = useNavigate();
  const { submitting, submitError, submit } = useFormSubmit<{ id: string }>();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { adjustmentTypeCode: 'exam-time' },
  });

  const onSubmit = async (data: FormValues) => {
    if (!personId) return;
    const result = await submit(() => requestAdjustment({
      personId,
      adjustmentTypeCode: data.adjustmentTypeCode,
      ...(data.rationale?.trim() ? { rationale: data.rationale.trim() } : {}),
    }));
    if (result) navigate(`/adjustments/requests/${result.id}`, { state: { notice: 'Request submitted.' } });
  };

  return (
    <div>
      <PageHeader
        title="Request a reasonable adjustment"
        description="Tell us what adjustment you need and why. A disability adviser will follow up, and you can add supporting evidence (e.g. a medical letter or DSA award letter) once your request is open."
      />

      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card>
          <CardBody className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="adj-req-type" className="block text-sm font-medium text-neutral-700">
                What kind of adjustment do you need? <span className="text-danger-500" aria-hidden="true">*</span>
              </label>
              <Select id="adj-req-type" aria-required="true" invalid={!!errors.adjustmentTypeCode} {...register('adjustmentTypeCode')}>
                {ADJUSTMENT_TYPES.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </Select>
              {errors.adjustmentTypeCode && (
                <p role="alert" className="text-xs text-danger-600">{errors.adjustmentTypeCode.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="adj-req-rationale" className="block text-sm font-medium text-neutral-700">
                Tell us why you need this adjustment
              </label>
              <p className="text-xs text-neutral-500">
                Optional, but helps your adviser understand your request. You can add formal evidence after submitting.
              </p>
              <textarea
                id="adj-req-rationale"
                rows={4}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                {...register('rationale')}
              />
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? t('status.loading') : 'Submit request'}
            </Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
