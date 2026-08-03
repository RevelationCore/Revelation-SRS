import { api } from './client.js';

export interface SupervisionCase {
  supervisionCaseId: string;
  enrolmentId:       string;
  statusCode:        string;
  ownerId:           string;
  degreeAim:         string | null;
  researchArea:      string | null;
  schoolOwner:       string | null;
  intendedStartDate: string | null;
  createdAt:         string;
}

export type PgrSupervisorRole = 'principal' | 'additional' | 'external';

export interface SupervisorNomination {
  nominationId:          string;
  supervisionCaseId:     string;
  personId:              string;
  roleDetailCode:        string;
  orgOwner:              string | null;
  externalOrganisation:  string | null;
  contractualStatusCode: string | null;
  accessLevelCode:       string | null;
  eligibilityCheckedAt:  string | null;
  nominatedAt:           string;
}

export interface StaffAssignment {
  assignmentId:          string;
  enrolmentId:           string;
  supervisionCaseId:     string;
  personId:              string;
  assignmentTypeCode:    string;
  roleDetailCode:        string;
  orgOwner:              string | null;
  externalOrganisation:  string | null;
  contractualStatusCode: string | null;
  accessLevelCode:       string | null;
  validFrom:             string;
  validTo:               string | null;
}

export function openSupervisionCase(body: {
  enrolmentId:        string;
  ownerId:            string;
  degreeAim?:         string;
  researchArea?:      string;
  schoolOwner?:       string;
  intendedStartDate?: string;
}): Promise<{ supervisionCaseId: string }> {
  return api.post('/api/v1/pgr/supervision-cases', body);
}

export function getSupervisionCase(caseId: string): Promise<SupervisionCase> {
  return api.get(`/api/v1/pgr/supervision-cases/${caseId}`);
}

export function nominateSupervisor(caseId: string, body: {
  personId:               string;
  roleDetailCode:         PgrSupervisorRole;
  orgOwner?:              string;
  externalOrganisation?:  string;
  contractualStatusCode?: string;
  accessLevelCode?:       string;
}): Promise<{ nominationId: string }> {
  return api.post(`/api/v1/pgr/supervision-cases/${caseId}/nominations`, body);
}

export function listNominations(caseId: string): Promise<SupervisorNomination[]> {
  return api.get(`/api/v1/pgr/supervision-cases/${caseId}/nominations`);
}

export function recordEligibilityCheck(caseId: string, nominationId: string): Promise<void> {
  return api.post(`/api/v1/pgr/supervision-cases/${caseId}/nominations/${nominationId}/eligibility-check`, {});
}

export function recordDirectorDecision(caseId: string, body: {
  decisionTypeCode: 'approve' | 'return' | 'reject';
  reasonText?:      string;
}): Promise<void> {
  return api.post(`/api/v1/pgr/supervision-cases/${caseId}/decision`, body);
}

export function publishSupervisionToCris(caseId: string): Promise<void> {
  return api.post(`/api/v1/pgr/supervision-cases/${caseId}/publish`, {});
}

export function listCurrentSupervision(enrolmentId: string): Promise<StaffAssignment[]> {
  return api.get(`/api/v1/enrolments/${enrolmentId}/supervision`);
}

// ── Progress review and milestones (BP-04-003) ─────────────────────────────

export type PgrReviewType = 'initial' | 'annual' | 'upgrade' | 'return-from-interruption';
export type PgrReviewMemberRole = 'chair' | 'independent-reviewer' | 'panel-member';
export type PgrReviewOutcome = 'satisfactory' | 'conditions' | 'referral' | 'transfer' | 'escalation';
export type PgrMilestoneType = 'confirmation-of-registration' | 'upgrade' | 'thesis-submission' | 'viva';

export interface ProgressReview {
  reviewId:          string;
  enrolmentId:       string;
  supervisionCaseId: string | null;
  reviewTypeCode:    string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         string;
}

export interface ReviewMember {
  memberId:         string;
  reviewId:         string;
  personId:         string;
  roleCode:         string;
  conflictTypeCode: string | null;
  declaredAt:       string | null;
  recusedAt:        string | null;
}

export interface ResearchMilestone {
  milestoneId:       string;
  enrolmentId:       string;
  reviewId:          string | null;
  milestoneTypeCode: string;
  achievedDate:      string;
  publishedAt:       string | null;
}

export function openReview(body: {
  enrolmentId:        string;
  reviewTypeCode:     PgrReviewType;
  ownerId:            string;
  supervisionCaseId?: string;
}): Promise<{ reviewId: string }> {
  return api.post('/api/v1/pgr/reviews', body);
}

