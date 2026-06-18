import { api } from './client.js';

export interface Tenant {
  tenantId:     string;
  slug:         string;
  displayName:  string;
  statusCode:   string;
  createdAt:    string;
}

export interface TenantConfiguration {
  tenantId:             string;
  academicYearStartMonth: number;
  defaultLocale:        string;
  defaultTimezone:      string;
  defaultCurrencyCode:  string;
  institutionName:      string;
  ukprn:                string | null;
  hesaSubscriberId:     string | null;
  ucasProviderCode:     string | null;
  updatedAt:            string;
}

export function listTenants(): Promise<Tenant[]> {
  return api.get<Tenant[]>('/api/v1/tenants');
}

export function createTenant(body: {
  slug:        string;
  displayName: string;
}): Promise<{ tenantId: string }> {
  return api.post('/api/v1/tenants', body);
}

export function getTenant(tenantId: string): Promise<Tenant> {
  return api.get<Tenant>(`/api/v1/tenants/${tenantId}`);
}

export function updateTenant(tenantId: string, body: Partial<Pick<Tenant, 'displayName' | 'statusCode'>>): Promise<void> {
  return api.patch(`/api/v1/tenants/${tenantId}`, body);
}

export function getTenantConfiguration(): Promise<TenantConfiguration> {
  return api.get<TenantConfiguration>('/api/v1/tenant/configuration');
}

export function updateTenantConfiguration(body: Partial<TenantConfiguration>): Promise<void> {
  return api.patch('/api/v1/tenant/configuration', body);
}
