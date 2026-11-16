import { api } from './client.js';

/** Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004). */

export type ApplicationStatus = 'received' | 'incomplete' | 'under-assessment' | 'recommended' | 'rejected' | 'offered' | 'withdrawn';
export type RoutingReason = 'incomplete' | 'duplicate' | 'restricted' | 'identity';

export interface Application {
  id: string;
  channelCode: string;
  sourceReference: string;
  cycle: string;
  personId: string | null;
  identityMatchCode: 'matched' | 'created' | 'needs-review';
  programmeId: string | null;
  intakeCode: string | null;
  modeOfStudyCode: string | null;
  latestPayloadId: string;
  ucasApplicationId: string | null;
  statusCode: ApplicationStatus;
  routingReasonCode: RoutingReason | null;
  recommendationCode: 'offer' | 'reject' | null;
  recommendationReason: string | null;
  recommendedBy: string | null;
  recommendedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationAssessment {
  id: string;
  assessmentTypeCode: string;
  outcomeCode: string;
  evidenceRef: string | null;
  evidenceVersion: string | null;
  note: string | null;
  assessedBy: string;
  assessedAt: string;
}

export interface ConditionEvidence {
  id: string;
  provenanceCode: string;
  evidenceRef: string;
  reportedValue: string | null;
  verified: boolean;
  receivedBy: string;
  receivedAt: string;
}

export interface OfferCondition {
  id: string;
  conditionTypeCode: string;
  description: string;
  requiredValue: string | null;
  statusCode: 'pending' | 'met' | 'waived' | 'unmet';
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  evidence: ConditionEvidence[];
}

export interface OfferConfirmation {
  decisionCode: 'confirmed' | 'confirmed-alternative' | 'unsuccessful';
  alternativeProgrammeId: string | null;
  reason: string | null;
  handoffWorkflowInstanceId: string | null;
  decidedBy: string;
  decidedAt: string;
}

export interface Offer {
  id: string;
  version: number;
  previousOfferId: string | null;
  programmeId: string;
  intakeCode: string;
  modeOfStudyCode: string;
  offerTypeCode: 'conditional' | 'unconditional';
  statusCode: string;
  expiresOn: string | null;
  decidedBy: string;
  decidedAt: string;
  changeReason: string | null;
  responseCode: 'accept' | 'decline' | null;
  responseSourceAt: string | null;
  conditions: OfferCondition[];
  confirmation: OfferConfirmation | null;
}

export interface ApplicationDetail extends Application {
  assessments: ApplicationAssessment[];
  offers: Offer[];
}

export interface ConditionInput { conditionTypeCode: string; description: string; requiredValue?: string }
export interface OfferTermsInput { offerTypeCode: 'conditional' | 'unconditional'; expiresOn?: string; conditions?: ConditionInput[] }

export const listApplicationWorklist = () => api.get<Application[]>('/api/v1/applications');
export const getApplication = (id: string) => api.get<ApplicationDetail>(`/api/v1/applications/${id}`);

export const confirmIdentity = (id: string, personId: string) =>
  api.post<ApplicationDetail>(`/api/v1/applications/${id}/identity`, { personId });
export const routeApplication = (id: string, reasonCode: 'incomplete' | 'duplicate' | 'restricted' | null) =>
  api.post<ApplicationDetail>(`/api/v1/applications/${id}/routing`, { reasonCode });
export const recordAssessment = (id: string, body: { assessmentTypeCode: string; outcomeCode: string; evidenceRef?: string; evidenceVersion?: string; note?: string }) =>
  api.post<ApplicationDetail>(`/api/v1/applications/${id}/assessments`, body);
export const recommendApplication = (id: string, body: { recommendationCode: 'offer' | 'reject'; reason: string }) =>
  api.post<ApplicationDetail>(`/api/v1/applications/${id}/recommendation`, body);
export const decideApplication = (id: string, body: { decisionCode: 'offer' | 'reject'; reason?: string; offer?: OfferTermsInput }) =>
  api.post<ApplicationDetail>(`/api/v1/applications/${id}/decision`, body);

export const recordOfferResponse = (offerId: string, body: { responseCode: 'accept' | 'decline'; sourceTimestamp: string }) =>
  api.post(`/api/v1/admissions-offers/${offerId}/response`, body);
export const changeOffer = (offerId: string, body: { reason: string; offerTypeCode?: 'conditional' | 'unconditional'; expiresOn?: string; conditions?: ConditionInput[] }) =>
  api.post(`/api/v1/admissions-offers/${offerId}/change`, body);
export const withdrawOffer = (offerId: string) => api.post(`/api/v1/admissions-offers/${offerId}/withdrawal`, {});
export const confirmOffer = (offerId: string, body: { decisionCode: 'confirmed' | 'confirmed-alternative' | 'unsuccessful'; alternativeProgrammeId?: string; reason?: string }) =>
  api.post(`/api/v1/admissions-offers/${offerId}/confirmation`, body);

export const recordConditionEvidence = (conditionId: string, body: { provenanceCode: string; evidenceRef: string; reportedValue?: string; verified?: boolean }) =>
  api.post(`/api/v1/offer-conditions/${conditionId}/evidence`, body);
export const decideCondition = (conditionId: string, body: { statusCode: 'met' | 'waived' | 'unmet'; note?: string }) =>
  api.post(`/api/v1/offer-conditions/${conditionId}/decision`, body);

export interface ProgrammeSummary { programmeId: string; code: string; title: string }
export const listProgrammes = () => api.get<ProgrammeSummary[]>('/api/v1/programmes');
