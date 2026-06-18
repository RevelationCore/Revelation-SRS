// SrsRegistryClient — interface and HTTP implementation for the SRS integration registry.
//
// SRS uses 'external-production' for live endpoints; the connector normalises this to 'live'
// so the connector's safety vocabulary is consistent across config and registry.

export type EndpointSafetyClass = 'simulator' | 'external-test' | 'live';

export interface RegistrationInfo {
  registrationId:      string;
  contractId:          string;
  enabled:             boolean;
  endpointUrl:         string | null;
  endpointSafetyClass: EndpointSafetyClass;
  liveTrafficApproved: boolean;
  consumerGroup:       string | null;
  healthStatusCode:    string | null;
}

export interface SrsRegistryClient {
  getRegistration(id: string): Promise<RegistrationInfo>;
  reportHealth(id: string, statusCode: string): Promise<void>;
}

export class RegistrationAccessError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'RegistrationAccessError';
  }
}

export class HttpSrsRegistryClient implements SrsRegistryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly bearerToken: string,
  ) {}

  async getRegistration(id: string): Promise<RegistrationInfo> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/integration-registrations/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${this.bearerToken}` } },
    );

    if (!res.ok) {
      throw new RegistrationAccessError(
        `SRS returned ${res.status} fetching registration ${id}`,
        res.status,
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
    return parseRegistration(raw);
  }

  async reportHealth(id: string, statusCode: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/integration-registrations/${encodeURIComponent(id)}/health-check`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ statusCode }),
      },
    );

    if (!res.ok) {
      throw new RegistrationAccessError(
        `SRS returned ${res.status} recording health-check for ${id}`,
        res.status,
      );
    }
  }
}

function normaliseSafetyClass(raw: unknown): EndpointSafetyClass {
  if (raw === 'external-production') return 'live';
  if (raw === 'external-test')       return 'external-test';
  return 'simulator';
}

function parseRegistration(raw: Record<string, unknown>): RegistrationInfo {
  return {
    registrationId:      raw['registrationId']      as string,
    contractId:          raw['contractId']           as string,
    enabled:             raw['enabled']              as boolean,
    endpointUrl:         (raw['endpointUrl']         as string | null) ?? null,
    endpointSafetyClass: normaliseSafetyClass(raw['endpointSafetyClass']),
    liveTrafficApproved: raw['liveTrafficApproved']  as boolean,
    consumerGroup:       (raw['consumerGroup']       as string | null) ?? null,
    healthStatusCode:    (raw['healthStatusCode']    as string | null) ?? null,
  };
}
