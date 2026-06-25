import { api } from './client.js';

export interface IntegrationContract {
  contractId:               string;
  displayName:              string;
  ownerModuleCode:          string;
  directionCode:            string;
  patternType:              string;
  currentContractVersion:   string;
  dataClassificationCode:   string;
  deprecatedAt:             string | null;
  minimumSupportedVersion:  string | null;
  createdAt:                string;
}

export interface IntegrationRegistration {
  registrationId:           string;
  tenantId:                 string;
  contractId:               string;
  displayName:              string;
  contractVersion:          string;
  transportCode:            string;
  endpointUrl:              string | null;
  enabled:                  boolean;
  healthStatusCode:         string | null;
  lastHealthCheckAt:        string | null;
  lastSuccessfulExchangeAt: string | null;
  registeredAt:             string;
  lastUpdatedAt:            string;
}

/** Returned by the health-check endpoint — same shape as IntegrationRegistration. */
export type HealthCheckResult = IntegrationRegistration;

export interface IntegrationExchange {
  exchangeId:       string;
  registrationId:   string;
  contractId:       string;
  directionCode:    string;
  exchangeTypeCode: string;
  idempotencyKey:   string;
  correlationId:    string | null;
  sourceReference:  string | null;
  statusCode:       string;
  attemptCount:     number;
  lastAttemptAt:    string | null;
  lastError:        string | null;
  payloadHash:      string | null;
  payloadSummary:   Record<string, unknown> | null;
  receivedAt:       string | null;
  sentAt:           string | null;
  createdAt:        string;
}

export function listIntegrationContracts(): Promise<IntegrationContract[]> {
  return api.get<IntegrationContract[]>('/api/v1/integration-contracts');
}

export function getIntegrationContract(contractId: string): Promise<IntegrationContract> {
  return api.get<IntegrationContract>(`/api/v1/integration-contracts/${contractId}`);
}

export function createIntegrationContract(body: Record<string, unknown>): Promise<{ contractId: string }> {
  return api.post('/api/v1/integration-contracts', body);
}

export function listIntegrationRegistrations(): Promise<IntegrationRegistration[]> {
  return api.get<IntegrationRegistration[]>('/api/v1/integration-registrations');
}

export function createIntegrationRegistration(body: {
  contractId:    string;
  displayName?:  string;
  transportCode: string;
  endpointUrl?:  string;
}): Promise<IntegrationRegistration> {
  return api.post<IntegrationRegistration>('/api/v1/integration-registrations', body);
}

export function getIntegrationRegistration(registrationId: string): Promise<IntegrationRegistration> {
  return api.get<IntegrationRegistration>(`/api/v1/integration-registrations/${registrationId}`);
}

export function updateIntegrationRegistration(
  registrationId: string,
  body: Partial<Pick<IntegrationRegistration, 'displayName' | 'endpointUrl'>>,
): Promise<void> {
  return api.patch(`/api/v1/integration-registrations/${registrationId}`, body);
}

export function enableIntegration(registrationId: string): Promise<void> {
  return api.post(`/api/v1/integration-registrations/${registrationId}/enable`, {});
}

export function disableIntegration(registrationId: string): Promise<void> {
  return api.post(`/api/v1/integration-registrations/${registrationId}/disable`, {});
}

export function healthCheckIntegration(
  registrationId: string,
  statusCode: string,
): Promise<HealthCheckResult> {
  return api.post<HealthCheckResult>(
    `/api/v1/integration-registrations/${registrationId}/health-check`,
    { statusCode },
  );
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
  directionCode?:  string;
  limit?:          number;
  offset?:         number;
}): Promise<IntegrationExchange[]> {
  const qs = new URLSearchParams();
  if (params?.registrationId) qs.set('registrationId', params.registrationId);
  if (params?.statusCode)     qs.set('statusCode',     params.statusCode);
  if (params?.directionCode)  qs.set('directionCode',  params.directionCode);
  if (params?.limit  != null) qs.set('limit',          String(params.limit));
  if (params?.offset != null) qs.set('offset',         String(params.offset));
  const query = qs.toString();
  return api.get<IntegrationExchange[]>(`/api/v1/integration-exchanges${query ? `?${query}` : ''}`);
}
