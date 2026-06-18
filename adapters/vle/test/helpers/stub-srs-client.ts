import {
  RegistrationAccessError,
  type RegistrationInfo,
  type SrsRegistryClient,
} from '../../src/registry/client.js';

export interface HealthCheckRecord {
  registrationId: string;
  statusCode:     string;
}

/**
 * In-memory stub implementing SrsRegistryClient.
 *
 * Seed registrations via seed(), mutate them via update(), and read
 * recorded health checks via healthChecks() for test assertions.
 * Optionally set getError to simulate auth failures or network errors.
 */
export class StubSrsRegistryClient implements SrsRegistryClient {
  #registrations = new Map<string, RegistrationInfo>();
  #healthChecks: HealthCheckRecord[] = [];
  getError: { httpStatus: number; message: string } | null = null;

  seed(reg: RegistrationInfo): void {
    this.#registrations.set(reg.registrationId, { ...reg });
  }

  update(registrationId: string, patch: Partial<Omit<RegistrationInfo, 'registrationId'>>): void {
    const current = this.#registrations.get(registrationId);
    if (!current) throw new Error(`StubSrsRegistryClient: unknown registration ${registrationId}`);
    this.#registrations.set(registrationId, { ...current, ...patch });
  }

  healthChecks(): HealthCheckRecord[] {
    return [...this.#healthChecks];
  }

  reset(): void {
    this.#registrations.clear();
    this.#healthChecks = [];
    this.getError = null;
  }

  // --- SrsRegistryClient interface ---

  // eslint-disable-next-line @typescript-eslint/require-await
  async getRegistration(id: string): Promise<RegistrationInfo> {
    if (this.getError) {
      throw new RegistrationAccessError(this.getError.message, this.getError.httpStatus);
    }
    const reg = this.#registrations.get(id);
    if (!reg) {
      throw new RegistrationAccessError(`Registration ${id} not found`, 404);
    }
    return { ...reg };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async reportHealth(id: string, statusCode: string): Promise<void> {
    if (!this.#registrations.has(id)) {
      throw new RegistrationAccessError(`Registration ${id} not found`, 404);
    }
    this.#healthChecks.push({ registrationId: id, statusCode });
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Build a default enabled simulator registration for use in tests. */
export function makeRegistration(
  overrides: Partial<RegistrationInfo> = {},
): RegistrationInfo {
  return {
    registrationId:      '00000000-0000-0000-0000-000000000099',
    contractId:          'vle-course-provisioning.v1',
    enabled:             true,
    endpointUrl:         'http://stub-vle.test',
    endpointSafetyClass: 'simulator',
    liveTrafficApproved: false,
    consumerGroup:       'vle.test-tenant.main',
    healthStatusCode:    null,
    ...overrides,
  };
}
