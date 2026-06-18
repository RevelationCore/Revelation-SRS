export interface Config {
  port:                      number;
  logLevel:                  string;
  nodeEnv:                   string;
  databaseUrl:               string;
  srsApiUrl:                 string;
  natsUrl:                   string;
  tenantId:                  string;
  integrationRegistrationId: string;
  serviceAccountToken:       string;
  vleEndpointUrl:            string;
  endpointSafetyClass:       'simulator' | 'external-test' | 'live';
  retryMaxAttempts:          number;
  retryBackoffMs:            number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable ${name} is not set`);
  return v;
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : defaultValue;
}

export function loadConfig(): Config {
  const safetyClass = process.env['ENDPOINT_SAFETY_CLASS'] ?? 'simulator';
  if (safetyClass !== 'simulator' && safetyClass !== 'external-test' && safetyClass !== 'live') {
    throw new Error(`Invalid ENDPOINT_SAFETY_CLASS: ${safetyClass}`);
  }
  return {
    port:                    optionalInt('PORT', 3002),
    logLevel:                process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv:                 process.env['NODE_ENV'] ?? 'development',
    databaseUrl:             required('DATABASE_URL'),
    srsApiUrl:               process.env['SRS_API_URL'] ?? 'http://localhost:3000',
    natsUrl:                 process.env['NATS_URL'] ?? 'nats://localhost:4222',
    tenantId:                  required('TENANT_ID'),
    integrationRegistrationId: required('INTEGRATION_REGISTRATION_ID'),
    serviceAccountToken:       required('SERVICE_ACCOUNT_TOKEN'),
    vleEndpointUrl:            process.env['VLE_ENDPOINT_URL'] ?? 'http://localhost:3003',
    endpointSafetyClass:     safetyClass,
    retryMaxAttempts:        optionalInt('RETRY_MAX_ATTEMPTS', 5),
    retryBackoffMs:          optionalInt('RETRY_BACKOFF_MS', 500),
  };
}
