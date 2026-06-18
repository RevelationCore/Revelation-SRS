/**
 * Staff student search and detail scenarios.
 *
 * Covers: student list with search, student detail, enrolments, identity history.
 * NFR-PERF-001: interactive endpoint p95 ≤ 500ms
 * NFR-PERF-007: single-record lookup p95 ≤ 50ms
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders } from '../lib/auth.js';
import { INTERACTIVE_THRESHOLDS, SINGLE_RECORD_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'staff-student-search': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '2m', target: 15 },
        { duration: '5m', target: 15 },
        { duration: '1m', target: 0  },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    ...INTERACTIVE_THRESHOLDS,
    ...SINGLE_RECORD_THRESHOLDS,
  },
};

// Sample search terms drawn from synthetic demo-data name distribution
const SEARCH_TERMS = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Evans', 'Wilson'];

export function setup() {
  return { headers: staffHeaders() };
}

export default function ({ headers }) {
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];

  // Student list / search
  let r = http.get(
    `${BASE_URL}/api/v1/students?search=${encodeURIComponent(term)}&limit=20`,
    { headers, tags: { type: 'interactive' } },
  );
  check(r, { 'students list 200': (res) => res.status === 200 });

  if (r.status === 200) {
    const students = JSON.parse(r.body);
    if (students.length > 0) {
      const student = students[0];
      sleep(0.3);

      // Single student detail (single-record lookup)
      const detail = http.get(
        `${BASE_URL}/api/v1/students/${student.personId}`,
        { headers, tags: { type: 'single-record' } },
      );
      check(detail, { 'student detail 200': (res) => res.status === 200 });
      sleep(0.3);

      // Enrolments for that student
      const enrols = http.get(
        `${BASE_URL}/api/v1/students/${student.personId}/enrolments`,
        { headers, tags: { type: 'interactive' } },
      );
      check(enrols, { 'enrolments 200': (res) => res.status === 200 });
    }
  }
  sleep(1);
}
