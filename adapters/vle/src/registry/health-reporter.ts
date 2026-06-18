import type { SrsRegistryClient } from './client.js';

export type HealthStatusCode = 'healthy' | 'degraded' | 'unhealthy';

export class HealthReporter {
  constructor(
    private readonly client: SrsRegistryClient,
    private readonly registrationId: string,
  ) {}

  async report(statusCode: HealthStatusCode): Promise<void> {
    await this.client.reportHealth(this.registrationId, statusCode);
  }
}
