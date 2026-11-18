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
  overridden:    boolean;
  overrideUpdatedBy: string | null;
  overrideUpdatedAt: string | null;
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

/** Relabel or hide a platform value for this institution; null restores that part. */
export function setValueSetOverride(setCode: string, memberCode: string, body: {
  displayLabel?: string | null; description?: string | null; hidden?: boolean;
}): Promise<ValueSetMember> {
  return api.put(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}/override`, body);
}

export function clearValueSetOverride(setCode: string, memberCode: string): Promise<ValueSetMember> {
  return api.delete(`/api/v1/value-sets/${setCode}/members/${encodeURIComponent(memberCode)}/override`);
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
export function getFieldValueSet(entity: string, field: string, include?: 'all'): Promise<FieldValueSet> {
  return api.get<FieldValueSet>(`/api/v1/fields/${entity}/${field}/value-set${include ? '?include=all' : ''}`);
}
