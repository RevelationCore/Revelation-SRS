import { api } from './client.js';

export interface StudentSummary {
  personId:        string;
  studentNumber:   string;
  legalFirstName:  string;
  legalFamilyName: string;
}

export interface PersonIdentity {
  versionId:          string;
  legalFirstName:     string;
  legalFamilyName:    string;
  preferredName:      string | null;
  dateOfBirth:        string | null;
  genderCode:         string | null;
  nationalityCode:    string | null;
  domicileCode:       string | null;
  emailInstitutional: string | null;
  emailPersonal:      string | null;
  phoneMobile:        string | null;
  validFrom:          string;
  recordedAt:         string;
}

export interface Student {
  personId:         string;
  studentNumber:    string;
  hesaId:           string | null;
  personStatusCode: string;
  sourceSystem:     string | null;
  createdAt:        string;
  identity:         PersonIdentity | null;
}

export type PersonStatusCode = 'prospective' | 'student' | 'alumnus' | 'deceased' | 'merged';

export interface CreateStudentInput {
  legalFirstName:     string;
  legalFamilyName:    string;
  preferredName?:     string;
  dateOfBirth?:       string;
  emailInstitutional?: string;
  emailPersonal?:     string;
  phoneMobile?:       string;
}

export type IdentityPatch = Partial<{
  legalFirstName:     string;
  legalFamilyName:    string;
  preferredName:      string;
  dateOfBirth:        string;
  emailInstitutional: string;
  emailPersonal:      string;
  phoneMobile:        string;
}>;

export function listStudents(
  limit = 20,
  offset = 0,
  search?: string,
  statusCode?: string,
): Promise<StudentSummary[]> {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search)     qs.set('search',     search);
  if (statusCode) qs.set('statusCode', statusCode);
  return api.get<StudentSummary[]>(`/api/v1/students?${qs.toString()}`);
}

export function getStudent(personId: string): Promise<Student> {
  return api.get<Student>(`/api/v1/students/${personId}`);
}

export function createStudent(input: CreateStudentInput): Promise<{ personId: string; studentNumber: string }> {
  return api.post('/api/v1/students', input);
}

export function updateStudentIdentity(personId: string, patch: IdentityPatch): Promise<void> {
  return api.patch(`/api/v1/students/${personId}/identity`, patch);
}

export function updateHesaId(personId: string, hesaId: string): Promise<void> {
  return api.patch(`/api/v1/students/${personId}/hesa-id`, { hesaId });
}

export function updatePersonStatus(personId: string, statusCode: PersonStatusCode): Promise<void> {
  return api.patch(`/api/v1/students/${personId}/status`, { statusCode });
}

export interface StudentNotification {
  id:        string;
  personId:  string;
  category:  string;
  title:     string;
  body:      string;
  linkUrl:   string | null;
  readAt:    string | null;
  createdAt: string;
}

export function listStudentNotifications(personId: string): Promise<StudentNotification[]> {
  return api.get<StudentNotification[]>(`/api/v1/admin/students/${personId}/notifications`);
}

// ── Wellbeing data ────────────────────────────────────────────────────────────

export interface DisabilityDeclaration {
  declarationId:          string;
  disabilityCategoryCode: string;
  declarationStatusCode:  string;
  declaredAt:             string;
  validFrom:              string;
  notes:                  string | null;
}

export function listDisabilityDeclarations(personId: string): Promise<DisabilityDeclaration[]> {
  return api.get<DisabilityDeclaration[]>(`/api/v1/students/${personId}/disability-declarations`);
}

export interface Adjustment {
  adjustmentId:       string;
  enrolmentId:        string;
  personId:           string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  notes:              string | null;
  actorId:            string;
  validFrom:          string;
  validTo:            string | null;
  recordedAt:         string;
  recordedUntil:      string | null;
}

export function listAdjustments(personId: string): Promise<Adjustment[]> {
  return api.get<Adjustment[]>(`/api/v1/students/${personId}/adjustments`);
}

export interface ExceptionalCircumstances {
  exceptionalCircumstancesId: string;
  enrolmentId:                string;
  personId:                   string;
  moduleOfferingId:           string | null;
  moduleCode:                 string | null;
  moduleTitle:                string | null;
  outcomeCode:                string;
  determinationDate:          string;
  notes:                      string | null;
  actorId:                    string;
  validFrom:                  string;
  validTo:                    string | null;
  recordedAt:                 string;
  recordedUntil:              string | null;
}

export function listExceptionalCircumstances(personId: string): Promise<ExceptionalCircumstances[]> {
  return api.get<ExceptionalCircumstances[]>(`/api/v1/students/${personId}/exceptional-circumstances`);
}
