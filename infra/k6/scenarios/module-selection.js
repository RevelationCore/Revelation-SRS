/**
 * Module selection peak scenario.
 *
 * Simulates students browsing modules and adding selections — a bursty pattern
 * that occurs at the start of each academic year.
 * NFR-PERF-001: interactive endpoint p95 ≤ 500ms
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, studentHeaders } from '../lib/auth.js';
import { INTERACTIVE_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'module-selection': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '5m', target: 30 },
        { duration: '1m', target: 0  },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: INTERACTIVE_THRESHOLDS,
};

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

  // Browse module offerings
  let r = http.get(`${BASE_URL}/api/v1/academic-periods`, { headers, ...tag });
  check(r, { 'academic-periods 200': (res) => res.status === 200 });
  sleep(0.5);

  // List student's current module registrations
  r = http.get(
    `${BASE_URL}/api/v1/students/${studentId}/enrolments`,
    { headers, ...tag },
  );
  check(r, { 'enrolments 200': (res) => res.status === 200 });
  sleep(1);
}
