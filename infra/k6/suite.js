/**
 * Full k6 performance suite — runs all normal-load scenarios together.
 *
 * Use this for scheduled weekly CI runs against S6 (institution-year, 50k students).
 * For peak-load verification run individual peak scenarios:
 *   k6 run infra/k6/scenarios/peak-start-of-year-enrolment.js
 *   k6 run infra/k6/scenarios/peak-ucas-clearing-spike.js
 * For horizontal-scaling proof run:
 *   k6 run infra/k6/scenarios/horizontal-scaling.js
 *
 * Required environment variables: see infra/k6/lib/auth.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders, studentHeaders } from './lib/auth.js';
import { INTERACTIVE_THRESHOLDS, SINGLE_RECORD_THRESHOLDS, BATCH_THRESHOLDS } from './lib/thresholds.js';

export const options = {
  scenarios: {
    // Student portal reads (20 concurrent students)
    'student-portal': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '2m', target: 20 },
        { duration: '8m', target: 20 },
        { duration: '2m', target: 0  },
      ],
      gracefulRampDown: '30s',
      exec: 'studentPortalFlow',
    },
    // Staff student search (15 concurrent staff)
    'staff-search': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '2m', target: 15 },
        { duration: '8m', target: 15 },
        { duration: '2m', target: 0  },
      ],
      gracefulRampDown: '30s',
      exec: 'staffSearchFlow',
    },
    // Exam board access (10 concurrent board members)
    'exam-board': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '2m', target: 10 },
        { duration: '8m', target: 10 },
        { duration: '2m', target: 0  },
      ],
      gracefulRampDown: '30s',
      exec: 'examBoardFlow',
    },
    // Regulatory / reporting (5 concurrent admin users)
    'regulatory': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '2m', target: 5 },
        { duration: '8m', target: 5 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'regulatoryFlow',
    },
  },
  thresholds: {
    ...INTERACTIVE_THRESHOLDS,
    ...SINGLE_RECORD_THRESHOLDS,
    ...BATCH_THRESHOLDS,
  },
};

const STUDENT_IDS  = (__ENV.STUDENT_IDS || '').split(',').filter(Boolean);
const SEARCH_TERMS = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies'];

function randomStudentId() {
  if (STUDENT_IDS.length === 0) return 'placeholder-student-id';
  return STUDENT_IDS[Math.floor(Math.random() * STUDENT_IDS.length)];
}

let _studentHdrs;
let _staffHdrs;

export function setup() {
  return {
    studentHdrs: studentHeaders(),
    staffHdrs:   staffHeaders(),
  };
}

export function studentPortalFlow(data) {
  if (!_studentHdrs) _studentHdrs = data.studentHdrs;
  const studentId = randomStudentId();
  const tag = { tags: { type: 'interactive' } };

  let r = http.get(`${BASE_URL}/api/v1/students/${studentId}/enrolments`, { headers: _studentHdrs, ...tag });
  check(r, { 'portal enrolments': (res) => res.status === 200 });
  sleep(0.5);

  r = http.get(`${BASE_URL}/api/v1/academic-periods`, { headers: _studentHdrs, ...tag });
  check(r, { 'academic periods': (res) => res.status === 200 });
  sleep(1);
}

export function staffSearchFlow(data) {
  if (!_staffHdrs) _staffHdrs = data.staffHdrs;
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];

  let r = http.get(
    `${BASE_URL}/api/v1/students?search=${encodeURIComponent(term)}&limit=20`,
    { headers: _staffHdrs, tags: { type: 'interactive' } },
  );
  check(r, { 'students list': (res) => res.status === 200 });

  if (r.status === 200) {
    const students = JSON.parse(r.body);
    if (students.length > 0) {
      sleep(0.3);
      const detail = http.get(
        `${BASE_URL}/api/v1/students/${students[0].personId}`,
        { headers: _staffHdrs, tags: { type: 'single-record' } },
      );
      check(detail, { 'student detail': (res) => res.status === 200 });
    }
  }
  sleep(1);
}

export function examBoardFlow(data) {
  if (!_staffHdrs) _staffHdrs = data.staffHdrs;
  const tag = { tags: { type: 'interactive' } };

  const r = http.get(`${BASE_URL}/api/v1/exam-boards`, { headers: _staffHdrs, ...tag });
  check(r, { 'exam boards': (res) => res.status === 200 });
  sleep(1);
}

export function regulatoryFlow(data) {
  if (!_staffHdrs) _staffHdrs = data.staffHdrs;

  const r = http.get(
    `${BASE_URL}/api/v1/reporting/enrolment-volumes`,
    { headers: _staffHdrs, tags: { type: 'interactive' } },
  );
  check(r, { 'enrolment volumes': (res) => res.status === 200 });
  sleep(2);
}

// Default export (required by k6)
export default function (data) { studentPortalFlow(data); }
