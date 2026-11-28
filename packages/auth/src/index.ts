export * from './types.js';
export { default as jwtPlugin } from './plugins/jwt.js';
export { default as tenantContextPlugin } from './plugins/tenant.js';
export { requirePermission } from './middleware/require-permission.js';
export { requireSelfOrPermission } from './middleware/require-self-or-permission.js';
export { requireAnyPermission } from './middleware/require-any-permission.js';
export { type AuthSettings, assertSecureAuthConfig, DEFAULT_DEV_JWT_SECRET, tokenEnv, issuerFromJwksUrl, jwtPluginOptions } from './settings.js';
export type { JwtPluginOptions } from './plugins/jwt.js';
export { bindServiceRoles, SERVICE_ROLE_CLIENTS, VLE_CONNECTOR_SERVICE_ROLE, WELLBEING_SERVICE_ROLE, type ServiceRoleContext } from './service-identity.js';
// The client side lives in the leaf package (ADR-032); re-exported so existing imports keep working.
export * from '@revelation-srs/service-client';
