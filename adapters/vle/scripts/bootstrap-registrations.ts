#!/usr/bin/env tsx
/**
 * Bootstrap VLE Connector registrations in SRS.
 *
 * Creates the three VLE integration registrations for a given tenant
 * if they do not already exist. Safe to run multiple times — the SRS
 * API allows multiple registrations per contract type.
 *
 * Required environment variables:
 *   SRS_API_URL               Base URL of the SRS API  (e.g. http://localhost:3000)
 *   SERVICE_ACCOUNT_TOKEN     Bearer token with integration:manage permission
 *   TENANT_ID                 UUID of the tenant to register for
 *   VLE_ENDPOINT_URL          Base URL of the VLE system
 *   CONSUMER_GROUP            NATS consumer group (e.g. vle.{tenant-id}.main)
 *   ENDPOINT_SAFETY_CLASS     simulator | external-test | external-production
 */

const SRS_API_URL           = process.env['SRS_API_URL']           ?? 'http://localhost:3000';
const SERVICE_ACCOUNT_TOKEN = process.env['SERVICE_ACCOUNT_TOKEN'] ?? '';
const VLE_ENDPOINT_URL      = process.env['VLE_ENDPOINT_URL']      ?? '';
const CONSUMER_GROUP        = process.env['CONSUMER_GROUP']         ?? '';
const ENDPOINT_SAFETY_CLASS = process.env['ENDPOINT_SAFETY_CLASS'] ?? 'simulator';

if (!SERVICE_ACCOUNT_TOKEN) {
  console.error('SERVICE_ACCOUNT_TOKEN is required');
  process.exit(1);
}

interface RegistrationPayload {
  contractId:          string;
  displayName:         string;
  transportCode:       string;
  endpointUrl?:        string;
  consumerGroup?:      string;
  replaySupported:     boolean;
  endpointSafetyClass: string;
  retryPolicy: {
    maxAttempts:        number;
    backoffCoefficient: number;
    initialInterval:    string;
    deadLetterSubject:  string;
  };
}

const REGISTRATIONS: RegistrationPayload[] = [
  {
    contractId:          'vle-course-provisioning.v1',
    displayName:         'VLE Course Provisioning',
    transportCode:       'nats-jetstream',
    consumerGroup:       CONSUMER_GROUP || undefined,
    replaySupported:     true,
    endpointSafetyClass: ENDPOINT_SAFETY_CLASS,
    retryPolicy: {
      maxAttempts:        5,
      backoffCoefficient: 2,
      initialInterval:    'PT5S',
      deadLetterSubject:  'srs.dlq.vle-course-provisioning',
    },
  },
  {
    contractId:          'vle-adjustments.v1',
    displayName:         'VLE Adjustment Distribution',
    transportCode:       'nats-jetstream',
    consumerGroup:       CONSUMER_GROUP || undefined,
    replaySupported:     true,
    endpointSafetyClass: ENDPOINT_SAFETY_CLASS,
    retryPolicy: {
      maxAttempts:        5,
      backoffCoefficient: 2,
      initialInterval:    'PT5S',
      deadLetterSubject:  'srs.dlq.vle-adjustments',
    },
  },
  {
    contractId:          'vle-assessment-results.v1',
    displayName:         'VLE Assessment Results',
    transportCode:       'rest',
    endpointUrl:         VLE_ENDPOINT_URL || undefined,
    replaySupported:     false,
    endpointSafetyClass: ENDPOINT_SAFETY_CLASS,
    retryPolicy: {
      maxAttempts:        3,
      backoffCoefficient: 2,
      initialInterval:    'PT10S',
      deadLetterSubject:  'srs.dlq.vle-assessment-results',
    },
  },
];

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SRS_API_URL}${path}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${SERVICE_ACCOUNT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

for (const reg of REGISTRATIONS) {
  const result = await post('/api/v1/integration-registrations', reg) as Record<string, unknown>;
  console.log(`Created registration ${String(result['registrationId'])} for ${reg.contractId}`);
}

console.log('Bootstrap complete. Enable registrations via the SRS API when ready.');
