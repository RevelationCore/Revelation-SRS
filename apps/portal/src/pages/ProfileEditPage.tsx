import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getProfile, patchIdentity } from '../api/me.js';
import { Spinner, Problem, Field } from '@revelation-srs/ui';

const schema = z.object({
  preferredName:   z.string().optional(),
  emailPersonal:   z.string().email({ message: 'Enter a valid email address.' }).or(z.literal('')).optional(),
  phoneMobile:     z.string().optional(),
  genderCode:      z.string().optional(),
  nationalityCode: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProfileEditPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const { personId } = useAuth();

  const fetchProfile = useCallback(
    () => personId ? getProfile(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: profile, loading, error } = useApiData(personId ? fetchProfile : null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!profile?.identity) return;
    reset({
      preferredName:   profile.identity.preferredName  ?? '',
      emailPersonal:   profile.identity.emailPersonal  ?? '',
      phoneMobile:     profile.identity.phoneMobile    ?? '',
      genderCode:      profile.identity.genderCode     ?? '',
      nationalityCode: profile.identity.nationalityCode ?? '',
    });
  }, [profile, reset]);

  const { submitting, submitError, submit } = useFormSubmit<void>();

  const onSubmit = async (data: FormValues) => {
    if (!personId) return;
    const result = await submit(() =>
      patchIdentity(personId, {
        preferredName:   data.preferredName   || null,
        emailPersonal:   data.emailPersonal   || null,
        phoneMobile:     data.phoneMobile     || null,
        genderCode:      data.genderCode      || null,
        nationalityCode: data.nationalityCode || null,
      }),
    );
    if (result !== undefined) navigate('/profile');
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.profile.editHeading')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('portal.profile.editSubheading')}</p>
      </div>

      {error     && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {/* Read-only identity fields — students cannot change legal name or institutional email */}
      {profile?.identity && (
        <section
          aria-labelledby="readonly-heading"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h2 id="readonly-heading" className="mb-1 text-sm font-semibold text-gray-700">
            {t('portal.profile.readOnlyFields')}
          </h2>
          <p className="mb-4 text-xs text-gray-500">{t('portal.profile.readOnlyNote')}</p>
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-gray-500">Legal first name</dt>
              <dd className="mt-0.5 text-gray-800">{profile.identity.legalFirstName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Legal family name</dt>
              <dd className="mt-0.5 text-gray-800">{profile.identity.legalFamilyName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Institutional email</dt>
              <dd className="mt-0.5 text-gray-800">{profile.identity.emailInstitutional ?? '—'}</dd>
            </div>
          </dl>
        </section>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-900">
            {t('portal.profile.editPersonalSection')}
          </h2>
          <Field
            label={t('portal.profile.preferredName')}
            registration={register('preferredName')}
            error={errors.preferredName}
          />
          <Field
            label={t('portal.profile.genderCode')}
            registration={register('genderCode')}
            error={errors.genderCode}
          />
          <Field
            label={t('portal.profile.nationalityCode')}
            registration={register('nationalityCode')}
            error={errors.nationalityCode}
          />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-900">
            {t('portal.profile.editContactSection')}
          </h2>
          <Field
            label={t('portal.profile.emailPersonal')}
            registration={register('emailPersonal')}
            error={errors.emailPersonal}
            type="email"
          />
          <Field
            label={t('portal.profile.phoneMobile')}
            registration={register('phoneMobile')}
            error={errors.phoneMobile}
            type="tel"
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {submitting
              ? <><Spinner size="sm" />{t('status.saving')}</>
              : t('actions.save')}
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
