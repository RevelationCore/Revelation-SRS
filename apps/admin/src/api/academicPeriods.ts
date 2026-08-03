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
