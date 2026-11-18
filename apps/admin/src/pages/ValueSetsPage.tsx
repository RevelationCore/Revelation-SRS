import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  PageHeader, Card, Button, Input, Select, LabelledField, Checkbox, Badge,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

import {
  type ValueSet,
  type ValueSetMember,
  addValueSetMember,
  clearValueSetCustomisation,
  listValueSetMembers,
  listValueSets,
  setValueSetHidden,
  setValueSetWording,
  updateValueSetMember,
} from '../api/valueSets.js';
import { ApiError } from '../api/client.js';
import { type Locale, listLocales } from '../api/globalisation.js';
import { Spinner } from '../components/Spinner.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

// Valid values for every coded field. Platform values keep their codes, so
// records, returns and integrations are unaffected; an institution can
// relabel them, and hide those it does not use (except lifecycle statuses the
// system writes). Its own values, in extensible sets, it adds, edits and retires.

type MemberStatus = 'active' | 'retired' | 'scheduled' | 'hidden';

function memberStatus(m: ValueSetMember): MemberStatus {
  const now = new Date();
  if (m.activeTo && new Date(m.activeTo) <= now) return 'retired';
  if (m.activeFrom && new Date(m.activeFrom) > now) return 'scheduled';
  if (m.hidden) return 'hidden';
  return 'active';
}

const STATUS_TEXT: Record<MemberStatus, string> = {
  active: 'In use', retired: 'Retired', scheduled: 'Scheduled', hidden: 'Hidden from pickers',
};
const STATUS_TONE: Record<MemberStatus, string> = {
  active: 'active', retired: 'closed', scheduled: 'pending', hidden: 'draft',
};

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? (e.detail ?? e.message) : fallback;
}

