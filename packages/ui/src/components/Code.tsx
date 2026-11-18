import { createContext, useContext, useEffect, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

import { Badge } from './Badge.js';
import { Select } from './Input.js';

/**
 * Coded values, always shown with their label.
 *
 * Every coded field is backed by a value set (the field's entity and column
 * name). An app supplies a loader for a field's full value set — every
 * value, retired and hidden ones too, with the institution's own wording —
 * and these components show the label for any code a record holds, and
 * offer only selectable values in pickers.
 */

export interface CodeMember {
  code:          string;
  displayLabel:  string;
  description:   string | null;
  sortOrder:     number;
  /** Absent from older responses: treat as selectable. */
  selectable?:   boolean;
  active?:       boolean;
  hidden?:       boolean;
}

export type CodeLoader = (entity: string, field: string) => Promise<{ members: CodeMember[] }>;

interface CodeContextValue {
  load:  CodeLoader;
  cache: Map<string, Promise<CodeMember[]>>;
}

const CodeContext = createContext<CodeContextValue | null>(null);

export function CodeSetProvider({ load, children }: { load: CodeLoader; children: ReactNode }) {
  const [value] = useState<CodeContextValue>(() => ({ load, cache: new Map() }));
  return <CodeContext.Provider value={value}>{children}</CodeContext.Provider>;
}

/** Forget loaded value sets, e.g. after relabelling a value. */
export function useClearCodeCache(): () => void {
  const ctx = useContext(CodeContext);
  return () => ctx?.cache.clear();
}

export interface CodeSet {
  /** Every value, for labelling. */
  members:  CodeMember[];
  /** What a picker offers: selectable values, in order. */
  options:  CodeMember[];
  loading:  boolean;
  /** No value set is registered for the field, or it could not be loaded. */
  missing:  boolean;
  label:    (code: string | null | undefined) => string;
  find:     (code: string | null | undefined) => CodeMember | undefined;
}

export function useCodes(entity: string, field: string): CodeSet {
  const ctx = useContext(CodeContext);
  const key = `${entity}/${field}`;
  const [state, setState] = useState<{ members: CodeMember[]; loading: boolean; missing: boolean }>({ members: [], loading: true, missing: false });

  useEffect(() => {
    if (!ctx) { setState({ members: [], loading: false, missing: true }); return; }
    let cancelled = false;
    let pending = ctx.cache.get(key);
    if (!pending) {
      pending = ctx.load(entity, field).then((r) => [...r.members].sort((a, b) => a.sortOrder - b.sortOrder));
      // A failed load is not cached, so a later render can retry.
      void pending.catch(() => ctx.cache.delete(key));
      ctx.cache.set(key, pending);
    }
    pending
      .then((members) => { if (!cancelled) setState({ members, loading: false, missing: false }); })
      .catch(() => { if (!cancelled) setState({ members: [], loading: false, missing: true }); });
    return () => { cancelled = true; };
  }, [ctx, key, entity, field]);

  const find = (code: string | null | undefined) => (code ? state.members.find((m) => m.code === code) : undefined);
  return {
    members: state.members,
    options: state.members.filter((m) => m.selectable !== false),
    loading: state.loading,
    missing: state.missing,
    find,
    label: (code) => (code ? find(code)?.displayLabel ?? code : '—'),
  };
}

export interface CodeProps {
  entity: string;
  field:  string;
  code:   string | null | undefined;
  /** Shown when there is no code. */
  empty?: string;
  /** 'description': show the value's description (e.g. a student's own wording for a choice), falling back to its label. */
  show?:  'label' | 'description';
}

function textOf(m: CodeMember, show: 'label' | 'description' = 'label'): string {
  return show === 'description' ? m.description ?? m.displayLabel : m.displayLabel;
}

/** A code's label; its description on hover. An unknown code is shown as the code, marked. */
export function CodeLabel({ entity, field, code, empty = '—', show }: CodeProps) {
  const codes = useCodes(entity, field);
  if (!code) return <>{empty}</>;
  const m = codes.find(code);
  if (m) return <span title={show === 'description' ? undefined : m.description ?? undefined}>{textOf(m, show)}</span>;
  if (codes.loading) return <span className="text-neutral-400">{code}</span>;
  return (
    <span className="font-mono text-xs" title={codes.missing ? 'No value set is registered for this field' : 'Not in the value set for this field'}>
      {code}
    </span>
  );
}

/** A status badge carrying the code's label (the tone still follows the code). */
export function CodeBadge({ entity, field, code, empty = '—' }: CodeProps) {
  const codes = useCodes(entity, field);
  if (!code) return <>{empty}</>;
  return <Badge value={code} label={codes.label(code)} />;
}

export interface CodeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  entity:   string;
  field:    string;
  /** Controlled value; leave out (with `name` and `defaultValue`) for an uncontrolled form field. */
  value?:   string;
  onChange?: (code: string) => void;
  /** An empty first option, e.g. 'All statuses' or 'Choose…'. */
  emptyLabel?: string;
  /** Offer only these codes (e.g. a lifecycle's allowed next statuses), in the value set's order. */
  only?:    readonly string[];
  /** Leave these codes out. */
  exclude?: readonly string[];
  /** 'description': option text is each value's description, falling back to its label. */
  show?:    'label' | 'description';
}

/**
 * A picker of a field's selectable values. A value the record already holds
 * stays available even if it is now retired or hidden, marked as such, so
 * editing a record never silently changes it.
 */
export function CodeSelect({ entity, field, value, onChange, emptyLabel, only, exclude, show, ...rest }: CodeSelectProps) {
  const codes = useCodes(entity, field);
  let options = codes.options;
  if (only) options = options.filter((m) => only.includes(m.code));
  if (exclude) options = options.filter((m) => !exclude.includes(m.code));
  const current = value && !options.some((m) => m.code === value) ? codes.find(value) : undefined;
  const control = value === undefined ? {} : { value, onChange: (e: { target: { value: string } }) => onChange?.(e.target.value) };
  return (
    <Select {...control} {...rest}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {current && <option value={current.code}>{textOf(current, show)} (no longer offered)</option>}
      {value && !current && !options.some((m) => m.code === value) && !codes.loading && <option value={value}>{value}</option>}
      {options.map((m) => <option key={m.code} value={m.code} title={show === 'description' ? undefined : m.description ?? undefined}>{textOf(m, show)}</option>)}
    </Select>
  );
}
