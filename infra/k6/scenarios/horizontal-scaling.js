/**
 * Horizontal scaling verification scenario (NFR-PERF-004).
 *
 * Run this scenario TWICE:
 *   1. Against a single-instance API deployment.
 *   2. Against a two-instance API deployment (nginx load-balanced).
 *
 * Expected result: throughput under identical load increases by ≥90% when
 * a second instance is added (i.e. within 10% of 2× single-instance throughput).
 *
 * Records: http_reqs/s metric and p95 latency. Compare across runs.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders } from '../lib/auth.js';
import { INTERACTIVE_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'horizontal-scaling-baseline': {
      executor:    'constant-arrival-rate',
      rate:        50,        // 50 requests/s — fixed arrival rate to measure throughput
      timeUnit:    '1s',
      duration:    '5m',
      preAllocatedVUs: 60,
      maxVUs:          120,
    },
  },
  thresholds: INTERACTIVE_THRESHOLDS,
};

export function setup() {
  return { headers: staffHeaders() };
}

export default function ({ headers }) {
  const tag = { tags: { type: 'interactive' } };

  // Mix of read endpoints that exercise different DB paths
  const endpoints = [
    '/api/v1/students?limit=10',
    '/api/v1/enrolments?limit=10',
    '/api/v1/reporting/enrolment-volumes',
    '/api/v1/academic-periods',
    '/api/v1/value-sets',
  ];

  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const r = http.get(`${BASE_URL}${path}`, { headers, ...tag });
  check(r, { 'ok': (res) => res.status === 200 });
  sleep(0.1);
}
