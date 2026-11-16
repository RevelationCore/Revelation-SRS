import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, CardHeader, CardBody, Button, Checkbox, Spinner, Problem, StatusNotice, formatDate } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type MyRegistration, confirmMyRegistration, listMyRegistrations } from '../api/me.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

/**
 * Registering for the year (BP-02-010; D-8). The student confirms they are
 * continuing by accepting the current terms and conditions; the university
 * records which version they accepted.
 */
export function RegistrationPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const [version, setVersion] = useState(0);
  const fetch = useCallback(() => (personId ? listMyRegistrations(personId) : Promise.reject(new Error(''))), [personId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error } = useApiData(personId ? fetch : null);

  return (
    <div>
      <PageHeader title={t('portal.nav.registration')} description="Each year you need to register to confirm you are continuing your studies." />
      <div className="mt-6 flex flex-col gap-6">
        {loading ? <div className="flex justify-center py-16"><Spinner /></div>
          : error ? <Problem title="We could not load your registration" detail={error} />
            : !data || data.length === 0 ? <p className="text-sm text-neutral-600">There is nothing for you to register for at the moment.</p>
              : data.map((r) => <RegistrationCard key={r.confirmation.confirmationId} registration={r} onDone={() => setVersion((v) => v + 1)} />)}
      </div>
    </div>
  );
}

function RegistrationCard({ registration, onDone }: { registration: MyRegistration; onDone: () => void }) {
  const { confirmation, period, blockers, termsVersion } = registration;
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const id = confirmation.confirmationId;
  const title = `Registration for ${period.academicYear}`;

  async function confirm() {
    if (!termsVersion) return;
    setError('');
    try { await confirmMyRegistration(id, termsVersion); onDone(); } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'We could not register you.');
    }
  }

  if (confirmation.statusCode === 'confirmed') {
    return (
      <Card>
        <CardHeader title={title} description={`You are registered${confirmation.confirmedAt ? ` (${formatDate(confirmation.confirmedAt)})` : ''}${confirmation.channelCode === 'assisted' ? ', by the registry on your behalf' : ''}.`} />
      </Card>
    );
  }
  if (confirmation.statusCode === 'lapsed') {
    return (
      <Card>
        <CardHeader title={title} description="The registration period has closed and you did not register." />
        <CardBody><StatusNotice>Please contact the registry as soon as possible. They can register you late.</StatusNotice></CardBody>
      </Card>
    );
  }
  const ended = new Date() >= new Date(period.closesAt);
  return (
    <Card>
      <CardHeader title={title} description={`Register by ${formatDate(period.closesAt)}.`} />
      <CardBody>
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
          {ended && <StatusNotice>The registration period has ended. Please contact the registry.</StatusNotice>}
          {blockers.length > 0 && (
            <div role="status">
              <p className="text-sm font-medium text-neutral-800">You cannot register yet:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
            </div>
          )}
          {!ended && blockers.length === 0 && termsVersion && (
            <>
              <label className="flex items-start gap-2 text-sm" htmlFor={`reg-${id}-terms`}>
                <Checkbox id={`reg-${id}-terms`} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                I confirm I am continuing my studies and I accept the university&apos;s terms and conditions (version {termsVersion}).
              </label>
              <div><Button disabled={!accepted} onClick={() => void confirm()}>Register for {period.academicYear}</Button></div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
