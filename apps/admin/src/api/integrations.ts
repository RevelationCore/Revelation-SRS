import { api } from './client.js';

export interface IntegrationContract {
  contractId:      string;
  name:            string;
  description:     string | null;
  version:         string;
  direction:       'inbound' | 'outbound' | 'bidirectional';
  protocolCode:    string;
  schemaRef:       string | null;
  isActive:        boolean;
  createdAt:       string;
}

export interface IntegrationRegistration {
  registrationId:   string;
  contractId:       string;
  name:             string;
  endpointUrl:      string | null;
  statusCode:       string;
  isEnabled:        boolean;
  lastHealthCheck:  string | null;
  healthStatusCode: string | null;
  createdAt:        string;
  updatedAt:        string;
}

export interface HealthCheckResult {
  registrationId: string;
  statusCode:     string;
  checkedAt:      string;
  latencyMs:      number | null;
  message:        string | null;
}

export interface IntegrationExchange {
  exchangeId:      string;
  registrationId:  string | null;
  direction:       string;
  statusCode:      string;
  eventType:       string | null;
  payload:         Record<string, unknown> | null;
  errorMessage:    string | null;
  occurredAt:      string;
  processedAt:     string | null;
}

export function listIntegrationContracts(): Promise<IntegrationContract[]> {
  return api.get<IntegrationContract[]>('/api/v1/integration-contracts');
}

export function getIntegrationContract(contractId: string): Promise<IntegrationContract> {
  return api.get<IntegrationContract>(`/api/v1/integration-contracts/${contractId}`);
}

export function createIntegrationContract(body: {
  name:         string;
  description?: string;
  version:      string;
  direction:    'inbound' | 'outbound' | 'bidirectional';
  protocolCode: string;
  schemaRef?:   string;
}): Promise<{ contractId: string }> {
  return api.post('/api/v1/integration-contracts', body);
}

export function listIntegrationRegistrations(): Promise<IntegrationRegistration[]> {
  return api.get<IntegrationRegistration[]>('/api/v1/integration-registrations');
}

export function createIntegrationRegistration(body: {
  contractId:   string;
  name:         string;
  endpointUrl?: string;
}): Promise<{ registrationId: string }> {
  return api.post('/api/v1/integration-registrations', body);
}

export function getIntegrationRegistration(registrationId: string): Promise<IntegrationRegistration> {
  return api.get<IntegrationRegistration>(`/api/v1/integration-registrations/${registrationId}`);
}

export function updateIntegrationRegistration(
  registrationId: string,
  body: Partial<Pick<IntegrationRegistration, 'name' | 'endpointUrl'>>,
): Promise<void> {
  return api.patch(`/api/v1/integration-registrations/${registrationId}`, body);
}

export function enableIntegration(registrationId: string): Promise<void> {
  return api.post(`/api/v1/integration-registrations/${registrationId}/enable`, {});
}

export function disableIntegration(registrationId: string): Promise<void> {
  return api.post(`/api/v1/integration-registrations/${registrationId}/disable`, {});
}

export function healthCheckIntegration(registrationId: string): Promise<HealthCheckResult> {
  return api.post<HealthCheckResult>(`/api/v1/integration-registrations/${registrationId}/health-check`, {});
}

export function replayIntegration(
  registrationId: string,
  body: { fromDate: string; toDate: string; eventTypes?: string[] },
): Promise<{ replayJobId: string }> {
  return api.post(`/api/v1/integration-registrations/${registrationId}/replay`, body);
}

export function listIntegrationExchanges(params?: {
  registrationId?: string;
  statusCode?:     string;
  direction?:      string;
  limit?:          number;
  offset?:         number;
}): Promise<IntegrationExchange[]> {
  const qs = new URLSearchParams();
  if (params?.registrationId) qs.set('registrationId', params.registrationId);
  if (params?.statusCode)     qs.set('statusCode',     params.statusCode);
  if (params?.direction)      qs.set('direction',      params.direction);
  if (params?.limit  != null) qs.set('limit',          String(params.limit));
  if (params?.offset != null) qs.set('offset',         String(params.offset));
  const query = qs.toString();
  return api.get<IntegrationExchange[]>(`/api/v1/integration-exchanges${query ? `?${query}` : ''}`);
}
