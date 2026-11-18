import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, LabelledField, Select } from '@revelation-srs/ui';

import { getStudent, listStudents, type StudentSummary } from '../api/students.js';
import { ApiError } from '../api/wellbeingModule.js';
import { useValueSet } from '../hooks/useValueSet.js';

// Shared pieces of the wellbeing case screens.

type Members = Array<{ code: string; displayLabel: string }>;

export function labelFor(members: Members, code: string | null | undefined): string {
  if (!code) return '—';
  return members.find((m) => m.code === code)?.displayLabel ?? code;
}

/** Value-set members for a field of one of the wellbeing module's tables. */
export function useWellbeingCodes(table: string, field: string): Members {
  return useValueSet(`wellbeing.${table}`, field).members;
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB') : '—';
}

/**
 * Student names for person IDs, looked up in the SRS. A reader without
 * student:read:all (an auditor, say) sees the ID instead.
 */
export function usePersonNames(personIds: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(personIds)].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    void Promise.all(ids.map(async (id) => {
      try {
        const s = await getStudent(id);
        const name = s.identity ? `${s.identity.preferredName ?? s.identity.legalFirstName} ${s.identity.legalFamilyName}` : s.studentNumber;
        return [id, `${name} (${s.studentNumber})`] as [string, string];
      } catch {
        return null as [string, string] | null;
      }
    })).then((rows) => {
      if (cancelled) return;
      setNames(Object.fromEntries(rows.filter((r): r is [string, string] => r !== null)));
    });
    return () => { cancelled = true; };
  }, [key]);
  return names;
}

export function PersonCell({ personId, names }: { personId: string; names: Record<string, string> }) {
  const name = names[personId];
  return name
    ? <Link to={`/students/${personId}`} className="text-primary-600 hover:underline">{name}</Link>
    : <span className="font-mono text-xs">{personId}</span>;
}

/** Search the SRS for a student and pick one; reports the chosen person ID. */
export function StudentPicker({ id, value, onChange }: { id: string; value: string; onChange: (personId: string, label: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentSummary[]>([]);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const listId = useId();

  async function search() {
    setError('');
    try {
      setResults(await listStudents(10, 0, query.trim()));
    } catch (err) {
      setError(errorText(err, 'Student search failed'));
    }
  }

  if (value && chosen) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{chosen}</span>
        <Button size="sm" variant="secondary" type="button" onClick={() => { setChosen(''); onChange('', ''); }}>Change</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input id={id} value={query} placeholder="Name or student number" onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
        <Button size="sm" variant="secondary" type="button" onClick={() => void search()} disabled={!query.trim()}>Find student</Button>
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {results.length > 0 && (
        <ul id={listId} aria-label="Matching students" className="divide-y rounded border border-neutral-200 text-sm">
          {results.map((s) => {
            const label = `${s.legalFirstName} ${s.legalFamilyName} (${s.studentNumber})`;
            return (
              <li key={s.personId}>
                <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-neutral-50"
                  onClick={() => { setChosen(label); setResults([]); onChange(s.personId, label); }}>
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Move a record to one of the statuses its lifecycle allows. Renders nothing
 * when the record is final or the reader may not change it.
 */
export function StatusChanger({
  id, allowed, members, onChange, busy, label = 'Change status to',
}: {
  id: string; allowed: string[]; members: Members; onChange: (status: string) => void; busy: boolean; label?: string;
}) {
  const [next, setNext] = useState(allowed[0] ?? '');
  useEffect(() => { setNext(allowed[0] ?? ''); }, [allowed.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (allowed.length === 0) return null;
  return (
    <div className="flex items-end gap-2">
      <LabelledField label={label} htmlFor={id}>
        <Select id={id} value={next} onChange={(e) => setNext(e.target.value)} className="w-auto">
          {allowed.map((s) => <option key={s} value={s}>{labelFor(members, s)}</option>)}
        </Select>
      </LabelledField>
      <Button size="sm" onClick={() => onChange(next)} disabled={busy || !next}>{busy ? 'Saving…' : 'Update'}</Button>
    </div>
  );
}
