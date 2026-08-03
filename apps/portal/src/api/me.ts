import { api } from './client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StudentIdentity {
  legalFirstName:    string;
  legalFamilyName:   string;
  preferredName:     string | null;
  preferredPronouns: string | null;
  dateOfBirth:       string | null;
  genderCode:        string | null;
  nationalityCode:   string | null;
  emailInstitutional: string | null;
  emailPersonal:     string | null;
  phoneMobile:       string | null;
}

export interface StudentAddress {
  id:              string;
  addressTypeCode: string;
  line1:           string;
  line2:           string | null;
  city:            string | null;
  postcode:        string | null;
  countryCode:     string | null;
  validFrom:       string;
}

export interface StudentProfile {
  personId:         string;
  studentNumber:    string;
  hesaId:           string | null;
  personStatusCode: string;
  createdAt:        string;
  identity:         StudentIdentity | null;
}

export interface Enrolment {
  enrolmentId:         string;
  personId:            string;
  programmeId:         string | null;
  programmeCode:       string | null;
  programmeName:       string | null;
  statusCode:          string;
  modeOfStudyCode:     string;
  attendanceTypeCode:  string | null;
  academicYearOfEntry: string;
  feeBandCode:         string | null;
  fundingSourceCode:   string | null;
  startDate:           string | null;
  expectedEndDate:     string | null;
  actualEndDate:       string | null;
  validFrom:           string;
  recordedAt:          string;
}

export interface ModuleRegistration {
  moduleRegistrationId: string;
  enrolmentId:          string;
  moduleOfferingId:     string;
  moduleId:             string;
  moduleCode:           string;
  moduleTitle:          string;
  academicPeriodId:     string;
  periodCode:           string;
  creditValue:          number | null;
  statusCode:           string;
  registrationDate:     string;
  validFrom:            string;
  recordedAt:           string;
}

export interface TimetableEntry {
  moduleRegistrationId: string;
  enrolmentId:          string;
  moduleId:             string;
  moduleCode:           string;
  moduleTitle:          string;
  academicYear:         string;
  periodCode:           string;
  periodTypeCode:       string;
  startDate:            string;
  endDate:              string;
  deliveryModeCode:     string;
}

export interface ExamEntry {
  examEntryId:          string;
  moduleRegistrationId: string;
  examBoardId:          string;
  candidateNumber:      string;
  scheduledDate:        string | null;
  roomReference:        string | null;
  statusCode:           string;
  accommodations:       string[];
  validFrom:            string;
  recordedAt:           string;
  personId:             string;
}

export interface Adjustment {
  adjustmentId:      string;
  enrolmentId:       string;
  personId:          string;
  adjustmentTypeCode: string;
  scopeCode:         string;
  notes:             string | null;
  validFrom:         string;
  validTo:           string | null;
  recordedAt:        string;
}

