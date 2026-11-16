import { type FormEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Checkbox, LabelledField, Spinner, Problem, formatDate } from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type MyGraduationInvitation, listMyGraduationInvitations, respondToGraduationInvitation } from '../api/me.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

const RESPONSES: Array<{ code: string; label: string }> = [
  { code: 'attending', label: 'I will attend' },
  { code: 'in-absentia', label: 'Graduate without attending (in absentia)' },
  { code: 'deferred', label: 'Defer to a later ceremony' },
  { code: 'declined', label: 'I do not want a ceremony' },
];

/** Graduation invitations and my reply (BP-06-005; D-4). Replies close when the presentation list is frozen. */
export function GraduationPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const [version, setVersion] = useState(0);
  const fetch = useCallback(() => (personId ? listMyGraduationInvitations(personId) : Promise.reject(new Error(''))), [personId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error } = useApiData(personId ? fetch : null);

  return (
    <div>
      <PageHeader title={t('portal.nav.graduation')} description="Your graduation invitations. Tell us whether you will attend, and how many guests you are bringing." />
      <div className="mt-6 flex flex-col gap-6">
        {loading ? <div className="flex justify-center py-16"><Spinner /></div>
          : error ? <Problem title="We could not load your invitations" detail={error} />
            : !data || data.length === 0 ? <p className="text-sm text-neutral-600">You have no graduation invitations.</p>
              : data.map((i) => <InvitationCard key={i.invitationId} invitation={i} onSaved={() => setVersion((v) => v + 1)} />)}
      </div>
    </div>
  );
}

function InvitationCard({ invitation, onSaved }: { invitation: MyGraduationInvitation; onSaved: () => void }) {
  const [response, setResponse] = useState(invitation.responseCode === 'invited' ? 'attending' : invitation.responseCode);
  const [guests, setGuests] = useState(String(invitation.guestCount));
  const [accessibility, setAccessibility] = useState(invitation.accessibilityRequired);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const id = invitation.invitationId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setSaved(false);
    try {
      await respondToGraduationInvitation(id, {
        responseCode: response,
        ...(response === 'attending' ? { guestCount: Number(guests), accessibilityRequired: accessibility } : {}),
      });
      setSaved(true);
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? (err.detail ?? err.message) : 'We could not save your reply.'); }
  }

  return (
    <Card>
      <CardHeader
        title="Graduation invitation"
        description={invitation.responseCode === 'invited' ? `Invited ${formatDate(invitation.createdAt)}. Please reply.` : `You replied ${invitation.respondedAt ? formatDate(invitation.respondedAt) : ''}: ${RESPONSES.find((r) => r.code === invitation.responseCode)?.label ?? invitation.responseCode}.`}
      />
      <CardBody>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
          {saved && <p className="text-sm text-success-700" role="status">Your reply has been saved.</p>}
          <LabelledField label="Your reply" htmlFor={`grad-${id}-response`}>
            <Select id={`grad-${id}-response`} value={response} onChange={(e) => setResponse(e.target.value)}>
              {RESPONSES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </Select>
          </LabelledField>
          {response === 'attending' && (
            <>
              <LabelledField label="Number of guests" htmlFor={`grad-${id}-guests`}>
                <Input id={`grad-${id}-guests`} type="number" min={0} max={20} value={guests} onChange={(e) => setGuests(e.target.value)} className="w-28" />
              </LabelledField>
              <label className="flex items-center gap-2 text-sm" htmlFor={`grad-${id}-access`}>
                <Checkbox id={`grad-${id}-access`} checked={accessibility} onChange={(e) => setAccessibility(e.target.checked)} />
                I or my guests will need accessibility support at the ceremony
              </label>
            </>
          )}
          <div><Button type="submit">Save my reply</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
