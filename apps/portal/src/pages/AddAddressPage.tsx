import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { postAddress, getAddress, getFieldValueSet } from '../api/me.js';
import { Problem, Field, Spinner, PageHeader, Card, CardBody, Button, Select } from '@revelation-srs/ui';

const schema = z.object({
  addressTypeCode: z.string().min(1, 'Address type is required.'),
  line1:           z.string().min(1, 'Address line 1 is required.'),
  line2:           z.string().optional(),
  city:            z.string().optional(),
  postcode:        z.string().optional(),
  countryCode:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddAddressPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const { personId } = useAuth();
  const { addressId } = useParams<{ addressId?: string }>();
  const isEdit = addressId !== undefined;

  const fetchExisting = useCallback(
    () => (personId && addressId) ? getAddress(personId, addressId) : Promise.reject(new Error('')),
    [personId, addressId],
  );
  const { data: existing, loading: existingLoading, error: existingError } =
    useApiData(isEdit && personId && addressId ? fetchExisting : null);

  const fetchAddressTypes = useCallback(
    () => getFieldValueSet('student_address', 'address_type_code'),
    [],
  );
  const { data: addressTypeSet, loading: vsLoading } = useApiData(fetchAddressTypes);
  const addressTypes = addressTypeSet?.members ?? [];

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!existing) return;
    reset({
      addressTypeCode: existing.addressTypeCode,
      line1:           existing.line1,
      line2:           existing.line2    ?? '',
      city:            existing.city     ?? '',
      postcode:        existing.postcode ?? '',
      countryCode:     existing.countryCode ?? '',
    });
  }, [existing, reset]);

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
    if (result !== undefined) navigate('/profile', { state: { notice: isEdit ? 'Address updated.' : 'Address added.' } });
  };

  if (isEdit && existingLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }
  if (isEdit && existingError) {
    return <Problem title={t('status.error')} detail={existingError} />;
  }

  const heading    = isEdit ? 'Update address'     : t('portal.address.addHeading');
  const subheading = isEdit ? 'Change the details below and save to update this address.' : t('portal.address.addSubheading');
  const submitLabel = isEdit ? 'Update address' : t('portal.address.addButton');

  return (
    <div>
      <PageHeader title={heading} description={subheading} />

      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card>
          <CardBody className="space-y-4">
          {/* Address type */}
          <div className="space-y-1">
            <label htmlFor="addressTypeCode" className="block text-sm font-medium text-neutral-700">
              {t('portal.address.typeLabel')} <span className="text-danger-500" aria-hidden="true">*</span>
            </label>
            {vsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                <Spinner size="sm" /> Loading address types…
              </div>
            ) : isEdit ? (
              /* Lock type when editing — service upserts by type */
              <>
                <input type="hidden" {...register('addressTypeCode')} />
                <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                  {addressTypes.find(m => m.code === existing?.addressTypeCode)?.displayLabel
                    ?? existing?.addressTypeCode}
                </p>
              </>
            ) : (
              <Select
                id="addressTypeCode"
                aria-required="true"
                invalid={!!errors.addressTypeCode}
                {...register('addressTypeCode')}
              >
                <option value="">Select address type…</option>
                {addressTypes.map(({ code, displayLabel }) => (
                  <option key={code} value={code}>{displayLabel}</option>
                ))}
              </Select>
            )}
            {errors.addressTypeCode && (
              <p role="alert" className="text-xs text-danger-600">{errors.addressTypeCode.message}</p>
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
          </CardBody>
        </Card>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={submitting || vsLoading} icon={submitting ? <Spinner size="sm" /> : undefined}>
            {submitting ? t('status.saving') : submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/profile')}>
            {t('actions.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
