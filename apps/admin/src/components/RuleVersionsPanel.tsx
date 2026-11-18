import {
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, CodeLabel, useCodes,
} from '@revelation-srs/ui';

/** One rule a calculation used (Phase 5 D-35). */
export interface RuleVersion {
  ruleTypeCode: string;
  ruleKey: string | null;
  ruleId: string | null;
  versionId: string | null;
  programmeId: string | null;
  validFrom: string | null;
  source: string;
  value: unknown;
  exceptionId?: string;
  componentId?: string;
  planId?: string;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return 'Waived';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('; ');
}

/**
 * "How this was calculated": every rule a result, decision or
 * classification used, with the exact rule version, so a staff member can
 * explain it and a board can see when a built-in default stood in for a
 * configured rule.
 */
export function RuleVersionsPanel({ ruleVersions, title = 'How this was calculated' }: { ruleVersions: RuleVersion[]; title?: string }) {
  const ruleTypes = useCodes('academic_rule', 'rule_type_code');
  const defaults = ruleVersions.filter((r) => r.source === 'built-in-default').length;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-primary-600">
        {title}
        {defaults > 0 && <span className="ml-2 rounded bg-warning-100 px-1.5 py-0.5 text-warning-700">{defaults} built-in default{defaults > 1 ? 's' : ''}</span>}
      </summary>
      {ruleVersions.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-600">This was calculated before rule versions were recorded.</p>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Rule</TableHeaderCell><TableHeaderCell>Value</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell><TableHeaderCell>Valid from</TableHeaderCell><TableHeaderCell>Source</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {ruleVersions.map((r, i) => (
              <TableRow key={`${r.ruleTypeCode}-${r.versionId ?? r.source}-${i}`}>
                <TableCell className="text-xs">{ruleTypes.label(r.ruleTypeCode)}{r.ruleKey && <span className="block text-neutral-500">{r.ruleKey}</span>}</TableCell>
                <TableCell className="text-xs">{show(r.value)}</TableCell>
                <TableCell className="font-mono text-xs">{r.versionId ? r.versionId.slice(0, 8) : '—'}</TableCell>
                <TableCell className="text-xs">{r.validFrom ? new Date(r.validFrom).toLocaleDateString('en-GB') : '—'}</TableCell>
                <TableCell className="text-xs">
                  <span className={r.source === 'built-in-default' ? 'text-warning-700' : ''}><CodeLabel entity="rule_version_reference" field="source" code={r.source} /></span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </details>
  );
}
