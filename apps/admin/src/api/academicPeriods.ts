import { api } from './client.js';

export interface AcademicPeriod {
  academicPeriodId: string;
  academicYear:      string;
  periodCode:        string;
  periodTypeCode:    string;
  startDate:         string;
  endDate:           string;
}

export function listAcademicPeriods(academicYear?: string): Promise<AcademicPeriod[]> {
  const query = academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : '';
  return api.get<AcademicPeriod[]>(`/api/v1/academic-periods${query}`);
}

export interface ModuleOffering {
  moduleOfferingId: string;
  moduleId:         string;
  moduleCode:       string;
  moduleTitle:      string;
  academicPeriodId: string;
  periodCode:       string;
}

export function listModuleOfferings(academicPeriodId: string): Promise<ModuleOffering[]> {
  return api.get<ModuleOffering[]>(`/api/v1/module-offerings?academicPeriodId=${encodeURIComponent(academicPeriodId)}`);
}
