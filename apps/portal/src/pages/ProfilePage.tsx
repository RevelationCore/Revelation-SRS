import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getProfile, getAddresses, getFieldValueSet, type ValueSetDto } from '../api/me.js';
import { Spinner, Problem, formatDate, PageHeader, Card, CardHeader, CardBody, Button } from '@revelation-srs/ui';

function codeLabel(vs: ValueSetDto | null | undefined, code: string | null | undefined): string | null | undefined {
  if (!code) return code;
  if (!vs)   return code;
  return vs.members.find(m => m.code === code)?.displayLabel ?? code;
}

export function ProfilePage() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const { personId } = useAuth();

  const fetchProfile   = useCallback(() => personId ? getProfile(personId)   : Promise.reject(new Error('')), [personId]);
  const fetchAddresses = useCallback(() => personId ? getAddresses(personId) : Promise.reject(new Error('')), [personId]);
  const fetchGenderVS  = useCallback(() => getFieldValueSet('person_identity', 'gender_code').catch(() => undefined), []);
  const fetchNatVS     = useCallback(() => getFieldValueSet('person_identity', 'nationality_code').catch(() => undefined), []);

  const { data: profile,   loading: pLoading, error: pError } = useApiData(personId ? fetchProfile   : null);
  const { data: addresses, loading: aLoading, error: aError } = useApiData(personId ? fetchAddresses : null);
  const { data: genderVS  } = useApiData(fetchGenderVS);
  const { data: natVS     } = useApiData(fetchNatVS);

  const loading = pLoading || aLoading;
  const error   = pError ?? aError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.nav.profile')}
        actions={<Link to="/profile/edit" className="text-sm font-medium text-primary-600 hover:underline">{t('actions.edit')}</Link>}
      />

      {error && <Problem title={t('status.error')} detail={error} />}

      <div className="space-y-6">
        {/* Identity */}
        {profile?.identity && (
          <Card>
            <CardHeader title="Identity" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Legal first name"   value={profile.identity.legalFirstName} />
                <DetailItem label="Legal family name"  value={profile.identity.legalFamilyName} />
                <DetailItem label="Preferred name"     value={profile.identity.preferredName} />
                <DetailItem label="Date of birth"      value={formatDate(profile.identity.dateOfBirth)} />
                <DetailItem label="Preferred pronouns" value={profile.identity.preferredPronouns} />
                <DetailItem label="Gender"             value={codeLabel(genderVS, profile.identity.genderCode)} />
                <DetailItem label="Nationality"        value={codeLabel(natVS,    profile.identity.nationalityCode)} />
              </dl>
            </CardBody>
          </Card>
        )}

        {/* Contact */}
        {profile?.identity && (
          <Card>
            <CardHeader title="Contact details" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Institutional email" value={profile.identity.emailInstitutional} />
                <DetailItem label="Personal email"      value={profile.identity.emailPersonal} />
                <DetailItem label="Mobile number"       value={profile.identity.phoneMobile} />
              </dl>
            </CardBody>
          </Card>
        )}

        {/* Addresses */}
        <Card>
          <CardHeader
            title="Addresses"
            actions={
              <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => navigate('/profile/addresses/new')}>
                Add address
              </Button>
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
              <p className="text-sm text-neutral-500">No addresses recorded. Use the button above to add one.</p>
            )}
          </CardBody>
        </Card>

        {/* Student record */}
        {profile && (
          <Card>
            <CardHeader title="Student record" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailItem label="Student number" value={profile.studentNumber} />
                <DetailItem label="HESA identifier" value={profile.hesaId} />
                <DetailItem label="Status"           value={profile.personStatusCode} />
                <DetailItem label="Record created"   value={formatDate(profile.createdAt)} />
              </dl>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-900">{value ?? '—'}</dd>
    </div>
  );
}
