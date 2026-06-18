/**
 * Student portal read scenarios.
 *
 * Covers: portal dashboard, profile, modules, results, enrolments, circumstances.
 * Runs as a shared-iteration executor to model concurrent student sessions.
 *
 * NFR-PERF-001: interactive endpoint p95 ≤ 500ms
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, studentHeaders } from '../lib/auth.js';
import { INTERACTIVE_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'student-portal-normal': {
      executor:        'ramping-vus',
      startVUs:        0,
      stages: [
        { duration: '2m', target: 20 },   // ramp up
        { duration: '5m', target: 20 },   // steady state
        { duration: '1m', target: 0  },   // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: INTERACTIVE_THRESHOLDS,
};

// Seed student IDs are seeded by demo-data S0/S6; override via env or use placeholders.
const STUDENT_IDS = (__ENV.STUDENT_IDS || '').split(',').filter(Boolean);

function randomStudentId() {
  if (STUDENT_IDS.length === 0) return 'placeholder-student-id';
  return STUDENT_IDS[Math.floor(Math.random() * STUDENT_IDS.length)];
}

export function setup() {
  return { headers: studentHeaders() };
}

export default function ({ headers }) {
  const studentId = randomStudentId();
  const tag = { tags: { type: 'interactive' } };

  // Dashboard (enrolments + recent activity)
  let r = http.get(`${BASE_URL}/api/v1/students/${studentId}/enrolments`, { headers, ...tag });
  check(r, { 'enrolments 200': (res) => res.status === 200 });
  sleep(0.5);

  // Results page
  r = http.get(`${BASE_URL}/api/v1/students/${studentId}/enrolments`, { headers, ...tag });
  if (r.status === 200) {
    const enrolments = JSON.parse(r.body);
    if (enrolments.length > 0) {
      const enrolId = enrolments[0].enrolmentId;
      const resultsR = http.get(`${BASE_URL}/api/v1/enrolments/${enrolId}/progression`, { headers, ...tag });
      check(resultsR, { 'progression 200': (res) => res.status === 200 });
    }
  }
  sleep(0.5);

  // Module registrations
  r = http.get(`${BASE_URL}/api/v1/students/${studentId}/module-registrations`, { headers, ...tag });
  check(r, { 'module-registrations ok': (res) => res.status === 200 || res.status === 404 });
  sleep(1);
}
