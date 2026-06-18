import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { postAddress } from '../api/me.js';
import { Problem, Field, Spinner } from '@revelation-srs/ui';

const schema = z.object({
  addressTypeCode: z.string().min(1, 'Address type is required.'),
  line1:           z.string().min(1, 'Address line 1 is required.'),
  line2:           z.string().optional(),
  city:            z.string().optional(),
  postcode:        z.string().optional(),
  countryCode:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const ADDRESS_TYPES = ['home', 'term-time', 'correspondence', 'next-of-kin'];

export function AddAddressPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const { personId } = useAuth();

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { addressTypeCode: 'home' },
  });

  const { submitting, submitError, submit } = useFormSubmit<{ addressId: string }>();

  const onSubmit = async (data: FormValues) => {
    if (!personId) return;
    const result = await submit(() =>
      postAddress(personId, {
        addressTypeCode: data.addressTypeCode,
        line1:           data.line1,
        line2:           data.line2 || null,
        city:            data.city || null,
        postcode:        data.postcode || null,
        countryCode:     data.countryCode || null,
      }),
    );
    if (result !== undefined) navigate('/profile');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.address.addHeading')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('portal.address.addSubheading')}</p>
      </div>

      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          {/* Address type selector */}
          <div className="space-y-1">
            <label htmlFor="addressTypeCode" className="block text-sm font-medium text-gray-700">
              {t('portal.address.typeLabel')} <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <select
              id="addressTypeCode"
              aria-required="true"
              aria-invalid={errors.addressTypeCode ? 'true' : undefined}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              {...register('addressTypeCode')}
            >
              {ADDRESS_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {errors.addressTypeCode && (
              <p role="alert" className="text-xs text-red-600">{errors.addressTypeCode.message}</p>
            )}
          </div>

          <Field
            label={`${t('portal.address.line1')} *`}
            registration={register('line1')}
            error={errors.line1}
            required
          />
          <Field
            label={t('portal.address.line2')}
            registration={register('line2')}
            error={errors.line2}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('portal.address.city')}
              registration={register('city')}
              error={errors.city}
            />
            <Field
              label={t('portal.address.postcode')}
              registration={register('postcode')}
              error={errors.postcode}
            />
          </div>
          <Field
            label={t('portal.address.countryCode')}
            registration={register('countryCode')}
            error={errors.countryCode}
          />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {submitting
              ? <><Spinner size="sm" />{t('status.saving')}</>
              : t('portal.address.addButton')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {t('actions.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
