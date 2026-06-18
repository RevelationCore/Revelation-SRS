import { api } from './client.js';

export interface ModuleRegistration {
  moduleRegistrationId: string;
  enrolmentId:          string;
  moduleOfferingId:     string;
  moduleId:             string;
  academicPeriodId:     string;
  statusCode:           string;
  registrationDate:     string;
  validFrom:            string;
  validTo:              string | null;
  recordedAt:           string;
  recordedUntil:        string | null;
}

export interface TimetableEntry {
  moduleRegistrationId: string;
  enrolmentId:          string;
  moduleOfferingId:     string;
  moduleId:             string;
  moduleCode:           string;
  moduleTitle:          string;
  academicPeriodId:     string;
  academicYear:         string;
  periodCode:           string;
  periodTypeCode:       string;
  startDate:            string;
  endDate:              string;
  deliveryModeCode:     string | null;
}

export function listModuleRegistrations(enrolmentId: string): Promise<ModuleRegistration[]> {
  return api.get<ModuleRegistration[]>(`/api/v1/module-registrations?enrolmentId=${enrolmentId}&statusCode=registered`);
}

export function listAllModuleRegistrations(enrolmentId: string): Promise<ModuleRegistration[]> {
  return api.get<ModuleRegistration[]>(`/api/v1/module-registrations?enrolmentId=${enrolmentId}`);
}

export function getTimetable(enrolmentId: string): Promise<TimetableEntry[]> {
  return api.get<TimetableEntry[]>(`/api/v1/module-registrations/timetable?enrolmentId=${enrolmentId}`);
}

export function getRegistrationHistory(moduleRegistrationId: string): Promise<ModuleRegistration[]> {
  return api.get<ModuleRegistration[]>(`/api/v1/module-registrations/${moduleRegistrationId}/history`);
}

export function completeRegistration(moduleRegistrationId: string): Promise<void> {
  return api.post(`/api/v1/module-registrations/${moduleRegistrationId}/completion`, {});
}

export function withdrawRegistration(moduleRegistrationId: string): Promise<void> {
  return api.post(`/api/v1/module-registrations/${moduleRegistrationId}/withdrawal`, {});
}
