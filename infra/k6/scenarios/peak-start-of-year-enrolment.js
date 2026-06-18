/**
 * Peak-load scenario: start-of-year enrolment burst.
 *
 * NFR-PERF-006: 5× normal concurrent sessions; 80% targeting enrolment and
 * module-selection endpoints; ramped over 10 minutes.
 * Target: p95 ≤ 500ms, error rate ≤ 0.1%.
 *
 * Assumes S6 institution-year dataset (50,000 students) is loaded.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, studentHeaders, staffHeaders } from '../lib/auth.js';
import { PEAK_LOAD_THRESHOLDS } from '../lib/thresholds.js';

// Normal VU baseline = 20; 5× = 100 VUs
const NORMAL_VUS  = parseInt(__ENV.NORMAL_VUS  || '20', 10);
const PEAK_FACTOR = parseInt(__ENV.PEAK_FACTOR || '5',  10);
const PEAK_VUS    = NORMAL_VUS * PEAK_FACTOR;

export const options = {
  scenarios: {
    // 80% of traffic: students doing enrolment / module-selection reads
    'enrolment-students': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '10m', target: Math.floor(PEAK_VUS * 0.8) },
        { duration: '5m',  target: Math.floor(PEAK_VUS * 0.8) },
        { duration: '2m',  target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'studentEnrolmentFlow',
    },
    // 20% of traffic: staff admissions / enrolment management
    'enrolment-staff': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '10m', target: Math.floor(PEAK_VUS * 0.2) },
        { duration: '5m',  target: Math.floor(PEAK_VUS * 0.2) },
        { duration: '2m',  target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'staffEnrolmentFlow',
    },
  },
  thresholds: PEAK_LOAD_THRESHOLDS,
};

const STUDENT_IDS = (__ENV.STUDENT_IDS || '').split(',').filter(Boolean);
function randomStudentId() {
  if (STUDENT_IDS.length === 0) return 'placeholder-student-id';
  return STUDENT_IDS[Math.floor(Math.random() * STUDENT_IDS.length)];
}

let studentHdrs;
let staffHdrs;

export function setup() {
  return {
    studentHdrs: studentHeaders(),
    staffHdrs:   staffHeaders(),
  };
}

export function studentEnrolmentFlow(data) {
  if (!studentHdrs) studentHdrs = data.studentHdrs;
  const studentId = randomStudentId();
  const tag = { tags: { type: 'interactive' } };

  // Enrolments read (most common action during enrolment period)
  let r = http.get(`${BASE_URL}/api/v1/students/${studentId}/enrolments`, { headers: studentHdrs, ...tag });
  check(r, { 'enrolments 200': (res) => res.status === 200 });
  sleep(0.5);

  // Academic periods (needed for module selection)
  r = http.get(`${BASE_URL}/api/v1/academic-periods`, { headers: studentHdrs, ...tag });
  check(r, { 'academic-periods 200': (res) => res.status === 200 });
  sleep(1);
}

export function staffEnrolmentFlow(data) {
  if (!staffHdrs) staffHdrs = data.staffHdrs;
  const tag = { tags: { type: 'interactive' } };

  // Staff viewing enrolments list
  const r = http.get(`${BASE_URL}/api/v1/enrolments?limit=20`, { headers: staffHdrs, ...tag });
  check(r, { 'enrolments list 200': (res) => res.status === 200 });
  sleep(1);
}

// Default export required even when using named exec
export default function (data) { studentEnrolmentFlow(data); }
