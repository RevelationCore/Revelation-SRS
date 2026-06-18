import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { getProfile, getAddresses } from '../api/me.js';
import { Spinner, Problem, formatDate } from '@revelation-srs/ui';

export function ProfilePage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const fetchProfile   = useCallback(() => personId ? getProfile(personId)   : Promise.reject(new Error('')), [personId]);
  const fetchAddresses = useCallback(() => personId ? getAddresses(personId) : Promise.reject(new Error('')), [personId]);

  const { data: profile,   loading: pLoading, error: pError } = useApiData(personId ? fetchProfile   : null);
  const { data: addresses, loading: aLoading, error: aError } = useApiData(personId ? fetchAddresses : null);

  const loading = pLoading || aLoading;
  const error   = pError ?? aError;

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('portal.nav.profile')}</h1>
        <Link to="/profile/edit" className="text-sm text-indigo-600 hover:underline">
          {t('actions.edit')} →
        </Link>
      </div>

      {error && <Problem title={t('status.error')} detail={error} />}

      {/* Identity */}
      {profile?.identity && (
        <section aria-labelledby="identity-heading" className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 id="identity-heading" className="mb-4 text-base font-semibold text-gray-900">Identity</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Legal first name"   value={profile.identity.legalFirstName} />
            <DetailItem label="Legal family name"  value={profile.identity.legalFamilyName} />
            <DetailItem label="Preferred name"     value={profile.identity.preferredName} />
            <DetailItem label="Date of birth"      value={formatDate(profile.identity.dateOfBirth)} />
            <DetailItem label="Gender"             value={profile.identity.genderCode} />
            <DetailItem label="Nationality"        value={profile.identity.nationalityCode} />
          </dl>
        </section>
      )}

      {/* Contact */}
      {profile?.identity && (
        <section aria-labelledby="contact-heading" className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 id="contact-heading" className="mb-4 text-base font-semibold text-gray-900">Contact details</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Institutional email" value={profile.identity.emailInstitutional} />
            <DetailItem label="Personal email"      value={profile.identity.emailPersonal} />
            <DetailItem label="Mobile number"       value={profile.identity.phoneMobile} />
          </dl>
        </section>
      )}

      {/* Addresses */}
      {addresses && addresses.length > 0 && (
        <section aria-labelledby="addresses-heading" className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 id="addresses-heading" className="mb-4 text-base font-semibold text-gray-900">Addresses</h2>
          <div className="space-y-4">
            {addresses.map(addr => (
              <div key={addr.id} className="border-t border-gray-100 pt-4 first:border-0 first:pt-0">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {addr.addressTypeCode}
                </p>
                <address className="not-italic text-sm text-gray-800 leading-relaxed">
                  {[addr.line1, addr.line2, addr.city, addr.postcode, addr.countryCode]
                    .filter(Boolean)
                    .join(', ')}
                </address>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Student record */}
      {profile && (
        <section aria-labelledby="record-heading" className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 id="record-heading" className="mb-4 text-base font-semibold text-gray-900">Student record</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Student number" value={profile.studentNumber} />
            <DetailItem label="HESA identifier" value={profile.hesaId} />
            <DetailItem label="Status"           value={profile.personStatusCode} />
            <DetailItem label="Record created"   value={formatDate(profile.createdAt)} />
          </dl>
        </section>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}