export function getReview(reviewId: string): Promise<ProgressReview> {
  return api.get(`/api/v1/pgr/reviews/${reviewId}`);
}

export function addReviewMember(reviewId: string, body: {
  personId: string;
  roleCode: PgrReviewMemberRole;
}): Promise<{ memberId: string }> {
  return api.post(`/api/v1/pgr/reviews/${reviewId}/members`, body);
}

export function listReviewMembers(reviewId: string): Promise<ReviewMember[]> {
  return api.get(`/api/v1/pgr/reviews/${reviewId}/members`);
}

export function declareReviewConflict(memberId: string, conflictTypeCode: string): Promise<void> {
  return api.post(`/api/v1/pgr/reviews/members/${memberId}/conflict`, { conflictTypeCode });
}

export function recuseReviewMember(memberId: string): Promise<void> {
  return api.post(`/api/v1/pgr/reviews/members/${memberId}/recuse`, {});
}

export function recordReviewEvidence(reviewId: string, body: {
  evidenceRef:        string;
  classificationCode: string;
  sourceSystem:       string;
}): Promise<{ evidenceId: string }> {
  return api.post(`/api/v1/pgr/reviews/${reviewId}/evidence`, body);
}

export function recordReviewOutcome(reviewId: string, body: {
  outcomeCode: PgrReviewOutcome;
  reasonText?: string;
}): Promise<void> {
  return api.post(`/api/v1/pgr/reviews/${reviewId}/outcome`, body);
}

export function publishMilestone(reviewId: string, body: {
  milestoneTypeCode: PgrMilestoneType;
  achievedDate:      string;
}): Promise<{ milestoneId: string }> {
  return api.post(`/api/v1/pgr/reviews/${reviewId}/milestones`, body);
}

export function listResearchMilestones(enrolmentId: string): Promise<ResearchMilestone[]> {
  return api.get(`/api/v1/enrolments/${enrolmentId}/research-milestones`);
}

// ── Thesis submission and examination (BP-05-010) ──────────────────────────

export type PgrThesisFormat = 'traditional' | 'practice-based' | 'published-work';
export type PgrExaminerRole = 'internal' | 'external';
export type PgrExaminationOutcome = 'pass' | 'pass-minor-corrections' | 'pass-major-corrections' | 'resubmission' | 'fail';

export interface ExaminationCase {
  examinationCaseId: string;
  enrolmentId:       string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         string;
}

export interface ThesisSubmission {
  submissionId:          string;
  examinationCaseId:     string;
  versionNumber:         number;
  formatCode:            string;
  declarationConfirmed:  boolean;
  restricted:            boolean;
  restrictionReasonText: string | null;
  restrictionReviewDate: string | null;
  storageRef:            string;
  submittedAt:           string;
}

export interface ExaminerAppointment {
  appointmentId:         string;
  examinationCaseId:     string;
  personId:              string;
  examinerRoleCode:      string;
  independenceCheckedAt: string | null;
  conflictTypeCode:      string | null;
  recusedAt:             string | null;
  confirmedAt:           string | null;
}

export interface ExaminerReport {
  reportId:              string;
  examinationCaseId:     string;
  examinerAppointmentId: string;
  reportRef:             string;
  recommendationCode:    string | null;
  submittedAt:           string;
}

export interface VivaEvent {
  vivaEventId:             string;
  examinationCaseId:       string;
  heldAt:                  string;
  jointRecommendationText: string;
  recordedAt:              string;
}

export interface ExaminationOutcomeRecord {
  outcomeId:         string;
  examinationCaseId: string;
  outcomeCode:       string;
  decidedBy:         string;
  decidedAt:         string;
}

export interface CorrectionRequirement {
  requirementId: string;
  outcomeId:     string;
  deadlineDate:  string;
  completedAt:   string | null;
  completedBy:   string | null;
}

export function submitThesis(body: {
  enrolmentId:            string;
  ownerId:                string;
  formatCode:             PgrThesisFormat;
  declarationConfirmed:   boolean;
  storageRef:             string;
  restricted?:            boolean;
  restrictionReasonText?: string;
  restrictionReviewDate?: string;
}): Promise<{ examinationCaseId: string; submissionId: string }> {
  return api.post('/api/v1/pgr/examinations', body);
}

export function getExaminationCase(caseId: string): Promise<ExaminationCase> {
  return api.get(`/api/v1/pgr/examinations/${caseId}`);
}

export function getThesisSubmission(caseId: string): Promise<ThesisSubmission> {
  return api.get(`/api/v1/pgr/examinations/${caseId}/thesis-submission`);
}