export function ValueSetsPage() {
  const { roles }               = useAuth();
  const canWrite                = userHasAnyPermission(roles, ['config:write']);
  const canTranslatePlatform    = userHasAnyPermission(roles, ['value-set:translate-platform']);
  const [locales,  setLocales]  = useState<Locale[]>([]);
  const [sets,     setSets]     = useState<ValueSet[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query,    setQuery]    = useState('');
  const [source,   setSource]   = useState('');

  useEffect(() => {
    // Languages a value can be worded in, besides the platform default.
    listLocales().then((l) => setLocales(l.filter((x) => x.active && !x.isPlatformDefault))).catch(() => setLocales([]));
  }, []);

  useEffect(() => {
    listValueSets()
      .then(setSets)
      .catch((e: unknown) => setError(errText(e, 'Failed to load value sets')))
      .finally(() => setLoading(false));
  }, []);

  const sources = useMemo(() => [...new Set(sets.map((s) => s.source))].sort(), [sets]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sets.filter((s) => (!source || s.source === source) && (!q
      || s.displayName.toLowerCase().includes(q)
      || s.setCode.toLowerCase().includes(q)
      || (s.description ?? '').toLowerCase().includes(q)
      || s.usedBy.some((f) => `${f.entityName}.${f.fieldName}`.toLowerCase().includes(q))));
  }, [sets, query, source]);

  return (
    <div>
      <PageHeader
        title="Value sets"
        description="The valid values behind every coded field and picklist. Relabel platform values in your institution's own words, hide those you do not use, and add your own values where a set allows it. Codes never change, so records, returns and integrations are unaffected."
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <LabelledField label="Search" htmlFor="vs-search" hint="Name, code, description or field, e.g. enrolment.status_code">
          <Input id="vs-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="w-80" />
        </LabelledField>
        <LabelledField label="Source" htmlFor="vs-source">
          <Select id="vs-source" value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </LabelledField>
        {!loading && <p className="pb-2 text-sm text-neutral-600" aria-live="polite">{shown.length} of {sets.length} sets</p>}
      </div>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-neutral-600">No value sets match.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => (
            <Card key={s.setCode}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => (prev === s.setCode ? null : s.setCode))}
                aria-expanded={expanded === s.setCode}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-neutral-900">{s.displayName}</span>
                    <span className="font-mono text-xs text-neutral-600">{s.setCode}</span>
                    {s.isExtensible && <span className="rounded bg-primary-100 text-primary-700 px-1.5 py-0.5 text-xs font-medium">You can add values</span>}
                    {!s.allowsTenantHide && <span className="rounded bg-neutral-100 text-neutral-700 px-1.5 py-0.5 text-xs font-medium">Relabel only</span>}
                  </div>
                  {s.description && <p className="text-xs text-neutral-500 mt-0.5">{s.description}</p>}
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {s.usedBy.length === 0 ? 'Not linked to a field' : `Used by ${s.usedBy.map((f) => `${f.entityName}.${f.fieldName}`).join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                  <span className="text-xs text-neutral-600">{s.source}</span>
                  {expanded === s.setCode
                    ? <ChevronUp className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                    : <ChevronDown className="h-4 w-4 text-neutral-500" aria-hidden="true" />}
                </div>
              </button>

              {expanded === s.setCode && <SetMembersPanel set={s} canWrite={canWrite} canTranslatePlatform={canTranslatePlatform} locales={locales} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Member panel ──────────────────────────────────────────────────────────────

function SetMembersPanel({ set, canWrite, canTranslatePlatform, locales }: {
  set: ValueSet; canWrite: boolean; canTranslatePlatform: boolean; locales: Locale[];
}) {
  const [langCode,    setLangCode]    = useState<string | null>(null);
  const [members,     setMembers]     = useState<ValueSetMember[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [showAdd,     setShowAdd]     = useState(false);
  const [editCode,    setEditCode]    = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  // The spinner shows on the first load only, so a change does not blank the table.
  const load = useCallback(async () => {
    try {
      setMembers(await listValueSetMembers(set.setCode));
    } catch (e) {
      setError(errText(e, 'Failed to load values'));
    } finally {
      setLoading(false);
    }
  }, [set.setCode]);

  useEffect(() => { void load(); }, [load]);

  const retiredCount = members.filter((m) => memberStatus(m) === 'retired').length;
  const visible = members.filter((m) => showRetired || memberStatus(m) !== 'retired');
  const retiredId = `vs-retired-${set.setCode}`;

  return (
    <div className="border-t border-neutral-100 px-4 py-4">
      {error && <p role="alert" className="mb-2 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <>
          {retiredCount > 0 && (
            <label htmlFor={retiredId} className="mb-3 flex items-center gap-2 text-xs text-neutral-700">
              <Checkbox id={retiredId} checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
              Show {retiredCount} retired {retiredCount === 1 ? 'value' : 'values'} (still shown on the records that hold them)
            </label>
          )}
          {visible.length > 0 ? (
            <div className="mb-4">
              <Table className="text-xs">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Code</TableHeaderCell>
                    <TableHeaderCell>Label</TableHeaderCell>
                    <TableHeaderCell>Description</TableHeaderCell>
                    <TableHeaderCell>Owner</TableHeaderCell>
                    <TableHeaderCell>Active</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {visible.map((m) =>
                    canWrite && editCode === m.code ? (
                      <EditMemberRow key={m.code} setCode={set.setCode} member={m}
                        onSaved={() => { setEditCode(null); void load(); }} onCancel={() => setEditCode(null)} onError={setError} />
                    ) : (
                      <Fragment key={m.code}>
                        <MemberRow member={m} set={set} canWrite={canWrite}
                          languagesOpen={langCode === m.code} onLanguages={() => setLangCode((c) => (c === m.code ? null : m.code))}
                          onEdit={() => setEditCode(m.code)} onChanged={() => void load()} onError={setError} />
                        {langCode === m.code && (
                          <LanguagesRow member={m} set={set} locales={locales} canWrite={canWrite} canTranslatePlatform={canTranslatePlatform}
                            onChanged={() => void load()} onError={setError} />
                        )}
                      </Fragment>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-neutral-600 mb-4">No values yet.</p>
          )}

          {set.isExtensible && canWrite && (
            showAdd ? (
              <AddMemberForm setCode={set.setCode}
                onAdded={() => { setShowAdd(false); void load(); }} onCancel={() => setShowAdd(false)} onError={setError} />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)}>+ Add a value</Button>
            )
          )}
        </>
      )}
    </div>
  );
}

// ── Read-only / action row ────────────────────────────────────────────────────

function MemberRow({
  member, set, canWrite, languagesOpen, onLanguages, onEdit, onChanged, onError,
}: {
  member:    ValueSetMember;
  set:       ValueSet;
  canWrite:  boolean;
  languagesOpen: boolean;
  onLanguages: () => void;
  onEdit:    () => void;
  onChanged: () => void;
  onError:   (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const status = memberStatus(member);

  async function act(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      onError(errText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const relabelled = member.overridden && member.displayLabel !== member.platformLabel;
  const actionClass = 'font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50';
  const name = `${member.displayLabel} (${member.code})`;
  const translations = member.wordings.filter((w) => w.localeCode !== null).length;

  return (
    <TableRow className={status === 'retired' ? 'opacity-60' : ''}>
      <TableCell className="font-mono">{member.code}</TableCell>
      <TableCell className="text-neutral-900">
        {member.displayLabel}
        {relabelled && <span className="block text-neutral-500">Platform: {member.platformLabel}</span>}
      </TableCell>
      <TableCell className="max-w-xs">{member.description ?? '—'}</TableCell>
      <TableCell>{member.isTenantOwned ? 'Your institution' : 'Platform'}</TableCell>
      <TableCell className="whitespace-nowrap">
        {member.activeFrom || member.activeTo
          ? `${member.activeFrom ? member.activeFrom.slice(0, 10) : 'always'} – ${member.activeTo ? member.activeTo.slice(0, 10) : 'open'}`
          : 'Always'}
      </TableCell>
      <TableCell><Badge value={STATUS_TONE[status]} label={STATUS_TEXT[status]} /></TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <button type="button" onClick={onLanguages} aria-expanded={languagesOpen} className="mr-3 font-medium text-primary-600 hover:text-primary-800"
          aria-label={`Languages for ${name}`}>
          Languages{translations > 0 ? ` (${translations})` : ''}
        </button>
        {!canWrite ? null : member.isTenantOwned ? (
          <span className="inline-flex items-center gap-3">
            <button type="button" onClick={onEdit} className={actionClass} aria-label={`Edit ${name}`}>Edit</button>
            {status !== 'retired' && (
              <button type="button" disabled={busy} className="font-medium text-warning-700 hover:text-warning-800 disabled:opacity-50"
                aria-label={`Retire ${name}`}
                onClick={() => void act(() => updateValueSetMember(set.setCode, member.code, { activeTo: new Date().toISOString().slice(0, 10) }), 'Retire failed')}>
                Retire
              </button>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-3">
            <button type="button" onClick={onEdit} className={actionClass} aria-label={`Relabel ${name}`}>Relabel</button>
            {set.allowsTenantHide && status !== 'retired' && (
              <button type="button" disabled={busy} className={actionClass}
                aria-label={`${member.hidden ? 'Show' : 'Hide'} ${name}`}
                onClick={() => void act(() => setValueSetHidden(set.setCode, member.code, !member.hidden), 'The change was not saved')}>
                {member.hidden ? 'Show' : 'Hide'}
              </button>
            )}
            {member.overridden && (
              <button type="button" disabled={busy} className="font-medium text-neutral-600 hover:text-neutral-800 disabled:opacity-50"
                aria-label={`Restore the platform wording for ${member.code}`}
                onClick={() => void act(() => clearValueSetCustomisation(set.setCode, member.code), 'Restore failed')}>
                Restore
              </button>
            )}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Languages: every wording of a value, by language ──────────────────────────

function LanguagesRow({ member, set, locales, canWrite, canTranslatePlatform, onChanged, onError }: {
  member: ValueSetMember; set: ValueSet; locales: Locale[]; canWrite: boolean; canTranslatePlatform: boolean;
  onChanged: () => void; onError: (msg: string) => void;
}) {
  const scopes: Array<'tenant' | 'platform'> = [
    ...(canWrite ? ['tenant' as const] : []),
    ...(canTranslatePlatform && !member.isTenantOwned ? ['platform' as const] : []),
  ];
  const [localeCode, setLocaleCode] = useState(locales[0]?.localeCode ?? '');
  const [scope, setScope] = useState<'tenant' | 'platform'>(scopes[0] ?? 'tenant');
  const [displayLabel, setDisplayLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!localeCode && locales[0]) setLocaleCode(locales[0].localeCode); }, [locales, localeCode]);

  const languageName = (code: string | null) => (code === null ? 'Any language' : locales.find((l) => l.localeCode === code)?.displayName ?? code);
  const translations = member.wordings.filter((w) => w.localeCode !== null);
  const formId = `vs-lang-${set.setCode}-${member.code}`;

  async function save(body: Parameters<typeof setValueSetWording>[2], after?: () => void) {
    setBusy(true);
    try {
      await setValueSetWording(set.setCode, member.code, body);
      after?.();
      onChanged();
    } catch (e) {
      onError(errText(e, 'The wording was not saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="bg-neutral-50">
      <td colSpan={7} className="px-4 py-3">
        <p className="mb-2 text-xs text-neutral-600">
          Wording in each language. A reader sees your institution&apos;s wording in their language first, then your wording in any language,
          then the platform&apos;s translation, then the value&apos;s own label.
        </p>
        {translations.length === 0 ? <p className="mb-2 text-xs text-neutral-600">No translations yet.</p> : (
          <table className="mb-3 w-full text-xs" aria-label={`Translations of ${member.code}`}>
            <thead><tr className="text-left text-neutral-500"><th className="py-1 pr-3 font-medium">Language</th><th className="py-1 pr-3 font-medium">Whose</th><th className="py-1 pr-3 font-medium">Label</th><th className="py-1 pr-3 font-medium">Description</th><th className="py-1"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {translations.map((w) => {
                const canEdit = w.scope === 'tenant' ? canWrite : canTranslatePlatform;
                return (
                  <tr key={`${w.scope}-${w.localeCode}`} className="border-t border-neutral-200">
                    <td className="py-1 pr-3">{languageName(w.localeCode)}</td>
                    <td className="py-1 pr-3">{w.scope === 'tenant' ? 'Your institution' : 'All institutions'}</td>
                    <td className="py-1 pr-3">{w.displayLabel ?? '—'}</td>
                    <td className="py-1 pr-3">{w.description ?? '—'}</td>
                    <td className="py-1 text-right">
                      {canEdit && (
                        <button type="button" disabled={busy} className="font-medium text-danger-600 hover:text-danger-800 disabled:opacity-50"
                          aria-label={`Remove the ${languageName(w.localeCode)} wording (${w.scope === 'tenant' ? 'your institution' : 'all institutions'})`}
                          onClick={() => void save({ localeCode: w.localeCode, displayLabel: null, description: null, scope: w.scope })}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {scopes.length > 0 && locales.length > 0 && (
          <form id={formId} className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); void save({ localeCode, displayLabel: displayLabel.trim() || null, description: description.trim() || null, scope }, () => { setDisplayLabel(''); setDescription(''); }); }}>
            <LabelledField label="Language" htmlFor={`${formId}-locale`}>
              <Select id={`${formId}-locale`} value={localeCode} onChange={(e) => setLocaleCode(e.target.value)} className="w-auto">
                {locales.map((l) => <option key={l.localeCode} value={l.localeCode}>{l.displayName}</option>)}
              </Select>
            </LabelledField>
            {scopes.length > 1 && (
              <LabelledField label="For" htmlFor={`${formId}-scope`}>
                <Select id={`${formId}-scope`} value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'platform')} className="w-auto">
                  {/* coded-values: not a code — who the wording is for */}
                  <option value="tenant">Your institution</option>
                  <option value="platform">All institutions</option>
                </Select>
              </LabelledField>
            )}
            <LabelledField label="Label" htmlFor={`${formId}-label`}>
              <Input id={`${formId}-label`} value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} />
            </LabelledField>
            <LabelledField label="Description" htmlFor={`${formId}-desc`} hint="Optional">
              <Input id={`${formId}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
            </LabelledField>
            <Button type="submit" size="sm" disabled={busy || (!displayLabel.trim() && !description.trim())}>Save translation</Button>
          </form>
        )}
      </td>
    </tr>
  );
}

