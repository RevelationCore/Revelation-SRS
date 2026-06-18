import { EndpointSafetyError, assertEndpointAllowed } from './endpoint-guard.js';
import type { EndpointSafetyClass, RegistrationInfo, SrsRegistryClient } from './client.js';

/**
 * Loads registration configuration from SRS and tracks whether the connector
 * is currently allowed to make external VLE writes.
 *
 * Call load() on startup and periodically to refresh. canWrite reflects the
 * most recently loaded state without an additional round-trip.
 */
export class RegistrationLoader {
  #current: RegistrationInfo | null = null;

  constructor(
    private readonly client: SrsRegistryClient,
    private readonly connectorSafetyClass: EndpointSafetyClass,
    private readonly registrationId: string,
  ) {}

  async load(): Promise<RegistrationInfo> {
    this.#current = await this.client.getRegistration(this.registrationId);
    return this.#current;
  }

  get current(): RegistrationInfo | null {
    return this.#current;
  }

  /**
   * True only when the last loaded registration is enabled and passes all
   * endpoint safety checks. Returns false before the first load().
   */
  get canWrite(): boolean {
    if (!this.#current) return false;
    try {
      assertEndpointAllowed(this.connectorSafetyClass, this.#current);
      return true;
    } catch (err) {
      if (err instanceof EndpointSafetyError) return false;
      throw err;
    }
  }

  /**
   * The effective VLE endpoint URL: prefers the registration's endpointUrl
   * over the connector's local config value (fallback).
   */
  effectiveEndpointUrl(configFallback: string): string {
    return this.#current?.endpointUrl ?? configFallback;
  }
}
