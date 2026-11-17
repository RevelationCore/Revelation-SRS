import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Input, Select, Checkbox, LabelledField, Spinner,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type ProgrammeSummary, listProgrammes } from '../api/applications.js';
import { type ModuleSummary, listModules } from '../api/academicExceptions.js';
import { type DietGroup, type RuleSet, addDietGroupMember, createDietGroup, createRuleSet, listDietGroups, listRuleSets } from '../api/programmeRules.js';
import { type SubjectShare, getModuleSubjects, putModuleSubjects } from '../api/moduleSelection.js';
import { getFieldValueSet } from '../api/valueSets.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

const GROUP_TYPES: Array<{ code: DietGroup['groupTypeCode']; label: string }> = [
  { code: 'compulsory', label: 'Compulsory' }, { code: 'optional-pool', label: 'Optional pool' }, { code: 'elective-pool', label: 'Elective pool' },
];

/**
 * Programme rules (BP-03-002): each programme's rule sets (by entry year or
 * route) and their diet groups: compulsory, optional and elective modules
 * with module, credit and level bounds. Module selection validates
 * students' choices against these.
 */
export function ProgrammeRulesPage() {
  const { roles } = useAuth();
  const canConfigure = userHasAnyPermission(roles, ['module-selection:configure']);
  const [programmes, setProgrammes] = useState<ProgrammeSummary[]>([]);
  const [programmeId, setProgrammeId] = useState('');
  const [ruleSets, setRuleSets] = useState<RuleSet[] | null>(null);
  const [ruleSetId, setRuleSetId] = useState('');
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listProgrammes().then((p) => { setProgrammes(p); setProgrammeId(p[0]?.programmeId ?? ''); }).catch((err: unknown) => setError(message(err, 'Failed to load programmes')));
    listModules().then(setModules).catch(() => undefined);
  }, []);

  const loadRuleSets = useCallback(async () => {
    if (!programmeId) return;
    try {
      const sets = await listRuleSets(programmeId);
      setRuleSets(sets);
      setRuleSetId((current) => (sets.some((r) => r.programmeRuleSetId === current) ? current : sets[0]?.programmeRuleSetId ?? ''));
    } catch (err) { setError(message(err, 'Failed to load rule sets')); }
  }, [programmeId]);
  useEffect(() => { setRuleSets(null); void loadRuleSets(); }, [loadRuleSets]);

  return (
    <div>
      <PageHeader
        title="Programme rules"
        description="Rule sets and diet groups for each programme. Module selection checks students' choices against the rule set their enrolment is bound to."
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="rules-programme" className="text-sm text-neutral-500">Programme:</label>
            <Select id="rules-programme" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)} className="w-auto">
              {programmes.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.code} — {p.title}</option>)}
            </Select>
          </div>
        }
      />
      <div className="mt-6 flex flex-col gap-6">
        {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
        {!ruleSets ? (programmeId && <div className="flex justify-center py-8"><Spinner /></div>) : (
          <Card>
            <CardHeader title="Rule sets" />
            <CardBody>
              <div className="flex flex-col gap-4">
                {ruleSets.length === 0 ? <p className="text-sm text-neutral-600">No rule sets for this programme.</p> : (
                  <div className="flex items-center gap-3">
                    <label htmlFor="rules-set" className="text-sm text-neutral-500">Rule set:</label>
                    <Select id="rules-set" value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)} className="w-auto">
                      {ruleSets.map((r) => <option key={r.programmeRuleSetId} value={r.programmeRuleSetId}>{r.ruleSetCode}{r.entryAcademicYear ? ` (entry ${r.entryAcademicYear})` : ''}</option>)}
                    </Select>
                  </div>
                )}
                {canConfigure && <NewRuleSetForm programmeId={programmeId} onCreated={(id) => { setRuleSetId(id); void loadRuleSets(); }} />}
              </div>
            </CardBody>
          </Card>
        )}
        {ruleSetId && <DietGroups key={ruleSetId} ruleSetId={ruleSetId} modules={modules} canConfigure={canConfigure} />}
        <ModuleSubjects modules={modules} canConfigure={canConfigure} />
      </div>
    </div>
  );
}

