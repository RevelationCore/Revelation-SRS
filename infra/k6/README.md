# k6 Performance Suite

Load test suite for Revelation SRS using [k6](https://k6.io). Targets the S6 `institution-year` dataset (50,000 students) as the NFR-PERF design point.

## Prerequisites

- k6 installed: `brew install k6` / `choco install k6` / [k6.io/docs](https://k6.io/docs/get-started/installation/)
- S6 demo dataset loaded in the target environment
- Environment variables configured (see below)

## Environment Variables

| Variable       | Default                   | Description |
|----------------|---------------------------|-------------|
| `BASE_URL`     | `http://localhost:3000`   | API base URL |
| `KEYCLOAK_URL` | `http://localhost:8080`   | Keycloak base URL |
| `REALM`        | `revelation-srs`          | Keycloak realm |
| `CLIENT_ID`    | `srs-api`                 | OIDC client ID |
| `STAFF_USER`   | `admin@demo.test`         | Staff test account username |
| `STAFF_PASS`   | `demo-password`           | Staff test account password |
| `STUDENT_USER` | `student@demo.test`       | Student test account username |
| `STUDENT_PASS` | `demo-password`           | Student test account password |
| `TENANT_ID`    | *(empty)*                 | Tenant ID if required by header |
| `STUDENT_IDS`  | *(empty)*                 | Comma-separated student personIds for targeted scenarios |
| `BOARD_IDS`    | *(empty)*                 | Comma-separated exam board IDs for board scenarios |

## Running the full suite

```bash
k6 run \
  -e BASE_URL=http://localhost:3000 \
  -e KEYCLOAK_URL=http://localhost:8080 \
  -e STAFF_USER=admin@demo.test \
  -e STAFF_PASS=demo-password \
  infra/k6/suite.js
```

## Running individual scenarios

```bash
# Normal load scenarios
k6 run infra/k6/scenarios/student-portal.js
k6 run infra/k6/scenarios/staff-student-search.js
k6 run infra/k6/scenarios/module-selection.js
k6 run infra/k6/scenarios/exam-board.js
k6 run infra/k6/scenarios/regulatory-reports.js

# Peak-load scenarios (NFR-PERF-006)
k6 run infra/k6/scenarios/peak-start-of-year-enrolment.js
k6 run infra/k6/scenarios/peak-ucas-clearing-spike.js

# Horizontal scaling verification (NFR-PERF-004)
# Run once against single instance, once against two-instance deployment
k6 run infra/k6/scenarios/horizontal-scaling.js
```

## NFR coverage

| NFR | Scenario | Threshold |
|-----|----------|-----------|
| NFR-PERF-001 | All interactive scenarios | p95 ≤ 500ms |
| NFR-PERF-003 | `regulatory-reports.js` | Batch ops don't breach interactive p95 |
| NFR-PERF-004 | `horizontal-scaling.js` | 2-instance throughput ≥ 90% of 2× single |
| NFR-PERF-006 | `peak-start-of-year-enrolment.js`, `peak-ucas-clearing-spike.js` | p95 ≤ 500ms, error ≤ 0.1% |
| NFR-PERF-007 | `staff-student-search.js` | single-record p95 ≤ 50ms |
