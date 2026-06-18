import { api } from './client.js';

export interface Mark {
  markId:                 string;
  moduleRegistrationId:  string;
  assessmentComponentId: string;
  assessmentSubmissionId: string | null;
  attemptNumber:         number;
  rawMark:               number;
  adjustedMark:          number | null;
  penaltyApplied:        boolean;
  penaltyPercent:        number | null;
  locked:                boolean;
  sourceSystem:          string | null;
  actorId:               string;
  validFrom:             string;
  validTo:               string | null;
  recordedAt:            string;
  recordedUntil:         string | null;
}

export interface AssessmentComponent {
  assessmentComponentId: string;
  moduleOfferingId:      string;
  componentTypeCode:     string;
  title:                 string;
  weighting:             number;
  passMarkOverride:      number | null;
  createdAt:             string;
  updatedAt:             string;
}

export interface ModuleResult {
  moduleResultId:       string;
  moduleRegistrationId: string;
  aggregateMark:        number;
  resultCode:           string;
  locked:               boolean;
  calculatedAt:         string;
  validFrom:            string;
  validTo:              string | null;
  recordedAt:           string;
  recordedUntil:        string | null;
}

export function listMarks(moduleRegistrationId: string): Promise<Mark[]> {
  return api.get<Mark[]>(`/api/v1/module-registrations/${moduleRegistrationId}/marks`);
}

export function submitMark(
  moduleRegistrationId: string,
  body: {
    assessmentComponentId: string;
    rawMark:               number;
    attemptNumber?:        number;
    sourceSystem?:         string;
    sourceReference?:      string;
  },
): Promise<{ markId: string }> {
  return api.post(`/api/v1/module-registrations/${moduleRegistrationId}/marks`, body);
}

export function correctMark(
  markId: string,
  body: { rawMark?: number; reason?: string },
): Promise<void> {
  return api.patch(`/api/v1/marks/${markId}`, body);
}

export function getMarkHistory(markId: string): Promise<Mark[]> {
  return api.get<Mark[]>(`/api/v1/marks/${markId}/history`);
}

export function listComponents(moduleOfferingId: string): Promise<AssessmentComponent[]> {
  return api.get<AssessmentComponent[]>(`/api/v1/module-offerings/${moduleOfferingId}/components`);
}

export function getModuleResult(moduleRegistrationId: string): Promise<ModuleResult> {
  return api.get<ModuleResult>(`/api/v1/module-registrations/${moduleRegistrationId}/result`);
}

export function getModuleResultHistory(moduleRegistrationId: string): Promise<ModuleResult[]> {
  return api.get<ModuleResult[]>(`/api/v1/module-registrations/${moduleRegistrationId}/result/history`);
}
