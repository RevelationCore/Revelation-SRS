import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RuleVersionsPanel } from '../components/RuleVersionsPanel.js';
import {
  Card, CardHeader, CardBody, Button, Input, LabelledField, Badge, Spinner, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, CodeLabel, useCodes,
} from '@revelation-srs/ui';

import { ApiError } from '../api/client.js';
import { type ProgressionDecision, type ProgressionEvidence, evaluateProgression, getProgressionEvidence, listProgressionHistory } from '../api/awards.js';
import { ENROLMENT_RULES } from '../api/academicExceptions.js';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? (err.detail ?? err.message) : fallback;
}

const ruleLabel = (code: string) => ENROLMENT_RULES.find((r) => r.code === code)?.label ?? code;

/**
 * Progression (BP-06-001; D-3): the current decision for each year with how
 * it was reached, and the history. The registry runs an evaluation on the
 * board's behalf; the board ratifies, which locks the decision.
 */
export function ProgressionSection({ enrolmentId, canRun }: { enrolmentId: string; canRun: boolean }) {
  const exceptionTypes = useCodes('rule_exception', 'exception_type_code');
  const [decisions, setDecisions] = useState<ProgressionDecision[] | null>(null);
  const [evidence, setEvidence] = useState<Record<string, ProgressionEvidence | null>>({});
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [year, setYear] = useState('');

  const load = useCallback(async () => {
    try {
      const history = await listProgressionHistory(enrolmentId);
      setDecisions(history);
      const current = history.filter((d) => d.recordedUntil === null);
      const found = await Promise.all(current.map((d) => getProgressionEvidence(d.progressionDecisionId).catch(() => null)));
      setEvidence(Object.fromEntries(current.map((d, i) => [d.progressionDecisionId, found[i] ?? null])));
    } catch (err) { setError(message(err, 'Failed to load progression')); }
  }, [enrolmentId]);
  useEffect(() => { void load(); }, [load]);

  async function run(e: FormEvent) {
    e.preventDefault();
    setActionError('');
    try { await evaluateProgression(enrolmentId, year.trim()); setYear(''); await load(); } catch (err) { setActionError(message(err, 'The evaluation failed')); }
  }

  if (error) return <p className="text-sm text-danger-600" role="alert">{error}</p>;
  if (!decisions) return <div className="flex justify-center py-8"><Spinner /></div>;
  const current = decisions.filter((d) => d.recordedUntil === null).sort((a, b) => b.academicYear.localeCompare(a.academicYear));
  const lockedYears = new Set(current.filter((d) => d.locked).map((d) => d.academicYear));

  return (
    <Card>
      <CardHeader title="Progression" description="The decision for each year and how it was reached. A ratified decision is locked; change it through a correction case." />
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && <p className="text-sm text-danger-600" role="alert">{actionError}</p>}
          {current.length === 0 ? <p className="text-sm text-neutral-600">No progression decision yet.</p> : current.map((d) => {
            const ev = evidence[d.progressionDecisionId];
            return (
              <div key={d.progressionDecisionId} className="rounded border border-neutral-200 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">{d.academicYear} (year {d.yearOfStudy})</span>
                  <Badge value={d.decisionCode === 'progress' ? 'approved' : 'pending'} label={d.decisionCode} />
                  {d.locked && <Badge value="ratified" label="Ratified, locked" />}
                </div>
                {ev && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                    <div><dt className="text-xs text-neutral-500">Credits earned</dt><dd>{ev.earnedCredits} of {ev.requiredCredits} required</dd></div>
                    <div><dt className="text-xs text-neutral-500">Compensated</dt><dd>{ev.compensationCredits} (limit {ev.compensationCreditLimit})</dd></div>
                    <div><dt className="text-xs text-neutral-500">Unresolved</dt><dd>{ev.unresolvedCredits}</dd></div>
                    <div><dt className="text-xs text-neutral-500">Recognised credit</dt><dd>{ev.recognisedCredits}</dd></div>
                    {ev.minimumModulePasses !== null && (
                      <div><dt className="text-xs text-neutral-500">Modules passed</dt><dd>{ev.modulesPassed ?? '?'} of {ev.minimumModulePasses} required</dd></div>
                    )}
                    {ev.appliedExceptions.length > 0 && (
                      <div className="col-span-2 md:col-span-4">
                        <dt className="text-xs text-neutral-500">Rule exceptions applied</dt>
                        <dd>{ev.appliedExceptions.map((x) => `${ruleLabel(x.ruleCode)} (${exceptionTypes.label(x.exceptionTypeCode)})`).join('; ')}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {ev && <RuleVersionsPanel ruleVersions={ev.ruleVersions ?? []} />}
              </div>
            );
          })}

          {decisions.length > current.length && (
            <details>
              <summary className="cursor-pointer text-sm text-primary-600">Earlier evaluations ({decisions.length - current.length})</summary>
              <Table>
                <TableHead><tr><TableHeaderCell>Year</TableHeaderCell><TableHeaderCell>Decision</TableHeaderCell><TableHeaderCell>Superseded</TableHeaderCell></tr></TableHead>
                <TableBody>
                  {decisions.filter((d) => d.recordedUntil !== null).map((d) => (
                    <TableRow key={`${d.progressionDecisionId}-${d.recordedUntil}`}>
                      <TableCell>{d.academicYear}</TableCell>
                      <TableCell><CodeLabel entity="progression_decision" field="decision_code" code={d.decisionCode} /></TableCell>
                      <TableCell className="text-xs">{d.recordedUntil ? new Date(d.recordedUntil).toLocaleString('en-GB') : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}

          {canRun && (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void run(e)}>
              <LabelledField label="Academic year" htmlFor="progression-year" hint="e.g. 2026-27">
                <Input id="progression-year" value={year} onChange={(e) => setYear(e.target.value)} placeholder="YYYY-YY" />
              </LabelledField>
              <Button type="submit" disabled={!/^\d{4}-\d{2}$/.test(year.trim()) || lockedYears.has(year.trim())}>Run progression</Button>
              {lockedYears.has(year.trim()) && <span className="text-sm text-neutral-600">That year is ratified and locked.</span>}
            </form>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
