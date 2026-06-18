import type { EndpointSafetyClass, RegistrationInfo } from './client.js';

export class EndpointSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointSafetyError';
  }
}

const SAFETY_RANK: Record<EndpointSafetyClass, number> = {
  simulator:       0,
  'external-test': 1,
  live:            2,
};

/**
 * Enforces the connector's endpoint safety invariants.
 *
 * Rules (all must pass):
 * 1. Registration must be enabled — disabled registrations never accept external writes.
 * 2. The connector's local safety class must be >= the registration's class.
 *    A simulator-class connector cannot write to an external-test or live endpoint.
 * 3. A live registration requires explicit liveTrafficApproved approval.
 */
export function assertEndpointAllowed(
  connectorSafetyClass: EndpointSafetyClass,
  registration: Pick<RegistrationInfo, 'enabled' | 'endpointSafetyClass' | 'liveTrafficApproved'>,
): void {
  if (!registration.enabled) {
    throw new EndpointSafetyError(
      'Registration is disabled — external writes are blocked',
    );
  }

  const connectorRank    = SAFETY_RANK[connectorSafetyClass];
  const registrationRank = SAFETY_RANK[registration.endpointSafetyClass];

  if (registrationRank > connectorRank) {
    throw new EndpointSafetyError(
      `Connector safety class '${connectorSafetyClass}' cannot write to a '${registration.endpointSafetyClass}' endpoint`,
    );
  }

  if (registration.endpointSafetyClass === 'live' && !registration.liveTrafficApproved) {
    throw new EndpointSafetyError(
      'Registration endpointSafetyClass is live but liveTrafficApproved is false',
    );
  }
}
