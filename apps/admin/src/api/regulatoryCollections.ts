import { api } from './client.js';

export interface RegulatoryCollection {
  regulatoryCollectionId: string;
  regulatorCode:          string;
  collectionTypeCode:     string;
  academicYear:           string;
  statusCode:             string;
  createdAt:              string;
  createdBy:              string;
}

export function listCollections(opts?: { regulatorCode?: string; academicYear?: string }): Promise<RegulatoryCollection[]> {
  const qs = new URLSearchParams();
  if (opts?.regulatorCode) qs.set('regulatorCode', opts.regulatorCode);
  if (opts?.academicYear)  qs.set('academicYear',  opts.academicYear);
  const q = qs.toString();
  return api.get(`/api/v1/regulatory/collections${q ? `?${q}` : ''}`);
}

export function createCollection(body: {
  regulatorCode:      string;
  collectionTypeCode: string;
  academicYear:       string;
}): Promise<{ regulatoryCollectionId: string }> {
  return api.post('/api/v1/regulatory/collections', body);
}

export function createSnapshot(
  collectionId: string,
  sourceTransactionTime: string,
): Promise<{ collectionSnapshotId: string }> {
  return api.post(`/api/v1/regulatory/collections/${collectionId}/snapshots`, { sourceTransactionTime });
}

export function addRecord(
  snapshotId: string,
  body: { enrolmentId?: string; recordPayload: Record<string, unknown> },
): Promise<{ regulatoryRecordId: string }> {
  return api.post(`/api/v1/regulatory/snapshots/${snapshotId}/records`, body);
}

export type ValidationIssueSeverity = 'blocking' | 'warning';

export function addValidationIssue(
  collectionId: string,
  body: { regulatoryRecordId?: string; severityCode: ValidationIssueSeverity; fieldCode?: string; message: string },
): Promise<{ issueId: string }> {
  return api.post(`/api/v1/regulatory/collections/${collectionId}/validation-issues`, body);
}

export function signOffCollection(collectionId: string, commentary?: string): Promise<{ signoffId: string }> {
  return api.post(`/api/v1/regulatory/collections/${collectionId}/signoff`, { commentary });
}

export function submitCollection(
  collectionId: string,
  body: { collectionSnapshotId: string; submissionReference?: string },
): Promise<{ submissionId: string }> {
  return api.post(`/api/v1/regulatory/collections/${collectionId}/submit`, body);
}
