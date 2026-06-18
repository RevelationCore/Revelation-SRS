/**
 * Peak-load scenario: UCAS Clearing spike.
 *
 * NFR-PERF-006: sudden 10× burst over 2 minutes targeting admissions and
 * identity endpoints, sustained for 5 minutes.
 * Target: p95 ≤ 500ms, error rate ≤ 0.1%.
 *
 * Assumes S6 institution-year dataset (50,000 students) is loaded.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders } from '../lib/auth.js';
import { PEAK_LOAD_THRESHOLDS } from '../lib/thresholds.js';

// Normal VU baseline = 10; 10× = 100 VUs for Clearing
const NORMAL_VUS  = parseInt(__ENV.NORMAL_VUS  || '10', 10);
const PEAK_FACTOR = parseInt(__ENV.PEAK_FACTOR || '10', 10);
const PEAK_VUS    = NORMAL_VUS * PEAK_FACTOR;

export const options = {
  scenarios: {
    'clearing-spike': {
      executor:    'ramping-vus',
      startVUs:    NORMAL_VUS,
      stages: [
        // Sudden 10× spike over 2 minutes
        { duration: '2m', target: PEAK_VUS },
        // Sustain for 5 minutes
        { duration: '5m', target: PEAK_VUS },
        // Ramp down
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: PEAK_LOAD_THRESHOLDS,
};

const SEARCH_TERMS = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Evans', 'Wilson'];

export function setup() {
  return { headers: staffHeaders() };
}

export default function ({ headers }) {
  const tag = { tags: { type: 'interactive' } };

  // Admissions staff searching for applicants by name (peak during Clearing)
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  let r = http.get(
    `${BASE_URL}/api/v1/students?search=${encodeURIComponent(term)}&limit=20`,
    { headers, ...tag },
  );
  check(r, { 'student search 200': (res) => res.status === 200 });
  sleep(0.3);

  // UCAS exchange status checks
  r = http.get(
    `${BASE_URL}/api/v1/regulatory/ucas/exchange-log`,
    { headers, ...tag },
  );
  check(r, { 'ucas exchange-log ok': (res) => res.status === 200 || res.status === 404 });
  sleep(0.5);

  // Enrolment aggregate (admissions overview dashboard widget)
  r = http.get(
    `${BASE_URL}/api/v1/reporting/enrolment-volumes`,
    { headers, ...tag },
  );
  check(r, { 'enrolment-volumes 200': (res) => res.status === 200 });
  sleep(1);
}
