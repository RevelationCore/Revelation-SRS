import { useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import { getProfile, getAddresses, patchIdentity, getFieldValueSet, type ValueSetDto } from '../api/me.js';
import { Plus } from 'lucide-react';
import { Spinner, Problem, Field, PageHeader, Card, CardHeader, CardBody, Button } from '@revelation-srs/ui';

function codeLabel(vs: ValueSetDto | null | undefined, code: string | null | undefined): string {
  if (!code) return '—';
  if (!vs)   return code;
  return vs.members.find(m => m.code === code)?.displayLabel ?? code;
}

const schema = z.object({
  preferredName:    z.string().optional(),
  preferredPronouns: z.string().optional(),
  emailPersonal:    z.string().email({ message: 'Enter a valid email address.' }).or(z.literal('')).optional(),
  phoneMobile:      z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProfileEditPage() {
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const { personId } = useAuth();

  const fetchProfile   = useCallback(
    () => personId ? getProfile(personId)   : Promise.reject(new Error('')),
    [personId],
  );
  const fetchAddresses = useCallback(
    () => personId ? getAddresses(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const fetchGenderVS  = useCallback(() => getFieldValueSet('person_identity', 'gender_code').catch(() => undefined), []);
  const fetchNatVS     = useCallback(() => getFieldValueSet('person_identity', 'nationality_code').catch(() => undefined), []);

  const { data: profile,   loading, error } = useApiData(personId ? fetchProfile   : null);
  const { data: addresses                  } = useApiData(personId ? fetchAddresses : null);
  const { data: genderVS } = useApiData(fetchGenderVS);
  const { data: natVS    } = useApiData(fetchNatVS);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!profile?.identity) return;
    reset({
      preferredName:    profile.identity.preferredName    ?? '',
      preferredPronouns: profile.identity.preferredPronouns ?? '',
      emailPersonal:    profile.identity.emailPersonal    ?? '',
      phoneMobile:      profile.identity.phoneMobile      ?? '',
    });
  }, [profile, reset]);

  const { submitting, submitError, submit } = useFormSubmit<true>();

  const onSubmit = async (data: FormValues) => {
    if (!personId) return;
    const result = await submit(async () => {
      await patchIdentity(personId, {
        preferredName:    data.preferredName    || null,
        preferredPronouns: data.preferredPronouns || null,
        emailPersonal:    data.emailPersonal    || null,
        phoneMobile:      data.phoneMobile      || null,
      });
      return true as const;
    });
    if (result !== undefined) navigate('/profile');
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader title={t('portal.profile.editHeading')} description={t('portal.profile.editSubheading')} />

      {error     && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      <div className="space-y-6">
        {/* Read-only identity fields — students cannot change legal name or institutional email */}
        {profile?.identity && (
          <Card className="bg-neutral-50" aria-labelledby="readonly-heading">
            <CardBody>
              <h2 id="readonly-heading" className="mb-1 text-sm font-semibold text-neutral-700">
                {t('portal.profile.readOnlyFields')}
              </h2>
              <p className="mb-4 text-xs text-neutral-500">{t('portal.profile.readOnlyNote')}</p>
              <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Legal first name</dt>
                  <dd className="mt-0.5 text-neutral-800">{profile.identity.legalFirstName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Legal family name</dt>
                  <dd className="mt-0.5 text-neutral-800">{profile.identity.legalFamilyName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Institutional email</dt>
                  <dd className="mt-0.5 text-neutral-800">{profile.identity.emailInstitutional ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Gender</dt>
                  <dd className="mt-0.5 text-neutral-800">{codeLabel(genderVS, profile.identity.genderCode)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-neutral-500">Nationality</dt>
                  <dd className="mt-0.5 text-neutral-800">{codeLabel(natVS, profile.identity.nationalityCode)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <Card>
            <CardHeader title={t('portal.profile.editPersonalSection')} />
            <CardBody className="space-y-4">
              <Field
                label={t('portal.profile.preferredName')}
                registration={register('preferredName')}
                error={errors.preferredName}
              />
              <Field
                label="Preferred pronouns"
                registration={register('preferredPronouns')}
                error={errors.preferredPronouns}
                placeholder="e.g. they/them, she/her, he/him"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('portal.profile.editContactSection')} />
            <CardBody className="space-y-4">
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
            </CardBody>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting} icon={submitting ? <Spinner size="sm" /> : undefined}>
              {submitting ? t('status.saving') : t('actions.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/profile')}>
              {t('actions.cancel')}
            </Button>
          </div>
        </form>

        {/* Address management — outside the identity form */}
        <Card aria-labelledby="addresses-edit-heading">
          <CardHeader
            title="Addresses"
            actions={
              <Link to="/profile/addresses/new">
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>Add address</Button>
              </Link>
            }
          />
          <CardBody>
            {addresses && addresses.length > 0 ? (
              <div className="space-y-4">
                {addresses.map(addr => (
                  <div key={addr.id} className="border-t border-neutral-100 pt-4 first:border-0 first:pt-0 flex items-start justify-between gap-4">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                        {addr.addressTypeCode}
                      </p>
                      <address className="not-italic text-sm text-neutral-800 leading-relaxed">
                        {[addr.line1, addr.line2, addr.city, addr.postcode, addr.countryCode]
                          .filter(Boolean)
                          .join(', ')}
                      </address>
                    </div>
                    <Link
                      to="/profile/addresses/new"
                      state={{ existing: addr }}
                      className="shrink-0 text-sm text-primary-600 hover:underline"
                    >
                      Edit
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No addresses recorded.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
