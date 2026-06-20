import { api } from './client.js';

export interface ValueSet {
  setCode:       string;
  displayName:   string;
  source:        string;
  sourceVersion: string | null;
  description:   string | null;
  isExtensible:  boolean;
}

export interface ValueSetMember {
  code:          string;
  displayLabel:  string;
  description:   string | null;
  sortOrder:     number;
  activeFrom:    string | null;
  activeTo:      string | null;
  isTenantOwned: boolean;
}

export function listValueSets(): Promise<ValueSet[]> {
  return api.get<ValueSet[]>('/api/v1/value-sets');
}

export function getValueSet(setCode: string): Promise<ValueSet> {
  return api.get<ValueSet>(`/api/v1/value-sets/${setCode}`);
}

export function updateValueSet(setCode: string, body: { label?: string; description?: string }): Promise<void> {
  return api.patch(`/api/v1/value-sets/${setCode}`, body);
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

export interface FieldValueSet {
  setCode:     string;
  displayName: string;
  members: {
    code:         string;
    displayLabel: string;
    description:  string | null;
    sortOrder:    number;
  }[];
}

export function getFieldValueSet(entity: string, field: string): Promise<FieldValueSet> {
  return api.get<FieldValueSet>(`/api/v1/fields/${entity}/${field}/value-set`);
}
