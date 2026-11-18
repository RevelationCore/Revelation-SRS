import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Spinner, StatusNotice, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type AcademicPeriod, type ModuleOffering, listAcademicPeriods, listModuleOfferings } from '../api/academicPeriods.js';
import { type AssessmentComponent, createComponent, listComponents, updateComponent } from '../api/marks.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';
import { useValueSet } from '../hooks/useValueSet.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

/**
 * Assessment structures (BP-05-001): the components of each module
 * offering and their weightings. Weightings must total 100 before marks
 * are calculated; once marks exist a component can only have its exam
 * duration changed.
 */
export function AssessmentStructuresPage() {
  const { roles } = useAuth();
  const canWrite = userHasAnyPermission(roles, ['catalogue:write']);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [offerings, setOfferings] = useState<ModuleOffering[]>([]);
  const [offeringId, setOfferingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listAcademicPeriods().then((p) => { setPeriods(p); setPeriodId(p[0]?.academicPeriodId ?? ''); }).catch((err: unknown) => setError(message(err, 'Failed to load academic periods')));
  }, []);
  useEffect(() => {
    if (!periodId) return;
    setOfferingId('');
    listModuleOfferings(periodId).then((o) => { setOfferings(o); setOfferingId(o[0]?.moduleOfferingId ?? ''); }).catch((err: unknown) => setError(message(err, 'Failed to load modules')));
  }, [periodId]);

  return (
    <div>
      <PageHeader
        title="Assessment structures"
        description="The assessed components of each module offering, their weightings and pass marks. Weightings must total 100. Once marks exist, only an exam's duration can change."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="structure-period" className="text-sm text-neutral-500">Period:</label>
            <Select id="structure-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-auto">
              {periods.map((p) => <option key={p.academicPeriodId} value={p.academicPeriodId}>{p.academicYear} {p.periodCode}</option>)}
            </Select>
            <label htmlFor="structure-module" className="text-sm text-neutral-500">Module:</label>
            <Select id="structure-module" value={offeringId} onChange={(e) => setOfferingId(e.target.value)} className="w-auto">
              {offerings.length === 0 && <option value="">No modules in this period</option>}
              {offerings.map((o) => <option key={o.moduleOfferingId} value={o.moduleOfferingId}>{o.moduleCode} {o.moduleTitle}</option>)}
            </Select>
          </div>
        }
      />
      <div className="mt-6">
        {error ? <p className="text-sm text-danger-600" role="alert">{error}</p>
          : offeringId ? <OfferingComponents key={offeringId} offeringId={offeringId} canWrite={canWrite} /> : null}
      </div>
    </div>
  );
}