function NewRuleSetForm({ programmeId, onCreated }: { programmeId: string; onCreated: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [entryYear, setEntryYear] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { programmeRuleSetId } = await createRuleSet({
        programmeId, ruleSetCode: code.trim(), ...(entryYear.trim() ? { entryAcademicYear: entryYear.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}),
      });
      setCode(''); setEntryYear(''); setDescription('');
      onCreated(programmeRuleSetId);
    } catch (err) { setError(message(err, 'Failed to create the rule set')); }
  }
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void submit(e)}>
      {error && <p className="w-full text-sm text-danger-600" role="alert">{error}</p>}
      <LabelledField label="New rule set code" htmlFor="rs-code" required><Input id="rs-code" value={code} onChange={(e) => setCode(e.target.value)} /></LabelledField>
      <LabelledField label="Entry year" htmlFor="rs-year" hint="e.g. 2027-28; empty for all"><Input id="rs-year" value={entryYear} onChange={(e) => setEntryYear(e.target.value)} /></LabelledField>
      <LabelledField label="Description" htmlFor="rs-description"><Input id="rs-description" value={description} onChange={(e) => setDescription(e.target.value)} /></LabelledField>
      <Button type="submit" variant="secondary" disabled={!code.trim()}>Add rule set</Button>
    </form>
  );
}