// ── Inline edit row: an institution value's details, or a platform value's wording ──

function EditMemberRow({
  setCode, member, onSaved, onCancel, onError,
}: {
  setCode:  string;
  member:   ValueSetMember;
  onSaved:  () => void;
  onCancel: () => void;
  onError:  (msg: string) => void;
}) {
  const platform = !member.isTenantOwned;
  const [displayLabel, setDisplayLabel] = useState(member.displayLabel);
  const [description,  setDescription]  = useState(member.description ?? '');
  const [sortOrder,    setSortOrder]    = useState(String(member.sortOrder));
  const [activeFrom,   setActiveFrom]   = useState(member.activeFrom ? member.activeFrom.slice(0, 10) : '');
  const [activeTo,     setActiveTo]     = useState(member.activeTo ? member.activeTo.slice(0, 10) : '');
  const [saving,       setSaving]       = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!displayLabel.trim()) return;
    setSaving(true);
    try {
      if (platform) {
        // The platform's own wording is stored as no override.
        await setValueSetWording(setCode, member.code, {
          localeCode:   null,
          displayLabel: displayLabel.trim() === member.platformLabel ? null : displayLabel.trim(),
          description:  description.trim() === (member.platformDescription ?? '') ? null : description.trim() || null,
        });
      } else {
        await updateValueSetMember(setCode, member.code, {
          displayLabel: displayLabel.trim(),
          description:  description.trim() || null,
          sortOrder:    Number(sortOrder) || 0,
          activeFrom:   activeFrom || null,
          activeTo:     activeTo || null,
        });
      }
      onSaved();
    } catch (err) {
      onError(errText(err, 'Save failed'));
      setSaving(false);
    }
  }

  const inputCls = 'rounded border border-neutral-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 w-full';
  const formId = `vs-edit-${member.code}`;

  return (
    <tr className="bg-primary-50">
      <td className="py-2 pr-4 font-mono text-neutral-600">{member.code}</td>
      <td className="py-2 pr-4">
        {/* Focus moves into the field the user just asked to edit (WAI-ARIA edit-in-place). */}
        <input form={formId} aria-label={`Label for ${member.code}`} value={displayLabel}
          onChange={(e) => setDisplayLabel(e.target.value)} className={inputCls}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus />
        {platform && <span className="block text-neutral-500">Platform: {member.platformLabel}</span>}
      </td>
      <td className="py-2 pr-4">
        <input form={formId} aria-label={`Description for ${member.code}`} value={description}
          onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className={inputCls} />
      </td>
      <td className="py-2 pr-4">
        {platform ? 'Platform' : (
          <input form={formId} aria-label={`Sort order for ${member.code}`} type="number" min={0} value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)} className={`${inputCls} w-16`} />
        )}
      </td>
      <td className="py-2 pr-4">
        {platform ? '—' : (
          <span className="flex gap-1">
            <input form={formId} aria-label={`Active from for ${member.code}`} type="date" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} className={inputCls} />
            <input form={formId} aria-label={`Active to for ${member.code}`} type="date" value={activeTo} onChange={(e) => setActiveTo(e.target.value)} className={inputCls} />
          </span>
        )}
      </td>
      <td className="py-2 pr-4" />
      <td className="py-2 text-right whitespace-nowrap">
        <form id={formId} onSubmit={(e) => void handleSave(e)} className="inline-flex items-center gap-2">
          <button type="submit" disabled={saving} className="rounded bg-primary-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onCancel} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
        </form>
      </td>
    </tr>
  );
}

