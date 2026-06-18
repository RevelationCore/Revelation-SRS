import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@revelation-srs/domain';

import { assertIntegrationEndpointAllowed } from '../src/platform/regulatory/exchange-service.js';

describe('integration endpoint safety guard', () => {
  it('allows simulator and external test endpoints in non-production', () => {
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'preprod',
      directionCode: 'outbound',
      ownerModuleCode: 'regulatory',
      endpointSafetyClass: 'simulator',
      liveTrafficApproved: false,
    })).not.toThrow();
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'preprod',
      directionCode: 'outbound',
      ownerModuleCode: 'admissions',
      endpointSafetyClass: 'external-test',
      liveTrafficApproved: false,
    })).not.toThrow();
  });

  it('blocks external production endpoints in non-production without explicit approval', () => {
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'preprod',
      directionCode: 'outbound',
      ownerModuleCode: 'regulatory',
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: false,
    })).toThrow(ForbiddenError);
  });

  it('allows approved production endpoint rehearsals and production runtime traffic', () => {
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'preprod',
      directionCode: 'outbound',
      ownerModuleCode: 'finance',
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: true,
    })).not.toThrow();
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'prod',
      directionCode: 'outbound',
      ownerModuleCode: 'regulatory',
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: false,
    })).not.toThrow();
  });

  it('does not block inbound exchange ledger records', () => {
    expect(() => assertIntegrationEndpointAllowed({
      environmentCode: 'test',
      directionCode: 'inbound',
      ownerModuleCode: 'regulatory',
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: false,
    })).not.toThrow();
  });
});
