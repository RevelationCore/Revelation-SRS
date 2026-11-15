import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type ExternalRecord, type InboundField, type InboundFlow,
  enterExternalRecord, listExternalRecords, listInboundFlows,
} from '../api/externalRecords.js';
import { useValueSet } from '../hooks/useValueSet.js';

/**
 * What other systems report about this student (library account,
 * accommodation bookings, ...). Current records first, with history. For
 * information only: nothing here changes the student's academic record.
 */
export function ExternalRecordsTab({ personId, canWrite }: { personId: string; canWrite: boolean }) {
  const [records, setRecords] = useState<ExternalRecord[] | null>(null);
  const [flows, setFlows] = useState<InboundFlow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([listExternalRecords(personId), listInboundFlows()]);
      setRecords(r);
      setFlows(f.filter((flow) => flow.defined));
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load');
    }
  }, [personId]);
  useEffect(() => { void load(); }, [load]);

  const shown = (records ?? []).filter((r) => showHistory || r.current);

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <Card>
        <CardHeader
          title="Reported by other systems"
          actions={(
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
              Show earlier reports
            </label>
          )}
        />
        <CardBody>
          <p className="mb-3 text-sm text-neutral-600">
            For information only. These records do not change academic status: a library fine does not block results, and a housing check-in is not enrolment.
          </p>
          {records === null ? <Spinner /> : shown.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing reported.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>System</TableHeaderCell>
                  <TableHeaderCell>Record</TableHeaderCell>
                  <TableHeaderCell>As at</TableHeaderCell>
                  <TableHeaderCell>Source</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.externalRecordId}>
                    <TableCell>{r.sourceLabel}</TableCell>
                    <TableCell className={r.current ? 'text-neutral-800' : 'text-neutral-500'}>
                      {r.summary}{!r.current && ' (earlier)'}
                    </TableCell>
                    <TableCell>{new Date(r.observedAt).toLocaleString('en-GB')}</TableCell>
                    <TableCell className="text-xs text-neutral-500">{r.receivedVia === 'person' ? 'Entered by staff' : 'Connected system'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {canWrite && flows.map((flow) => (
        <EntryForm key={flow.flowCode} personId={personId} flow={flow} onSaved={() => void load()} />
      ))}
    </div>
  );
}

function EntryForm({ personId, flow, onSaved }: { personId: string; flow: InboundFlow; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setMessage('');
    const payload: Record<string, unknown> = {};
    for (const field of flow.fields) {
      const v = values[field.name]?.trim();
      if (!v) continue;
      payload[field.name] = field.type === 'integer' ? Number(v) : v;
    }
    try {
      await enterExternalRecord(personId, flow.flowCode, payload);
      setValues({});
      setMessage('Recorded');
      onSaved();
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.detail ?? err.message) : 'Could not record');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={`Record by hand: ${flow.name}`} />
      <CardBody>
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
          {flow.fields.map((field) => (
            <FieldInput
              key={field.name}
              id={`${flow.flowCode}-${field.name}`}
              field={field}
              value={values[field.name] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            />
          ))}
          <div>
            <Button type="submit" size="sm" disabled={saving}>{saving ? 'Recording…' : 'Record'}</Button>
            {message && <span className="ml-2 text-xs text-neutral-600" role="status">{message}</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function FieldInput({ id, field, value, onChange }: { id: string; field: InboundField; value: string; onChange: (v: string) => void }) {
  return (
    <LabelledField label={field.label} htmlFor={id} required={field.required}>
      {field.type === 'code' && field.valueSet ? (
        <CodeSelect id={id} entity={field.valueSet.entity} fieldName={field.valueSet.field} value={value} onChange={onChange} />
      ) : (
        <Input
          id={id}
          type={field.type === 'integer' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          {...(field.type === 'integer' && field.min !== undefined ? { min: String(field.min) } : {})}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </LabelledField>
  );
}

function CodeSelect({ id, entity, fieldName, value, onChange }: { id: string; entity: string; fieldName: string; value: string; onChange: (v: string) => void }) {
  const { members } = useValueSet(entity, fieldName);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {members.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
    </Select>
  );
}
