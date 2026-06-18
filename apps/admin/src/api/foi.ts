import { api } from './client.js';

export interface FoiRequest {
  requestId:        string;
  requestReference: string;
  receivedDate:     string;
  description:      string;
  legalBasis:       string | null;
  statusCode:       string;
  dueDate:          string | null;
  closedAt:         string | null;
  createdAt:        string;
}

export interface FoiExtract {
  extractId:    string;
  requestId:    string;
  querySummary: string;
  extractedAt:  string;
  extractedBy:  string;
  recordCount:  number;
}

export function listFoiRequests(): Promise<FoiRequest[]> {
  return api.get<FoiRequest[]>('/api/v1/regulatory/foi/requests');
}

export function createFoiRequest(body: {
  requestReference: string;
  receivedDate:     string;
  description:      string;
  legalBasis?:      string;
}): Promise<{ requestId: string }> {
  return api.post('/api/v1/regulatory/foi/requests', body);
}

export function getFoiRequest(requestId: string): Promise<FoiRequest> {
  return api.get<FoiRequest>(`/api/v1/regulatory/foi/requests/${requestId}`);
}

export function triggerFoiExtract(
  requestId:    string,
  querySummary: string,
): Promise<FoiExtract> {
  return api.post<FoiExtract>(`/api/v1/regulatory/foi/requests/${requestId}/extract`, { querySummary });
}

export function updateFoiStatus(requestId: string, statusCode: string): Promise<void> {
  return api.patch(`/api/v1/regulatory/foi/requests/${requestId}/status`, { statusCode });
}