function DietGroups({ ruleSetId, modules, canConfigure }: { ruleSetId: string; modules: ModuleSummary[]; canConfigure: boolean }) {
  const [groups, setGroups] = useState<DietGroup[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try { setGroups(await listDietGroups(ruleSetId)); } catch (err) { setError(message(err, 'Failed to load diet groups')); }
  }, [ruleSetId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The change was refused')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!groups) return <div className="flex justify-center py-8"><Spinner /></div>;
  const bounds = (min: number | null, max: number | null, unit: string) => (min === null && max === null ? null : `${min ?? 0}–${max ?? 'any'} ${unit}`);

  return (
    <Card>
      <CardHeader title="Diet groups" description="Compulsory modules are added to a student's selection automatically; optional and elective pools set how many modules or credits the student must choose." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {groups.length === 0 ? <p className="text-sm text-neutral-600">No diet groups yet.</p> : groups.map((g) => (
            <div key={g.moduleGroupId} className="rounded border border-neutral-200 p-3">
              <p className="text-sm font-medium">{g.title} <span className="font-mono text-xs text-neutral-500">{g.groupCode}</span></p>
              <p className="text-xs text-neutral-600">
                {[GROUP_TYPES.find((t) => t.code === g.groupTypeCode)?.label, g.fheqLevel ? `level ${g.fheqLevel}` : null, bounds(g.minModules, g.maxModules, 'modules'), bounds(g.minCredits, g.maxCredits, 'credits')].filter(Boolean).join(' · ')}
              </p>
              {g.members.length > 0 && (
                <Table>
                  <TableHead><tr><TableHeaderCell>Module</TableHeaderCell><TableHeaderCell>Added by default</TableHeaderCell><TableHeaderCell>Cannot be condoned</TableHeaderCell></tr></TableHead>
                  <TableBody>
                    {g.members.map((m) => (
                      <TableRow key={m.moduleGroupMemberId}>
                        <TableCell>{m.moduleCode} {m.moduleTitle}</TableCell>
                        <TableCell>{m.isDefault ? 'Yes' : 'No'}</TableCell>
                        <TableCell>{m.isNonCondonable ? 'Yes' : 'No'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {canConfigure && <AddMemberForm group={g} modules={modules} onSubmit={(body) => act(() => addDietGroupMember(g.moduleGroupId, body))} />}
            </div>
          ))}
          {canConfigure && <NewGroupForm onSubmit={(body) => act(() => createDietGroup({ programmeRuleSetId: ruleSetId, ...body }))} />}
        </div>
      </CardBody>
    </Card>
  );
}

function AddMemberForm({ group, modules, onSubmit }: { group: DietGroup; modules: ModuleSummary[]; onSubmit: (body: { moduleId: string; isDefault?: boolean; isNonCondonable?: boolean }) => Promise<boolean> }) {
  const [moduleId, setModuleId] = useState('');
  const [isDefault, setIsDefault] = useState(group.groupTypeCode === 'compulsory');
  const [nonCondonable, setNonCondonable] = useState(false);
  const id = `member-${group.moduleGroupId}`;
  const available = modules.filter((m) => !group.members.some((x) => x.moduleId === m.moduleId));
  return (
    <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onSubmit({ moduleId, isDefault, isNonCondonable: nonCondonable }).then((ok) => { if (ok) setModuleId(''); }); }}>
      <LabelledField label={`Add a module to ${group.title}`} htmlFor={`${id}-module`}>
        <Select id={`${id}-module`} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
          <option value="">Choose…</option>
          {available.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.code} — {m.title}</option>)}
        </Select>
      </LabelledField>
      <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-default`}><Checkbox id={`${id}-default`} checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Added by default</label>
      <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-nc`}><Checkbox id={`${id}-nc`} checked={nonCondonable} onChange={(e) => setNonCondonable(e.target.checked)} /> Cannot be condoned</label>
      <Button type="submit" size="sm" variant="secondary" disabled={!moduleId}>Add module</Button>
    </form>
  );
}

function NewGroupForm({ onSubmit }: { onSubmit: (body: { groupCode: string; title: string; groupTypeCode: DietGroup['groupTypeCode']; fheqLevel?: number; minModules?: number; maxModules?: number; minCredits?: number; maxCredits?: number }) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DietGroup['groupTypeCode']>('compulsory');
  const [level, setLevel] = useState('');
  const [n, setN] = useState({ minModules: '', maxModules: '', minCredits: '', maxCredits: '' });
  const num = (v: string) => (v === '' ? undefined : Number(v));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const bounds = Object.fromEntries(Object.entries(n).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    const ok = await onSubmit({ groupCode: code.trim(), title: title.trim(), groupTypeCode: type, ...(num(level) !== undefined ? { fheqLevel: num(level) } : {}), ...bounds });
    if (ok) { setCode(''); setTitle(''); setLevel(''); setN({ minModules: '', maxModules: '', minCredits: '', maxCredits: '' }); }
  }
  return (
    <form className="grid grid-cols-1 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm font-medium md:col-span-4">Add a diet group</p>
      <LabelledField label="Code" htmlFor="dg-code" required><Input id="dg-code" value={code} onChange={(e) => setCode(e.target.value)} /></LabelledField>
      <LabelledField label="Title" htmlFor="dg-title" required><Input id="dg-title" value={title} onChange={(e) => setTitle(e.target.value)} /></LabelledField>
      <LabelledField label="Type" htmlFor="dg-type">
        <Select id="dg-type" value={type} onChange={(e) => setType(e.target.value as DietGroup['groupTypeCode'])}>
          {GROUP_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="FHEQ level" htmlFor="dg-level"><Input id="dg-level" type="number" min={3} max={8} value={level} onChange={(e) => setLevel(e.target.value)} /></LabelledField>
      {(['minModules', 'maxModules', 'minCredits', 'maxCredits'] as const).map((k) => (
        <LabelledField key={k} label={{ minModules: 'Minimum modules', maxModules: 'Maximum modules', minCredits: 'Minimum credits', maxCredits: 'Maximum credits' }[k]} htmlFor={`dg-${k}`}>
          <Input id={`dg-${k}`} type="number" min={0} value={n[k]} onChange={(e) => setN((v) => ({ ...v, [k]: e.target.value }))} />
        </LabelledField>
      ))}
      <Button type="submit" variant="secondary" disabled={!code.trim() || !title.trim()}>Add diet group</Button>
    </form>
  );
}

/**
 * A module's subject areas, with proportions that sum to 100 (Phase 4 D-27).
 * Joint-honours balance counts each module's credit towards its subjects.
 */
function ModuleSubjects({ modules, canConfigure }: { modules: ModuleSummary[]; canConfigure: boolean }) {
  const [moduleId, setModuleId] = useState('');
  const [shares, setShares] = useState<SubjectShare[]>([]);
  const [areas, setAreas] = useState<Array<{ code: string; displayLabel: string }>>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => { getFieldValueSet('module_subject', 'subject_area_code').then((v) => setAreas(v.members)).catch(() => undefined); }, []);
  useEffect(() => {
    setSaved(''); setError('');
    if (!moduleId) { setShares([]); return; }
    getModuleSubjects(moduleId).then(setShares).catch((err: unknown) => setError(message(err, 'Failed to load subject areas')));
  }, [moduleId]);

  const total = shares.reduce((sum, s) => sum + (Number.isFinite(s.proportionPercent) ? s.proportionPercent : 0), 0);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(''); setSaved('');
    try { setShares(await putModuleSubjects(moduleId, shares)); setSaved('Saved.'); } catch (err) { setError(message(err, 'Could not save')); }
  }

  return (
    <Card>
      <CardHeader title="Module subject areas" description="Used for joint-honours balance. Add subject areas in the subject-area-code value set first." />
      <CardBody>
        <div className="flex flex-col gap-3">
          <div className="w-80">
            <LabelledField label="Module" htmlFor="subj-module">
              <Select id="subj-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                <option value="">Choose a module…</option>
                {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.code} — {m.title}</option>)}
              </Select>
            </LabelledField>
          </div>
          {moduleId && (
            <form className="flex flex-col gap-2" onSubmit={(e) => void save(e)}>
              {shares.length === 0 && <p className="text-sm text-neutral-600">No subject areas: the module counts towards neither subject.</p>}
              {shares.map((s, i) => (
                <div key={i} className="flex items-end gap-3">
                  <LabelledField label="Subject area" htmlFor={`subj-area-${i}`}>
                    <Select id={`subj-area-${i}`} value={s.subjectAreaCode} disabled={!canConfigure}
                      onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, subjectAreaCode: e.target.value } : x)))}>
                      {areas.map((a) => <option key={a.code} value={a.code}>{a.displayLabel}</option>)}
                    </Select>
                  </LabelledField>
                  <LabelledField label="Proportion (%)" htmlFor={`subj-pct-${i}`}>
                    <Input id={`subj-pct-${i}`} type="number" min={1} max={100} value={String(s.proportionPercent)} disabled={!canConfigure}
                      onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, proportionPercent: Number(e.target.value) } : x)))} />
                  </LabelledField>
                  {canConfigure && <Button type="button" variant="ghost" onClick={() => setShares(shares.filter((_, j) => j !== i))}>Remove</Button>}
                </div>
              ))}
              {canConfigure && (
                <div className="flex items-center gap-3">
                  <Button type="button" variant="secondary" disabled={areas.length === 0}
                    onClick={() => setShares([...shares, { subjectAreaCode: areas[0]!.code, proportionPercent: Math.max(1, 100 - total) }])}>Add a subject area</Button>
                  <Button type="submit" disabled={shares.length > 0 && total !== 100}>Save</Button>
                  <span className={`text-xs ${shares.length > 0 && total !== 100 ? 'text-danger-600' : 'text-neutral-500'}`}>Total {total}%</span>
                </div>
              )}
              {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
              {saved && <p className="text-sm text-neutral-700" role="status">{saved}</p>}
            </form>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
