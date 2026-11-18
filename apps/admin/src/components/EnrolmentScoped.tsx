import { type ReactNode, useEffect, useState } from 'react';
import {
  Select, Spinner, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type Enrolment, listStudentEnrolments } from '../api/enrolments.js';

/**
 * Loads a student's enrolments and renders the content for one of them,
 * with a chooser when there is more than one. The content is keyed by
 * enrolment, so its state resets when the choice changes.
 */
export function EnrolmentScoped({ personId, idPrefix, children }: {
  personId: string; idPrefix: string; children: (enrolment: Enrolment) => ReactNode;
}) {
  const enrolmentStatuses = useCodes('enrolment', 'status_code');
  const [enrolments, setEnrolments] = useState<Enrolment[] | null>(null);
  const [enrolmentId, setEnrolmentId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listStudentEnrolments(personId)
      .then((list) => { if (!cancelled) { setEnrolments(list); setEnrolmentId(list[0]?.enrolmentId ?? ''); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load enrolments'); });
    return () => { cancelled = true; };
  }, [personId]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!enrolments) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (enrolments.length === 0) return <p className="text-sm text-neutral-600">This student has no enrolments.</p>;
  const selected = enrolments.find((e) => e.enrolmentId === enrolmentId) ?? enrolments[0]!;

  return (
    <div className="flex flex-col gap-6">
      {enrolments.length > 1 && (
        <div className="flex items-center gap-3">
          <label htmlFor={`${idPrefix}-enrolment`} className="text-sm text-neutral-500">Enrolment:</label>
          <Select id={`${idPrefix}-enrolment`} value={selected.enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)} className="w-auto">
            {enrolments.map((e) => (
              <option key={e.enrolmentId} value={e.enrolmentId}>
                {e.programmeCode ?? 'Programme'} — {e.academicYearOfEntry} ({enrolmentStatuses.label(e.statusCode)})
              </option>
            ))}
          </Select>
        </div>
      )}
      <div key={selected.enrolmentId} className="flex flex-col gap-6">{children(selected)}</div>
    </div>
  );
}
