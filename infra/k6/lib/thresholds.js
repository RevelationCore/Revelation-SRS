/**
 * Shared k6 threshold definitions mapping to NFR-PERF targets.
 *
 * NFR-PERF-001  Interactive API endpoints: p95 ≤ 500ms
 * NFR-PERF-007  Single-record DB lookup:  p95 ≤ 50ms  (measured end-to-end at API layer)
 * NFR-PERF-001  Error rate: ≤ 0.1%
 */

export const INTERACTIVE_THRESHOLDS = {
  // p95 ≤ 500ms for interactive endpoints (NFR-PERF-001)
  'http_req_duration{type:interactive}': ['p(95)<500'],
  // error rate ≤ 0.1%
  http_req_failed: ['rate<0.001'],
};

export const SINGLE_RECORD_THRESHOLDS = {
  // p95 ≤ 50ms for single-record lookups (NFR-PERF-007)
  'http_req_duration{type:single-record}': ['p(95)<50'],
  http_req_failed: ['rate<0.001'],
};

export const BATCH_THRESHOLDS = {
  // Batch operations: no specific latency target — verified they don't degrade interactive p95
  'http_req_duration{type:batch}': ['p(95)<5000'],
  http_req_failed: ['rate<0.005'],
};

export const PEAK_LOAD_THRESHOLDS = {
  // Peak-load scenarios must also meet NFR-PERF-001 + error rate ≤ 0.1% (NFR-PERF-006)
  'http_req_duration{type:interactive}': ['p(95)<500'],
  http_req_failed: ['rate<0.001'],
};
