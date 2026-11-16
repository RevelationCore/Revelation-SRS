import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Card, CardHeader, CardBody, Button, Input, Select, LabelledField, Badge, Spinner, StatusNotice,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import {
  type ModuleSummary, type RecognisedCredit, type RuleException, ENROLMENT_RULES,
  listRecognisedCredits, proposeRecognisedCredit, decideRecognisedCredit,
  listRuleExceptions, proposeRuleException, decideRuleException, revokeRuleException, listModules,
} from '../api/academicExceptions.js';
import { useAuth } from '../auth/AuthContext.js';
import { EnrolmentScoped } from '../components/EnrolmentScoped.js';
import { type CurriculumBinding, type RuleSet, getCurriculumBinding, listRuleSets } from '../api/programmeRules.js';
import { useValueSet } from '../hooks/useValueSet.js';

export function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

export const ruleLabel = (code: string) => ENROLMENT_RULES.find((r) => r.code === code)?.label ?? code;

/**
 * Recognised credit and rule exceptions for one of the student's enrolments
 * (BPR-D05). Each is proposed by one person and approved by another; once
 * approved it changes the rules applied to the student at registration,
 * module selection and progression.
 */
export function AcademicExceptionsTab({ personId, canPropose, canApprove, canReadBinding = false }: { personId: string; canPropose: boolean; canApprove: boolean; canReadBinding?: boolean }) {
  return (
    <EnrolmentScoped personId={personId} idPrefix="exceptions">
      {(enrolment) => (
        <>
          {canReadBinding && <CurriculumBindingNote enrolmentId={enrolment.enrolmentId} programmeId={enrolment.programmeId} />}
          <EnrolmentExceptions enrolmentId={enrolment.enrolmentId} canPropose={canPropose} canApprove={canApprove} />
        </>
      )}
    </EnrolmentScoped>
  );
}

