import { api } from './client.js';

export interface EnrolmentVolumes {
  total:         number;
  byStatus:      Record<string, number>;
  byMode:        Record<string, number>;
  byYearOfEntry: Record<string, Record<string, number>>;
  byProgramme:   { programmeId: string; count: number }[];
  generatedAt:   string;
}

export function getEnrolmentVolumes(): Promise<EnrolmentVolumes> {
  return api.get<EnrolmentVolumes>('/api/v1/reporting/enrolment-volumes');
}