export interface ExceptionalCircumstances {
  exceptionalCircumstancesId: string;
  enrolmentId:                string;
  personId:                   string;
  moduleOfferingId:           string | null;
  moduleCode:                 string | null;
  moduleTitle:                string | null;
  outcomeCode:                string;
  determinationDate:          string | null;
  notes:                      string | null;
  validFrom:                  string;
  recordedAt:                 string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export function getProfile(personId: string): Promise<StudentProfile> {
  return api.get(`/api/v1/students/${personId}`);
}

export function getAddresses(personId: string): Promise<StudentAddress[]> {
  return api.get(`/api/v1/students/${personId}/addresses`);
}

export function getEnrolments(personId: string): Promise<Enrolment[]> {
  return api.get(`/api/v1/students/${personId}/enrolments`);
}

export function getEnrolment(personId: string, enrolmentId: string): Promise<Enrolment> {
  return api.get(`/api/v1/students/${personId}/enrolments/${enrolmentId}`);
}

export interface EnrolmentHistoryEntry extends Enrolment {
  validTo:       string | null;
  recordedUntil: string | null;
}

export function getEnrolmentHistory(personId: string, enrolmentId: string): Promise<EnrolmentHistoryEntry[]> {
  return api.get(`/api/v1/students/${personId}/enrolments/${enrolmentId}/history`);
}

export interface EnrolmentTransition {
  transitionId:   string;
  enrolmentId:    string;
  fromStatusCode: string;
  toStatusCode:   string;
  reasonCode:     string | null;
  reasonText:     string | null;
  effectiveAt:    string;
  actorId:        string;
  createdAt:      string;
}

export function getEnrolmentTransitions(personId: string, enrolmentId: string): Promise<EnrolmentTransition[]> {
  return api.get(`/api/v1/students/${personId}/enrolments/${enrolmentId}/transitions`);
}

export interface FeeLiability {
  feeLiabilityId:    string;
  enrolmentId:       string;
  personId:          string;
  academicYear:      string;
  feeBandCode:       string | null;
  fundingSourceCode: string | null;
  statusCode:        string;
  generatedAt:       string;
}

export function getEnrolmentFeeLiabilities(personId: string, enrolmentId: string): Promise<FeeLiability[]> {
  return api.get(`/api/v1/students/${personId}/enrolments/${enrolmentId}/fee-liabilities`);
}

export function getModuleRegistrations(enrolmentId: string): Promise<ModuleRegistration[]> {
  return api.get(`/api/v1/module-registrations?enrolmentId=${enrolmentId}`);
}

export function getTimetable(enrolmentId: string): Promise<TimetableEntry[]> {
  return api.get(`/api/v1/module-registrations/timetable?enrolmentId=${enrolmentId}`);
}

export function getExamEntries(moduleRegistrationId: string): Promise<ExamEntry[]> {
  return api.get(`/api/v1/module-registrations/${moduleRegistrationId}/exam-timetable`);
}

export function getAdjustments(personId: string, enrolmentId?: string): Promise<Adjustment[]> {
  const qs = enrolmentId ? `?enrolmentId=${enrolmentId}` : '';
  return api.get(`/api/v1/students/${personId}/adjustments${qs}`);
}

export function getExceptionalCircumstances(
  personId:    string,
  enrolmentId?: string,
): Promise<ExceptionalCircumstances[]> {
  const qs = enrolmentId ? `?enrolmentId=${enrolmentId}` : '';
  return api.get(`/api/v1/students/${personId}/exceptional-circumstances${qs}`);
}

// ── Write operations (Stage 4) ────────────────────────────────────────────────

export interface PatchIdentityBody {
  preferredName?:     string | null;
  preferredPronouns?: string | null;
  emailPersonal?:     string | null;
  phoneMobile?:       string | null;
}

export function patchIdentity(personId: string, body: PatchIdentityBody): Promise<void> {
  return api.patch(`/api/v1/students/${personId}/identity`, body);
}

export interface PostAddressBody {
  addressTypeCode: string;
  line1:           string;
  line2?:          string | null;
  city?:           string | null;
  postcode?:       string | null;
  countryCode?:    string | null;
}

export function postAddress(personId: string, body: PostAddressBody): Promise<{ addressId: string }> {
  return api.post(`/api/v1/students/${personId}/addresses`, body);
}

export function getAddress(personId: string, addressId: string): Promise<StudentAddress> {
  return api.get(`/api/v1/students/${personId}/addresses/${addressId}`);
}

export function deleteAddress(personId: string, addressId: string): Promise<void> {
  return api.delete(`/api/v1/students/${personId}/addresses/${addressId}`);
}

export interface DisabilityDeclaration {
  declarationId:         string;
  disabilityCategoryCode: string;
  declarationStatusCode: string;
  declaredAt:            string;
  validFrom:             string;
  notes:                 string | null;
}

export function getDisabilityDeclarations(personId: string): Promise<DisabilityDeclaration[]> {
  return api.get(`/api/v1/students/${personId}/disability-declarations`);
}

export function postDisabilityDeclaration(
  personId: string,
  body: { disabilityCategoryCode: string; declarationStatusCode?: string; notes?: string | null },
): Promise<{ declarationId: string }> {
  return api.post(`/api/v1/students/${personId}/disability-declarations`, body);
}

export function patchDisabilityDeclaration(
  personId: string,
  declarationId: string,
  notes: string | null,
): Promise<void> {
  return api.patch(`/api/v1/students/${personId}/disability-declarations/${declarationId}`, { notes });
}

export function withdrawDisabilityDeclaration(personId: string, declarationId: string): Promise<void> {
  return api.post(`/api/v1/students/${personId}/disability-declarations/${declarationId}/withdrawal`, {});
}

export interface ModuleOffering {
  moduleOfferingId: string;
  moduleId:         string;
  moduleCode:       string;
  moduleTitle:      string;
  academicPeriodId: string;
  periodCode:       string;
  deliveryModeCode: string | null;
  capacity:         number | null;
  creditValue:      number | null;
}

export function getModuleOfferings(params?: { academicPeriodId?: string }): Promise<ModuleOffering[]> {
  const qs = params?.academicPeriodId ? `?academicPeriodId=${params.academicPeriodId}` : '';
  return api.get(`/api/v1/module-offerings${qs}`);
}

export function postModuleRegistration(body: {
  enrolmentId:      string;
  moduleOfferingId: string;
}): Promise<{ moduleRegistrationId: string }> {
  return api.post('/api/v1/module-registrations', body);
}

export function postWithdrawal(moduleRegistrationId: string): Promise<void> {
  return api.post(`/api/v1/module-registrations/${moduleRegistrationId}/withdrawal`, {});
}

export interface ChangeRequest {
  workflowInstanceId: string;
  workflowTaskId:      string;
  statusCode:          string;
  context:             Record<string, unknown>;
  startedAt:           string;
}

/** Requests module registration — requires personal-tutor/registry approval before it takes effect. */
export function requestModuleRegistration(body: {
  enrolmentId:      string;
  moduleOfferingId: string;
  reason?:          string;
}): Promise<ChangeRequest> {
  return api.post('/api/v1/module-registrations/requests', body);
}

/** Requests withdrawal from a module — requires personal-tutor/registry approval before it takes effect. */
export function requestWithdrawal(moduleRegistrationId: string, reason?: string): Promise<ChangeRequest> {
  return api.post(`/api/v1/module-registrations/${moduleRegistrationId}/withdrawal-requests`, { reason });
}

export function getMyModuleRegistrationRequests(personId: string): Promise<ChangeRequest[]> {
  return api.get(`/api/v1/students/${personId}/module-registration-requests`);
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

export function getModuleResult(moduleRegistrationId: string): Promise<ModuleResult> {
  return api.get(`/api/v1/module-registrations/${moduleRegistrationId}/result`);
}

export function submitExceptionalCircumstances(body: {
  enrolmentId:      string;
  description:      string;
  moduleOfferingId?: string;
}): Promise<{ exceptionalCircumstancesId: string }> {
  return api.post('/api/v1/exceptional-circumstances/submissions', body);
}

export interface ValueSetMember {
  code:         string;
  displayLabel: string;
  description:  string | null;
  sortOrder:    number;
}

export interface ValueSetDto {
  setCode:      string;
  displayName:  string;
  members:      ValueSetMember[];
}

export function getFieldValueSet(entity: string, field: string): Promise<ValueSetDto> {
  return api.get(`/api/v1/fields/${entity}/${field}/value-set`);
}

// ── Module selection proposals ─────────────────────────────────────────────────

export interface AcademicPeriod {
  academicPeriodId: string;
  academicYear:     string;
  periodCode:       string;
  periodTypeCode:   string;
  startDate:        string;
  endDate:          string;
}

export function getAcademicPeriods(): Promise<AcademicPeriod[]> {
  return api.get('/api/v1/academic-periods');
}

export interface Programme {
  programmeId: string;
  code:        string;
  title:       string;
  fheqLevel:   number | null;
}

export function getProgramme(programmeId: string): Promise<Programme> {
  return api.get(`/api/v1/programmes/${programmeId}`);
}

export interface ProposalValidationMessage {
  ruleTypeCode: string;
  message:      string;
  severity:     'error' | 'warning';
}

export interface ProposalItem {
  proposalItemId:       string;
  moduleId:             string;
  moduleCode:           string;
  moduleTitle:          string;
  creditValue:          number | null;
  fheqLevel:            number | null;
  moduleOfferingId:     string | null;
  preferenceRank:       number | null;
  sourceCode:           string;
  validationStateCode:  string;
  validationMessages:   ProposalValidationMessage[];
}

export interface ModuleSelectionProposal {
  moduleSelectionProposalId: string;
  enrolmentId:               string;
  academicPeriodId:          string;
  programmeRuleSetId:        string;
  statusCode:                string;
  submittedAt:               string | null;
  decidedAt:                 string | null;
  decisionAuthorityCode:     string | null;
  decisionReason:            string | null;
  workflowInstanceId:        string | null;
  items:                     ProposalItem[];
}

export function getModuleSelectionProposals(enrolmentId: string): Promise<ModuleSelectionProposal[]> {
  return api.get(`/api/v1/module-selection-proposals?enrolmentId=${enrolmentId}`);
}

export function getModuleSelectionProposal(proposalId: string): Promise<ModuleSelectionProposal> {
  return api.get(`/api/v1/module-selection-proposals/${proposalId}`);
}

export function postModuleSelectionProposal(body: {
  enrolmentId:      string;
  academicPeriodId: string;
  fheqLevel:        number;
}): Promise<{ moduleSelectionProposalId: string }> {
  return api.post('/api/v1/module-selection-proposals', body);
}

export function postProposalItem(
  proposalId: string,
  body: { moduleId: string; moduleOfferingId?: string },
): Promise<{ proposalItemId: string }> {
  return api.post(`/api/v1/module-selection-proposals/${proposalId}/items`, body);
}

export function deleteProposalItem(proposalId: string, proposalItemId: string): Promise<void> {
  return api.delete(`/api/v1/module-selection-proposals/${proposalId}/items/${proposalItemId}`);
}

export function postProposalSubmission(proposalId: string): Promise<ModuleSelectionProposal> {
  return api.post(`/api/v1/module-selection-proposals/${proposalId}/submission`, {});
}