function EnrolmentExceptions({ enrolmentId, canPropose, canApprove }: { enrolmentId: string; canPropose: boolean; canApprove: boolean }) {
  const { user } = useAuth();
  const [credits, setCredits] = useState<{ credits: RecognisedCredit[]; approvedCreditTotal: number } | null>(null);
  const [exceptions, setExceptions] = useState<RuleException[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, x] = await Promise.all([listRecognisedCredits(enrolmentId), listRuleExceptions(enrolmentId)]);
      setCredits(c); setExceptions(x);
    } catch (err) {
      setError(message(err, 'Failed to load credit and exceptions'));
    }
  }, [enrolmentId]);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>): Promise<boolean> => {
    setActionError('');
    try { await run(); await load(); return true; } catch (err) { setActionError(message(err, 'The action failed')); return false; }
  }, [load]);

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!credits || !exceptions) return <div className="flex justify-center py-8"><Spinner /></div>;
  const me = user?.sub;

  return (
    <>
      {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}

      <Card>
        <CardHeader
          title="Recognised credit"
          description={`Approved credit: ${credits.approvedCreditTotal}. Credit for an academic year counts as earned at progression; an exemption counts towards diet groups and the minimum credit load.`}
        />
        <CardBody>
          {credits.credits.length === 0 ? <p className="text-sm text-neutral-600">No recognised credit.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Recognition</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>
                  <TableHeaderCell>Credits</TableHeaderCell><TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {credits.credits.map((c) => (
                  <TableRow key={c.recognisedCreditId}>
                    <TableCell>{c.recognitionTypeCode}{c.fheqLevel ? <div className="text-xs text-neutral-500">Level {c.fheqLevel}</div> : null}</TableCell>
                    <TableCell className="text-sm">{c.sourceDescription}{c.evidenceRef ? <div className="text-xs text-neutral-500">{c.evidenceRef}</div> : null}</TableCell>
                    <TableCell>{c.creditValue}</TableCell>
                    <TableCell className="text-sm">{c.academicYear ?? '—'}</TableCell>
                    <TableCell>
                      <Badge value={c.statusCode} />
                      {c.decisionReason && <div className="text-xs text-neutral-500">{c.decisionReason}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.statusCode === 'proposed' && canApprove && (
                        <DecideControl
                          subject={`credit ${c.sourceDescription}`}
                          ownProposal={c.createdBy === me}
                          onDecide={(code, reason) => act(() => decideRecognisedCredit(c.recognisedCreditId, code, reason))}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canPropose && <CreditForm onSubmit={(body) => act(() => proposeRecognisedCredit(enrolmentId, body))} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rule exceptions"
          description="An approved waiver removes a rule for this student while it is in force; a variation replaces the rule's values."
        />
        <CardBody>
          {exceptions.length === 0 ? <p className="text-sm text-neutral-600">No rule exceptions.</p> : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Rule</TableHeaderCell><TableHeaderCell>Exception</TableHeaderCell>
                  <TableHeaderCell>In force</TableHeaderCell><TableHeaderCell>Authority</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {exceptions.map((x) => (
                  <TableRow key={x.ruleExceptionId}>
                    <TableCell>{ruleLabel(x.ruleCode)}<div className="text-xs text-neutral-500">{x.description}</div></TableCell>
                    <TableCell className="text-sm">
                      {x.exceptionTypeCode === 'variation' && x.variationValue
                        ? `Variation: ${Object.entries(x.variationValue).map(([k, v]) => `${k} ${v ?? 'none'}`).join(', ')}`
                        : 'Waiver'}
                    </TableCell>
                    <TableCell className="text-sm">{x.validFrom} – {x.validTo ?? 'open'}</TableCell>
                    <TableCell className="text-xs">{x.authorityRef ?? '—'}</TableCell>
                    <TableCell>
                      <Badge value={x.statusCode} />
                      {x.decisionReason && <div className="text-xs text-neutral-500">{x.decisionReason}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {x.statusCode === 'proposed' && canApprove && (
                        <DecideControl
                          subject={`exception to ${ruleLabel(x.ruleCode)}`}
                          ownProposal={x.createdBy === me}
                          onDecide={(code, reason) => act(() => decideRuleException(x.ruleExceptionId, code, reason))}
                        />
                      )}
                      {x.statusCode === 'approved' && canApprove && (
                        <RevokeControl subject={`exception to ${ruleLabel(x.ruleCode)}`} onRevoke={(reason) => act(() => revokeRuleException(x.ruleExceptionId, reason))} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canPropose && <ExceptionForm onSubmit={(body) => act(() => proposeRuleException(enrolmentId, body))} />}
        </CardBody>
      </Card>
    </>
  );
}

/** Approve or reject with a reason; the proposer is told someone else must decide. */
export function DecideControl({ subject, ownProposal, onDecide }: {
  subject: string; ownProposal: boolean; onDecide: (code: 'approved' | 'rejected', reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (ownProposal) return <span className="text-xs text-neutral-500">You proposed this; someone else must decide it.</span>;
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Decide<span className="sr-only"> {subject}</span></Button>;
  const id = `decide-${subject.replace(/\W+/g, '-')}`;
  return (
    <div className="inline-flex flex-col items-end gap-2">
      <LabelledField label="Reason" htmlFor={id} required>
        <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="w-56" />
      </LabelledField>
      <div className="flex gap-2">
        <Button size="sm" disabled={!reason.trim()} onClick={() => void onDecide('approved', reason.trim()).then((ok) => { if (ok) setOpen(false); })}>Approve</Button>
        <Button size="sm" variant="secondary" disabled={!reason.trim()} onClick={() => void onDecide('rejected', reason.trim()).then((ok) => { if (ok) setOpen(false); })}>Reject</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function RevokeControl({ subject, onRevoke }: { subject: string; onRevoke: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Revoke<span className="sr-only"> {subject}</span></Button>;
  const id = `revoke-${subject.replace(/\W+/g, '-')}`;
  return (
    <div className="inline-flex flex-col items-end gap-2">
      <LabelledField label="Reason for revoking" htmlFor={id} required>
        <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="w-56" />
      </LabelledField>
      <div className="flex gap-2">
        <Button size="sm" disabled={!reason.trim()} onClick={() => void onRevoke(reason.trim()).then((ok) => { if (ok) setOpen(false); })}>Revoke</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function CreditForm({ onSubmit }: { onSubmit: (body: Parameters<typeof proposeRecognisedCredit>[1]) => Promise<boolean> }) {
  const { members: types } = useValueSet('recognised_credit', 'recognition_type_code');
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [credits, setCredits] = useState('');
  const [level, setLevel] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [academicYear, setAcademicYear] = useState('');

  useEffect(() => { listModules().then(setModules).catch(() => undefined); }, []);
  const exemption = type === 'exemption';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit({
      recognitionTypeCode: type, sourceDescription: source.trim(), creditValue: Number(credits),
      ...(level ? { fheqLevel: Number(level) } : {}), ...(moduleId ? { moduleId } : {}),
      ...(evidenceRef.trim() ? { evidenceRef: evidenceRef.trim() } : {}), ...(academicYear ? { academicYear } : {}),
    });
    if (ok) { setType(''); setSource(''); setCredits(''); setLevel(''); setModuleId(''); setEvidenceRef(''); setAcademicYear(''); }
  }

  return (
    <form className="mt-4 grid grid-cols-2 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <p className="col-span-2 text-sm font-medium md:col-span-4">Propose recognised credit</p>
      <LabelledField label="Recognition" htmlFor="credit-type" required>
        <Select id="credit-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      <div className="col-span-1 md:col-span-2">
        <LabelledField label="Source (qualification, provider, year)" htmlFor="credit-source" required>
          <Input id="credit-source" value={source} onChange={(e) => setSource(e.target.value)} />
        </LabelledField>
      </div>
      <LabelledField label="Credits" htmlFor="credit-value" required>
        <Input id="credit-value" type="number" min={1} max={720} value={credits} onChange={(e) => setCredits(e.target.value)} />
      </LabelledField>
      <LabelledField label="FHEQ level" htmlFor="credit-level">
        <Select id="credit-level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Not stated</option>
          {[3, 4, 5, 6, 7, 8].map((l) => <option key={l} value={l}>Level {l}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label={exemption ? 'Exempt module' : 'Module'} htmlFor="credit-module" required={exemption}>
        {modules.length > 0 ? (
          <Select id="credit-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">{exemption ? 'Choose…' : 'None'}</option>
            {modules.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.code} — {m.title}</option>)}
          </Select>
        ) : (
          <Input id="credit-module" value={moduleId} onChange={(e) => setModuleId(e.target.value.trim())} placeholder="Module ID" />
        )}
      </LabelledField>
      <LabelledField label="Counts towards year" htmlFor="credit-year" hint="e.g. 2027-28; needed for credit to count at progression">
        <Input id="credit-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="YYYY-YY" />
      </LabelledField>
      <LabelledField label="Evidence reference" htmlFor="credit-evidence">
        <Input id="credit-evidence" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
      </LabelledField>
      <Button type="submit" disabled={!type || !source.trim() || !credits || (exemption && !moduleId)}>Propose credit</Button>
    </form>
  );
}

function ExceptionForm({ onSubmit }: { onSubmit: (body: Parameters<typeof proposeRuleException>[1]) => Promise<boolean> }) {
  const { members: types } = useValueSet('rule_exception', 'exception_type_code');
  const [ruleCode, setRuleCode] = useState('');
  const [type, setType] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [authorityRef, setAuthorityRef] = useState('');

  const rule = ENROLMENT_RULES.find((r) => r.code === ruleCode);
  const variation = type === 'variation';
  const filled = rule ? rule.fields.filter((f) => values[f.name]?.trim()) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit({
      ruleCode, exceptionTypeCode: type, description: description.trim(), validFrom,
      ...(validTo ? { validTo } : {}), ...(authorityRef.trim() ? { authorityRef: authorityRef.trim() } : {}),
      ...(variation ? { variationValue: Object.fromEntries(filled.map((f) => [f.name, Number(values[f.name])])) } : {}),
    });
    if (ok) { setRuleCode(''); setType(''); setValues({}); setDescription(''); setValidFrom(''); setValidTo(''); setAuthorityRef(''); }
  }

  return (
    <form className="mt-4 grid grid-cols-2 gap-3 items-end md:grid-cols-4" onSubmit={(e) => void submit(e)}>
      <p className="col-span-2 text-sm font-medium md:col-span-4">Propose a rule exception</p>
      <LabelledField label="Rule" htmlFor="exception-rule" required>
        <Select id="exception-rule" value={ruleCode} onChange={(e) => { setRuleCode(e.target.value); setValues({}); }}>
          <option value="">Choose…</option>
          {ENROLMENT_RULES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Exception" htmlFor="exception-type" required>
        <Select id="exception-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {types.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
        </Select>
      </LabelledField>
      {variation && rule?.fields.map((f) => (
        <LabelledField key={f.name} label={f.label} htmlFor={`exception-value-${f.name}`}>
          <Input id={`exception-value-${f.name}`} type="number" min={0} value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
        </LabelledField>
      ))}
      <div className="col-span-2">
        <LabelledField label="Description" htmlFor="exception-description" required>
          <Input id="exception-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </LabelledField>
      </div>
      <LabelledField label="In force from" htmlFor="exception-from" required>
        <Input id="exception-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </LabelledField>
      <LabelledField label="Until (optional)" htmlFor="exception-to">
        <Input id="exception-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </LabelledField>
      <LabelledField label="Authority" htmlFor="exception-authority" hint="e.g. the board minute">
        <Input id="exception-authority" value={authorityRef} onChange={(e) => setAuthorityRef(e.target.value)} />
      </LabelledField>
      {variation && rule && filled.length === 0 && (
        <div className="col-span-2"><StatusNotice>A variation needs at least one replacement value.</StatusNotice></div>
      )}
      <Button type="submit" disabled={!ruleCode || !type || !description.trim() || !validFrom || (variation && filled.length === 0)}>
        Propose exception
      </Button>
    </form>
  );
}

/** The rule set this enrolment's module selection and progression rules come from (BP-03-002). */
function CurriculumBindingNote({ enrolmentId, programmeId }: { enrolmentId: string; programmeId: string | null }) {
  const [binding, setBinding] = useState<CurriculumBinding | null | undefined>(undefined);
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  useEffect(() => {
    getCurriculumBinding(enrolmentId).then(setBinding).catch(() => setBinding(null));
    if (programmeId) listRuleSets(programmeId).then(setRuleSets).catch(() => undefined);
  }, [enrolmentId, programmeId]);
  if (binding === undefined) return null;
  const ruleSet = binding ? ruleSets.find((r) => r.programmeRuleSetId === binding.programmeRuleSetId) : undefined;
  return (
    <p className="text-sm text-neutral-700">
      {binding
        ? <>Programme rules: rule set <strong>{ruleSet?.ruleSetCode ?? binding.programmeRuleSetId}</strong> ({binding.decisionAuthorityCode}{binding.decisionReason ? `: ${binding.decisionReason}` : ''}).</>
        : 'Programme rules: not yet bound to a rule set (bound automatically at the first module selection).'}
    </p>
  );
}
