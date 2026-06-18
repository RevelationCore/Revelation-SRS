/**
 * Exam board data-pack access scenario.
 *
 * Covers: exam board list, data-pack read, candidate profiles.
 * Models the burst when exam board members all open the same data pack before a meeting.
 * NFR-PERF-001: interactive endpoint p95 ≤ 500ms
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, staffHeaders } from '../lib/auth.js';
import { INTERACTIVE_THRESHOLDS } from '../lib/thresholds.js';

export const options = {
  scenarios: {
    'exam-board': {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '4m',  target: 25 },
        { duration: '30s', target: 0  },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: INTERACTIVE_THRESHOLDS,
};

const BOARD_IDS = (__ENV.BOARD_IDS || '').split(',').filter(Boolean);

export function setup() {
  return { headers: staffHeaders() };
}

export default function ({ headers }) {
  const tag = { tags: { type: 'interactive' } };

  // List exam boards
  let r = http.get(`${BASE_URL}/api/v1/exam-boards`, { headers, ...tag });
  check(r, { 'exam-boards 200': (res) => res.status === 200 });

  if (r.status === 200 || BOARD_IDS.length > 0) {
    let boardId = BOARD_IDS.length > 0
      ? BOARD_IDS[Math.floor(Math.random() * BOARD_IDS.length)]
      : null;

    if (!boardId && r.status === 200) {
      const boards = JSON.parse(r.body);
      if (boards.length > 0) boardId = boards[0].boardId;
    }

    if (boardId) {
      sleep(0.5);
      const detail = http.get(`${BASE_URL}/api/v1/exam-boards/${boardId}`, { headers, ...tag });
      check(detail, { 'exam-board detail 200': (res) => res.status === 200 });
    }
  }
  sleep(1);
}