export function nominateExaminer(caseId: string, body: {
  personId:         string;
  examinerRoleCode: PgrExaminerRole;
}): Promise<{ appointmentId: string }> {
  return api.post(`/api/v1/pgr/examinations/${caseId}/examiners`, body);
}

export function listExaminerAppointments(caseId: string): Promise<ExaminerAppointment[]> {
  return api.get(`/api/v1/pgr/examinations/${caseId}/examiners`);
}

export function recordIndependenceCheck(appointmentId: string): Promise<void> {
  return api.post(`/api/v1/pgr/examinations/examiners/${appointmentId}/independence-check`, {});
}

export function declareExaminerConflict(appointmentId: string, conflictTypeCode: string): Promise<void> {
  return api.post(`/api/v1/pgr/examinations/examiners/${appointmentId}/conflict`, { conflictTypeCode });
}

export function recuseExaminer(appointmentId: string): Promise<void> {
  return api.post(`/api/v1/pgr/examinations/examiners/${appointmentId}/recuse`, {});
}

export function approveExaminerPanel(caseId: string): Promise<void> {
  return api.post(`/api/v1/pgr/examinations/${caseId}/examiners/approve`, {});
}

export function recordExaminerReport(caseId: string, body: {
  examinerAppointmentId: string;
  reportRef:             string;
  recommendationCode?:   string;
}): Promise<{ reportId: string }> {
  return api.post(`/api/v1/pgr/examinations/${caseId}/examiner-reports`, body);
}

export function listExaminerReports(caseId: string): Promise<ExaminerReport[]> {
  return api.get(`/api/v1/pgr/examinations/${caseId}/examiner-reports`);
}

export function recordViva(caseId: string, body: {
  heldAt:                  string;
  jointRecommendationText: string;
}): Promise<{ vivaEventId: string }> {
  return api.post(`/api/v1/pgr/examinations/${caseId}/viva`, body);
}

export function getViva(caseId: string): Promise<VivaEvent | null> {
  return api.get(`/api/v1/pgr/examinations/${caseId}/viva`);
}

export function ratifyOutcome(caseId: string, body: {
  outcomeCode:          PgrExaminationOutcome;
  correctionsDeadline?: string;
}): Promise<{ outcomeId: string }> {
  return api.post(`/api/v1/pgr/examinations/${caseId}/outcome`, body);
}

export function getLatestOutcome(caseId: string): Promise<ExaminationOutcomeRecord | null> {
  return api.get(`/api/v1/pgr/examinations/${caseId}/outcome`);
}

export function listCorrectionRequirements(outcomeId: string): Promise<CorrectionRequirement[]> {
  return api.get(`/api/v1/pgr/examinations/outcomes/${outcomeId}/corrections`);
}

export function completeCorrectionRequirement(requirementId: string): Promise<void> {
  return api.post(`/api/v1/pgr/examinations/corrections/${requirementId}/complete`, {});
}

// ── Completion and award conferral (BP-06-006) ─────────────────────────────

export interface CompletionCase {
  completionCaseId:  string;
  enrolmentId:       string;
  examinationCaseId: string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         string;
}

export interface FinalThesisDeposit {
  depositId:              string;
  completionCaseId:       string;
  depositRef:             string;
  ipDeclarationConfirmed: boolean;
  confirmedBy:            string;
  confirmedAt:            string;
}

export function openCompletionCase(body: {
  examinationCaseId: string;
  ownerId:           string;
}): Promise<{ completionCaseId: string }> {
  return api.post('/api/v1/pgr/completions', body);
}

export function getCompletionCase(completionCaseId: string): Promise<CompletionCase> {
  return api.get(`/api/v1/pgr/completions/${completionCaseId}`);
}

export function recordFinalDeposit(completionCaseId: string, body: {
  depositRef:             string;
  ipDeclarationConfirmed: boolean;
}): Promise<{ depositId: string }> {
  return api.post(`/api/v1/pgr/completions/${completionCaseId}/deposit`, body);
}

export function getFinalDeposit(completionCaseId: string): Promise<FinalThesisDeposit | null> {
  return api.get(`/api/v1/pgr/completions/${completionCaseId}/deposit`);
}

export function recordCompletion(completionCaseId: string): Promise<void> {
  return api.post(`/api/v1/pgr/completions/${completionCaseId}/complete`, {});
}

export function conferResearchAward(completionCaseId: string, body: {
  qualificationCode: string;
  awardDate:         string;
}): Promise<{ awardId: string }> {
  return api.post(`/api/v1/pgr/completions/${completionCaseId}/award`, body);
}