// ── Add value form ────────────────────────────────────────────────────────────

function AddMemberForm({
  setCode, onAdded, onCancel, onError,
}: {
  setCode:  string;
  onAdded:  () => void;
  onCancel: () => void;
  onError:  (msg: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd           = new FormData(e.currentTarget);
    const code         = String(fd.get('code')         ?? '').trim();
    const displayLabel = String(fd.get('displayLabel') ?? '').trim();
    const description  = String(fd.get('description')  ?? '').trim();
    const sortOrder    = Number(fd.get('sortOrder') ?? 0) || 0;
    const activeFrom   = String(fd.get('activeFrom') ?? '').trim();
    const activeTo     = String(fd.get('activeTo')   ?? '').trim();

    if (!code || !displayLabel) return;

    setAdding(true);
    try {
      await addValueSetMember(setCode, {
        code,
        displayLabel,
        ...(description ? { description } : {}),
        sortOrder,
        ...(activeFrom  ? { activeFrom  } : {}),
        ...(activeTo    ? { activeTo    } : {}),
      });
      onAdded();
    } catch (err) {
      onError(errText(err, 'Add failed'));
      setAdding(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 rounded-lg border border-primary-200 bg-primary-50 p-4">
      <h3 className="text-xs font-semibold text-neutral-700 mb-3">Add a value</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LabelledField label="Code" htmlFor="vs-add-code" required hint="Cannot be changed later">
          <Input id="vs-add-code" name="code" required placeholder="e.g. evening-study" />
        </LabelledField>
        <LabelledField label="Label" htmlFor="vs-add-label" required>
          <Input id="vs-add-label" name="displayLabel" required />
        </LabelledField>
        <LabelledField label="Description" htmlFor="vs-add-desc" hint="Optional">
          <Input id="vs-add-desc" name="description" />
        </LabelledField>
        <LabelledField label="Sort order" htmlFor="vs-add-sort">
          <Input id="vs-add-sort" name="sortOrder" type="number" min={0} defaultValue={0} />
        </LabelledField>
        <LabelledField label="Active from" htmlFor="vs-add-from" hint="Blank = always">
          <Input id="vs-add-from" name="activeFrom" type="date" />
        </LabelledField>
        <LabelledField label="Active to" htmlFor="vs-add-to" hint="Blank = never">
          <Input id="vs-add-to" name="activeTo" type="date" />
        </LabelledField>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={adding}>{adding ? 'Adding…' : 'Add value'}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