function OfferingComponents({ offeringId, canWrite }: { offeringId: string; canWrite: boolean }) {
  const [components, setComponents] = useState<AssessmentComponent[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try { setComponents(await listComponents(offeringId)); } catch (err) { setError(message(err, 'Failed to load components')); }
  }, [offeringId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The change was refused')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!components) return <div className="flex justify-center py-8"><Spinner /></div>;
  const total = components.reduce((sum, c) => sum + c.weighting, 0);

  return (
    <Card>
      <CardHeader title="Components" description={`Total weighting ${total} of 100.`} />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {components.length > 0 && total !== 100 && <StatusNotice>The weightings total {total}. They must total 100 before module results can be calculated.</StatusNotice>}
          {components.length === 0 ? <p className="text-sm text-neutral-600">No components yet.</p> : (
            <Table>
              <TableHead>
                <tr><TableHeaderCell>Component</TableHeaderCell><TableHeaderCell>Type</TableHeaderCell><TableHeaderCell>Weighting</TableHeaderCell><TableHeaderCell>Pass mark</TableHeaderCell><TableHeaderCell>Duration</TableHeaderCell><TableHeaderCell><span className="sr-only">Edit</span></TableHeaderCell></tr>
              </TableHead>
              <TableBody>
                {components.map((c) => (
                  <ComponentRow key={c.assessmentComponentId} component={c} canWrite={canWrite}
                    onSave={(body) => act(() => updateComponent(offeringId, c.assessmentComponentId, body))} />
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && total < 100 && <AddComponentForm remaining={100 - total} onSubmit={(body) => act(() => createComponent(offeringId, body))} />}
        </div>
      </CardBody>
    </Card>
  );
}

function ComponentRow({ component, canWrite, onSave }: {
  component: AssessmentComponent; canWrite: boolean;
  onSave: (body: { title?: string; weighting?: number; passMarkOverride?: number | null; durationMinutes?: number | null }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(component.title);
  const [weighting, setWeighting] = useState(String(component.weighting));
  const [passMark, setPassMark] = useState(component.passMarkOverride === null ? '' : String(component.passMarkOverride));
  const [duration, setDuration] = useState(component.durationMinutes === null ? '' : String(component.durationMinutes));
  const id = `component-${component.assessmentComponentId}`;

  if (!editing) {
    return (
      <TableRow>
        <TableCell>{component.title}</TableCell>
        <TableCell><CodeLabel entity="assessment_component" field="component_type_code" code={component.componentTypeCode} /></TableCell>
        <TableCell>{component.weighting}</TableCell>
        <TableCell>{component.passMarkOverride ?? 'Default'}</TableCell>
        <TableCell>{component.durationMinutes ? `${component.durationMinutes} min` : '—'}</TableCell>
        <TableCell className="text-right">{canWrite && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit<span className="sr-only"> {component.title}</span></Button>}</TableCell>
      </TableRow>
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const body: { title?: string; weighting?: number; passMarkOverride?: number | null; durationMinutes?: number | null } = {};
    if (title.trim() !== component.title) body.title = title.trim();
    if (Number(weighting) !== component.weighting) body.weighting = Number(weighting);
    const pm = passMark === '' ? null : Number(passMark);
    if (pm !== component.passMarkOverride) body.passMarkOverride = pm;
    const d = duration === '' ? null : Number(duration);
    if (d !== component.durationMinutes) body.durationMinutes = d;
    if (Object.keys(body).length === 0 || await onSave(body)) setEditing(false);
  }
  return (
    <TableRow>
      <td colSpan={6} className="px-4 py-3">
        <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-5" onSubmit={(e) => void save(e)}>
          <LabelledField label="Title" htmlFor={`${id}-title`}><Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} /></LabelledField>
          <LabelledField label="Weighting" htmlFor={`${id}-weighting`}><Input id={`${id}-weighting`} type="number" min={1} max={100} value={weighting} onChange={(e) => setWeighting(e.target.value)} /></LabelledField>
          <LabelledField label="Pass mark" htmlFor={`${id}-pass`} hint="Empty for the default"><Input id={`${id}-pass`} type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} /></LabelledField>
          <LabelledField label="Duration (minutes)" htmlFor={`${id}-duration`}><Input id={`${id}-duration`} type="number" min={1} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} /></LabelledField>
          <div className="flex gap-2">
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      </td>
    </TableRow>
  );
}

function AddComponentForm({ remaining, onSubmit }: { remaining: number; onSubmit: (body: { componentTypeCode: string; title: string; weighting: number; passMarkOverride?: number; durationMinutes?: number }) => Promise<boolean> }) {
  const { members: types } = useValueSet('assessment_component', 'component_type_code');
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [weighting, setWeighting] = useState(String(remaining));
  const [passMark, setPassMark] = useState('');
  const [duration, setDuration] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit({
      componentTypeCode: type, title: title.trim(), weighting: Number(weighting),
      ...(passMark ? { passMarkOverride: Number(passMark) } : {}), ...(duration ? { durationMinutes: Number(duration) } : {}),
    });
    if (ok) { setType(''); setTitle(''); setPassMark(''); setDuration(''); }
  }

  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-6" onSubmit={(e) => void submit(e)}>
      <p className="text-sm font-medium md:col-span-6">Add a component ({remaining} weighting left)</p>
      <LabelledField label="Type" htmlFor="new-component-type" required>
        <Select id="new-component-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <div className="md:col-span-2">
        <LabelledField label="Title" htmlFor="new-component-title" required><Input id="new-component-title" value={title} onChange={(e) => setTitle(e.target.value)} /></LabelledField>
      </div>
      <LabelledField label="Weighting" htmlFor="new-component-weighting" required>
        <Input id="new-component-weighting" type="number" min={1} max={remaining} value={weighting} onChange={(e) => setWeighting(e.target.value)} />
      </LabelledField>
      <LabelledField label="Duration (minutes)" htmlFor="new-component-duration" hint="Exams only">
        <Input id="new-component-duration" type="number" min={1} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </LabelledField>
      <Button type="submit" disabled={!type || !title.trim() || !weighting || Number(weighting) > remaining}>Add component</Button>
    </form>
  );
}
