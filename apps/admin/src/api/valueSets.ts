import { api } from './client.js';

export interface ValueSet {
  setCode:     string;
  label:       string;
  description: string | null;
  memberCount: number;
}

export interface ValueSetMember {
  memberId:    string;
  setCode:     string;
  memberCode:  string;
  label:       string;
  sortOrder:   number | null;
  activeFrom:  string | null;
  activeTo:    string | null;
  metadata:    Record<string, unknown> | null;
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
  memberCode: string;
  label:      string;
  sortOrder?: number;
  activeFrom?: string;
  activeTo?:  string;
  metadata?:  Record<string, unknown>;
}): Promise<{ memberId: string }> {
  return api.post(`/api/v1/value-sets/${setCode}/members`, body);
}
