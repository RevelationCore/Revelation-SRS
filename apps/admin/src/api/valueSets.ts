import { api } from './client.js';

export interface ValueSet {
  setCode:       string;
  displayName:   string;
  source:        string;
  sourceVersion: string | null;
  description:   string | null;
  isExtensible:  boolean;
  /** False for lifecycle statuses the system writes: relabel only. */
  allowsTenantHide: boolean;
  /** The data-model fields this set governs. */
  usedBy:        Array<{ entityName: string; fieldName: string }>;
}

export interface ValueSetMember {
  code:          string;
  displayLabel:  string;
  description:   string | null;
  sortOrder:     number;
  activeFrom:    string | null;
  activeTo:      string | null;
  active:        boolean;
  hidden:        boolean;
  selectable:    boolean;
  isTenantOwned: boolean;
  /** The platform's own wording, beside an institution's relabel. */
  platformLabel: string;
  platformDescription: string | null;
  /** This institution has reworded (in any language) or hidden it. */
  overridden:    boolean;
  /** Every wording for the value this institution can see. */
  wordings:      ValueSetWording[];
}

/** A wording that replaces a value's own label: this institution's or the platform's, in a language or any. */
export interface ValueSetWording {
  scope:        'tenant' | 'platform';
  localeCode:   string | null;
  displayLabel: string | null;
  description:  string | null;
  updatedBy:    string | null;
  updatedAt:    string;
}

export function listValueSets(): Promise<ValueSet[]> {
  return api.get<ValueSet[]>('/api/v1/value-sets');
}

export function getValueSet(setCode: string): Promise<ValueSet> {
  return api.get<ValueSet>(`/api/v1/value-sets/${setCode}`);
}

export function listValueSetMembers(setCode: string): Promise<ValueSetMember[]> {
  return api.get<ValueSetMember[]>(`/api/v1/value-sets/${setCode}/members`);
}

export function addValueSetMember(setCode: string, body: {
  code:         string;
  displayLabel: string;
  description?: string;
  sortOrder?:   number;
  activeFrom?:  string | null;
  activeTo?:    string | null;
}): Promise<void> {
  return api.post(`/api/v1/value-sets/${setCode}/members`, body);
}

export function updateValueSetMember(setCode: string, memberCode: string, body: {
  displayLabel?: string;
  description?:  string | null;
  sortOrder?:    number;
  activeFrom?:   string | null;
  activeTo?:     string | null;
}): Promise<void> {
  return api.patch(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}`, body);
}

/**
 * Set one wording for a value (no label and no description removes it):
 * this institution's, in a language or any; or scope 'platform', every
 * institution's in a language (platform translators only).
 */
export function setValueSetWording(setCode: string, memberCode: string, body: {
  localeCode?: string | null; displayLabel: string | null; description?: string | null; scope?: 'tenant' | 'platform';
}): Promise<ValueSetMember> {
  return api.put(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}/wording`, body);
}

/** Take a platform value out of this institution's pickers, or put it back. */
export function setValueSetHidden(setCode: string, memberCode: string, hidden: boolean): Promise<ValueSetMember> {
  return api.put(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}/hidden`, { hidden });
}

/** Back to the platform's wording in every language, and shown in pickers again. */
export function clearValueSetCustomisation(setCode: string, memberCode: string): Promise<ValueSetMember> {
  return api.delete(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}/customisation`);
}

export interface FieldValueSet {
  setCode:     string;
  displayName: string;
  members: {
    code:         string;
    displayLabel: string;
    description:  string | null;
    sortOrder:    number;
    /** Present on every response from the API; optional for older mocks. */
    active?:      boolean;
    hidden?:      boolean;
    selectable?:  boolean;
  }[];
}

/**
 * The value set for a data-model field. By default only what a picker should
 * offer; include 'all' for every value (retired and hidden ones too), to
 * label any code a record holds.
 */
export function getFieldValueSet(entity: string, field: string, include?: 'all', locale?: string): Promise<FieldValueSet> {
  const q = new URLSearchParams();
  if (include) q.set('include', include);
  if (locale) q.set('locale', locale);
  const qs = q.toString();
  return api.get<FieldValueSet>(`/api/v1/fields/${entity}/${field}/value-set${qs ? `?${qs}` : ''}`);
}
