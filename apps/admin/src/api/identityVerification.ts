import { api } from './client.js';

/** Identity verification checks (BP-02-002; D-6). No document images are held. */

export interface VerificationCheck {
  verificationCheckId: string;
  statusCode: string;
  confidenceScore: number | null;
  fraudFlag: boolean;
  providerReference: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export const listVerificationChecks = (personId: string) => api.get<VerificationCheck[]>(`/api/v1/students/${personId}/identity-verifications`);
export const requestVerificationCheck = (personId: string, providerReference?: string) =>
  api.post<{ verificationCheckId: string }>(`/api/v1/students/${personId}/identity-verifications`, providerReference ? { providerReference } : {});
export const completeVerificationCheck = (personId: string, checkId: string, body: {
  statusCode: 'verified' | 'failed' | 'fraud-flagged'; confidenceScore?: number; fraudFlag?: boolean; providerReference?: string;
}) => api.post(`/api/v1/students/${personId}/identity-verifications/${checkId}/completion`, body);
