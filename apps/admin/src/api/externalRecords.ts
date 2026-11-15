import { api } from './client.js';

export interface InboundField {
  name:      string;
  label:     string;
  type:      'integer' | 'text' | 'date' | 'code';
  required:  boolean;
  valueSet?: { entity: string; field: string };
  min?:      number;
}

export interface InboundFlow {
  flowCode:     string;
  sourceSystem: string;
  sourceLabel:  string;
  name:         string;
  defined:      boolean;
  fields:       InboundField[];
}

export interface ExternalRecord {
  externalRecordId: string;
  flowCode:         string;
  flowName:         string;
  sourceLabel:      string;
  personId:         string;
  recordKey:        string;
  payload:          Record<string, unknown>;
  summary:          string;
  observedAt:       string;
  receivedAt:       string;
  receivedVia:      string;
  current:          boolean;
}

export function listInboundFlows(): Promise<InboundFlow[]> {
  return api.get<InboundFlow[]>('/api/v1/inbound-flows');
}

export function listExternalRecords(personId: string): Promise<ExternalRecord[]> {
  return api.get<ExternalRecord[]>(`/api/v1/students/${personId}/external-records`);
}

export function enterExternalRecord(personId: string, flowCode: string, payload: Record<string, unknown>): Promise<ExternalRecord> {
  return api.post<ExternalRecord>(`/api/v1/students/${personId}/external-records/${encodeURIComponent(flowCode)}`, { payload });
}
