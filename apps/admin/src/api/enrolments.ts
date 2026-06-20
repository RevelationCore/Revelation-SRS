import { api } from './client.js';

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
  startDate:           string | null;
  expectedEndDate:     string | null;
  actualEndDate:       string | null;
  feeBandCode:         string | null;
  fundingSourceCode:   string | null;
  slcReference:        string | null;
  ucasPersonalId:      string | null;
  validFrom:           string;
  recordedAt:          string;
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

export type TransitionAction = 'intermit' | 'suspend' | 'withdraw' | 'graduate' | 'reinstate';

export interface TransitionOptions {
  reasonCode?: string;
  reasonText?: string;
}

export interface CreateEnrolmentInput {
  personId:            string;
  modeOfStudyCode:     string;
  academicYearOfEntry: string;
  startDate:           string;
  expectedEndDate?:    string;
  feeBandCode?:        string;
  fundingSourceCode?:  string;
}

export const AVAILABLE_TRANSITIONS: Record<string, TransitionAction[]> = {
  enrolled:     ['intermit', 'suspend', 'withdraw', 'graduate'],
  intermitting: ['reinstate', 'withdraw'],
  suspended:    ['reinstate', 'withdraw'],
  withdrawn:    [],
  graduated:    [],
};

export function listStudentEnrolments(personId: string): Promise<Enrolment[]> {
  return api.get<Enrolment[]>(`/api/v1/students/${personId}/enrolments`);
}

export function createEnrolment(input: CreateEnrolmentInput): Promise<{ enrolmentId: string }> {
  return api.post('/api/v1/enrolments', input);
}

export function transitionEnrolment(
  enrolmentId: string,
  action: TransitionAction,
  options?: TransitionOptions,
): Promise<void> {
  return api.post(`/api/v1/enrolments/${enrolmentId}/${action}`, options ?? {});
}

export function listEnrolmentTransitions(enrolmentId: string): Promise<EnrolmentTransition[]> {
  return api.get<EnrolmentTransition[]>(`/api/v1/enrolments/${enrolmentId}/transitions`);
}

export function getEnrolmentHistory(enrolmentId: string): Promise<Enrolment[]> {
  return api.get<Enrolment[]>(`/api/v1/enrolments/${enrolmentId}/history`);
}

export function getEnrolment(enrolmentId: string): Promise<Enrolment> {
  return api.get<Enrolment>(`/api/v1/enrolments/${enrolmentId}`);
}
