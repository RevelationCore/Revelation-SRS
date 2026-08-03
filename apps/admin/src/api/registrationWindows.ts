import { api } from './client.js';

export interface RegistrationWindow {
  registrationWindowId: string;
  academicPeriodId:     string;
  academicYear:         string;
  periodCode:           string;
  opensAt:              string;
  closesAt:             string;
}

export function listRegistrationWindows(): Promise<RegistrationWindow[]> {
  return api.get<RegistrationWindow[]>('/api/v1/registration-windows');
}

export function createRegistrationWindow(body: {
  academicPeriodId: string;
  opensAt:          string;
  closesAt:         string;
}): Promise<{ registrationWindowId: string }> {
  return api.post('/api/v1/registration-windows', body);
}

export function updateRegistrationWindow(
  registrationWindowId: string,
  body: { opensAt: string; closesAt: string },
): Promise<void> {
  return api.patch(`/api/v1/registration-windows/${registrationWindowId}`, body);
}
