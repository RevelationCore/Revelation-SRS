import { type FormEvent, useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { type AcademicPeriod, type ModuleOffering, listAcademicPeriods, listModuleOfferings } from '../api/academicPeriods.js';
import { ApiError } from '../api/client.js';
import { type AssessmentComponent, listComponents, setComponentDuration } from '../api/marks.js';

interface ExamRow { offering: ModuleOffering; component: AssessmentComponent }

/**
 * How long each exam is. Exam entries use it to state each candidate's time
 * with their reasonable adjustments (a 120-minute exam with 25% extra time is
 * 150 minutes); an exam without a duration gets no stated minutes, and the
 * entry says why. A duration can be recorded after marks exist.
 */
export function ExamTimingsPage() {
  const [periods, setPeriods] = useState<AcademicPeriod[] | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [rows, setRows] = useState<ExamRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listAcademicPeriods()
      .then((p) => { setPeriods(p); if (p[0]) setPeriodId(p[0].academicPeriodId); })
      .catch((err: unknown) => setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load periods'));
  }, []);

  useEffect(() => {
    if (!periodId) return;
    setRows(null);
    void (async () => {
      try {
        const offerings = await listModuleOfferings(periodId);
        const perOffering = await Promise.all(offerings.map(async (offering) =>
          (await listComponents(offering.moduleOfferingId))
            .filter((c) => c.componentTypeCode === 'exam')
            .map((component) => ({ offering, component }))));
        setRows(perOffering.flat().sort((a, b) => a.offering.moduleCode.localeCompare(b.offering.moduleCode)));
      } catch (err) {
        setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to load exams');
      }
    })();
  }, [periodId]);

  const missing = rows?.filter((r) => r.component.durationMinutes === null).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Exam timings"
        description="How long each exam is, so exam entries can state each candidate's time including reasonable adjustments."
      />
      {error && <p className="mb-4 text-sm text-danger-600" role="alert">{error}</p>}
      <Card>
        <CardHeader
          title={rows ? `${rows.length} exam${rows.length === 1 ? '' : 's'}${missing ? ` · ${missing} without a duration` : ''}` : 'Exams'}
          actions={periods && (
            <Select aria-label="Academic period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {periods.map((p) => <option key={p.academicPeriodId} value={p.academicPeriodId}>{p.academicYear} {p.periodCode}</option>)}
            </Select>
          )}
        />
        <CardBody>
          {periods === null || (periodId && rows === null) ? <Spinner /> : !rows || rows.length === 0 ? (
            <p className="text-sm text-neutral-500">No exams in this period.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Module</TableHeaderCell>
                  <TableHeaderCell>Exam</TableHeaderCell>
                  <TableHeaderCell>Duration (minutes)</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {rows.map((row) => <ExamRowView key={row.component.assessmentComponentId} row={row} />)}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ExamRowView({ row }: { row: ExamRow }) {
  const [value, setValue] = useState(row.component.durationMinutes === null ? '' : String(row.component.durationMinutes));
  const [saved, setSaved] = useState(row.component.durationMinutes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const id = `duration-${row.component.assessmentComponentId}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = value.trim() === '' ? null : Number(value);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      setMessage('A whole number of minutes from 1 to 1440, or blank for untimed.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      await setComponentDuration(row.offering.moduleOfferingId, row.component.assessmentComponentId, minutes);
      setSaved(minutes);
      setMessage('Saved');
    } catch (err) {
      setMessage(err instanceof ApiError ? (err.detail ?? err.message) : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-neutral-800">{row.offering.moduleCode}</div>
        <div className="text-xs text-neutral-500">{row.offering.moduleTitle}</div>
      </TableCell>
      <TableCell>{row.component.title}</TableCell>
      <TableCell>
        <form onSubmit={(e) => void save(e)} className="flex items-end gap-2">
          <LabelledField label={`${row.offering.moduleCode} ${row.component.title} duration`} htmlFor={id}>
            <Input id={id} type="number" min="1" max="1440" value={value} placeholder="not recorded" onChange={(e) => setValue(e.target.value)} />
          </LabelledField>
          <Button type="submit" size="sm" disabled={busy || (value === '' ? saved === null : Number(value) === saved)}>Save</Button>
          {message && <span className="text-xs text-neutral-600" role="status">{message}</span>}
        </form>
      </TableCell>
    </TableRow>
  );
}
