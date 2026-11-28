import { ServiceTokenProvider, vleConnectorClientId, type ServiceTokenSource } from '@revelation-srs/service-client';

import type { VleSrsClientConfig } from '../config.js';

/** Tokens for the connector's calls to core, from its tenant's srs-vle-svc client (ADR-032). */
export function createSrsTokenSource(cfg: VleSrsClientConfig): ServiceTokenSource {
  if (!cfg.tokenUrl) throw new Error('No token endpoint for calls to core: set KEYCLOAK_JWKS_URL or VLE_SRS_TOKEN_URL');
  return new ServiceTokenProvider({
    tokenUrl: cfg.tokenUrl,
    clientIdFor: vleConnectorClientId,
    auth: cfg.clientAuth === 'private_key_jwt'
      ? { method: 'private_key_jwt', keyFile: cfg.clientKeyFile ?? '', ...(cfg.clientKeyId ? { keyId: cfg.clientKeyId } : {}) }
      : { method: 'client_secret_basic', secret: cfg.clientSecret },
  });
}
