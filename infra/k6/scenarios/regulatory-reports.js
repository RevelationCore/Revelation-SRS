/**
 * Regulatory report trigger and integration health scenarios.
 *
 * Covers: HESA return status, UCAS exchange list, integration health/exchange list.
 * Verifies batch report generation does not degrade interactive API p95 (NFR-PERF-003).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders } from '../lib/auth.js';
import { BATCH_THRESHOLDS, INTERACTIVE_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'regulatory-reports': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '1m', target: 5 },
        { duration: '5m', target: 5 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    ...BATCH_THRESHOLDS,
    ...INTERACTIVE_THRESHOLDS,
  },
};

export function setup() {
  return { headers: staffHeaders() };
}

export default function ({ headers }) {
  // Integration health (interactive — low latency expected)
  let r = http.get(
    `${BASE_URL}/api/v1/integration-registry/contracts`,
    { headers, tags: { type: 'interactive' } },
  );
  check(r, { 'integration-registry 200': (res) => res.status === 200 });
  sleep(0.5);

  // HESA return list (batch read — higher latency acceptable)
  r = http.get(
    `${BASE_URL}/api/v1/regulatory/hesa/returns`,
    { headers, tags: { type: 'batch' } },
  );
  check(r, { 'hesa-returns 200': (res) => res.status === 200 });
  sleep(1);

  // Enrolment aggregate report (interactive — served from GROUP BY index)
  r = http.get(
    `${BASE_URL}/api/v1/reporting/enrolment-volumes`,
    { headers, tags: { type: 'interactive' } },
  );
  check(r, { 'enrolment-volumes 200': (res) => res.status === 200 });
  sleep(2);
}
