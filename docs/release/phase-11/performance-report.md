# Phase 11 Performance Report

> Stage: 2 — Performance and Scalability Hardening
> Dataset: S6 `institution-year` (50,000 students)
> Status: **Framework established** — benchmark runs pending S6 environment provisioning

---

## NFR Coverage

| NFR | Requirement | Stage 2 Deliverable | Status |
|-----|-------------|---------------------|--------|
| NFR-PERF-001 | Interactive API p95 ≤ 500ms | `infra/k6/suite.js` — interactive threshold | Pending benchmark run |
| NFR-PERF-003 | Batch ops don't degrade interactive p95 | `regulatory-reports.js` dual-threshold | Pending benchmark run |
| NFR-PERF-004 | 2-instance throughput ≥ 90% of 2× single | `horizontal-scaling.js` | Pending benchmark run |
| NFR-PERF-005 | Frontend runtime performance | Lighthouse CI (Stage 1) — LCP ≤ 2.5s | ✅ CI job added in Stage 1 |
| NFR-PERF-006 | Peak-load p95 ≤ 500ms, error ≤ 0.1% | `peak-start-of-year-enrolment.js`, `peak-ucas-clearing-spike.js` | Pending benchmark run |
| NFR-PERF-007 | Single-record DB lookup p95 ≤ 50ms | `staff-student-search.js` — single-record threshold | Pending benchmark run |

---

## Stage 2 Changes

### Aggregate reporting endpoint (R-API-001, R-PERF-002)

Added `GET /api/v1/reporting/enrolment-volumes` — a server-side aggregate endpoint
replacing the client-side N+1 pattern in `EnrolmentReportPage`. The old implementation
fetched 50 students then fired one enrolments request per student (50 sequential requests
for a sample). The new endpoint executes four parallel GROUP BY queries:

- `COUNT(*) GROUP BY status_code`
- `COUNT(*) GROUP BY mode_of_study_code`
- `COUNT(*) GROUP BY academic_year_of_entry, status_code`
- `COUNT(*) GROUP BY programme_id ORDER BY count DESC LIMIT 20`

Expected latency improvement at S6 scale: ~50 requests at 20ms each (~1,000ms total)
→ 4 parallel aggregate queries at 30–80ms each (~80ms total).

### Database indexes (migration 0024)

Nine indexes added for high-query paths:

| Index | Table | Purpose |
|-------|-------|---------|
| `enrolment_year_of_entry_idx` | `enrolment` | GROUP BY academic year (aggregate endpoint) |
| `enrolment_programme_report_idx` | `enrolment` | GROUP BY programme (aggregate endpoint) |
| `person_identity_family_name_idx` | `person_identity` | LIKE 'Smith%' prefix scans (student search) |
| `module_registration_offering_idx` | `module_registration` | Exam board data-pack assembly |
| `mark_registration_current_idx` | `mark` | Result lookup and mark submission reads |
| `exam_board_candidate_profile_board_idx` | `exam_board_candidate_profile` | Ratification screen paging |
| `audit_record_entity_type_id_idx` | `audit_record` | Entity audit API (Stage 3) |
| `fee_liability_year_idx` | `fee_liability` | SLC / fee reporting queries |
| `ec_enrolment_idx` | `exceptional_circumstances` | EC workload dashboard |

---

## k6 Suite Structure

```
infra/k6/
├── suite.js                              Full combined suite (scheduled weekly CI)
├── lib/
│   ├── auth.js                           Keycloak ROPC token helper
│   └── thresholds.js                     NFR-aligned threshold constants
├── scenarios/
│   ├── student-portal.js                 Student portal read flows (20 VUs)
│   ├── staff-student-search.js           Staff search + detail (15 VUs)
│   ├── module-selection.js               Module selection peak (30 VUs)
│   ├── exam-board.js                     Exam board data-pack access (25 VUs)
│   ├── regulatory-reports.js             Regulatory + aggregate reporting (5 VUs)
│   ├── peak-start-of-year-enrolment.js   NFR-PERF-006: 5× burst (100 VUs, 10-min ramp)
│   ├── peak-ucas-clearing-spike.js       NFR-PERF-006: 10× spike (100 VUs, 2-min burst)
│   └── horizontal-scaling.js            NFR-PERF-004: constant arrival rate comparison
└── README.md
```

---

## Horizontal Scaling Proof (NFR-PERF-004)

**Methodology**: run `horizontal-scaling.js` (constant arrival rate: 50 req/s, 5 min)
against:
1. Single API instance
2. Two API instances behind nginx (`docker compose up --scale api=2`)

**Pass criteria**: two-instance `http_reqs` total ≥ 90% of (2 × single-instance `http_reqs`).

**Known shared-state considerations**:
- JWT validation: stateless (JWKS cached per instance; no cross-instance coordination needed)
- Rate limiter: in-process `@fastify/rate-limit` — per-instance counters; at production
  scale a Redis-backed rate limiter would be required. Documented as a scaling consideration
  in the deployment runbook (Stage 7).
- Feature flag cache: per-instance TTL cache with `// clock:allow` annotation; cache TTL
  is 60s — acceptable staleness for the horizontal scaling model.

---

## Peak-Load Scenarios (NFR-PERF-006)

### Start-of-Year Enrolment Burst

- **Profile**: 5× normal (100 VUs); 80% student enrolment/module-selection, 20% staff
- **Ramp**: linear over 10 minutes, sustained 5 minutes
- **Target**: p95 ≤ 500ms, error rate ≤ 0.1%
- **Key endpoints**: `GET /students/:id/enrolments`, `GET /academic-periods`, `GET /enrolments`

### UCAS Clearing Spike

- **Profile**: 10× normal (100 VUs); sudden 2-minute ramp, sustained 5 minutes
- **Target**: p95 ≤ 500ms, error rate ≤ 0.1%
- **Key endpoints**: `GET /students?search=`, `GET /regulatory/ucas/exchange-log`,
  `GET /reporting/enrolment-volumes`

---

## Benchmark Results

> This section is populated when the k6 suite is run against the provisioned S6 environment.
> Results are published as CI artefacts (`performance-results-*.tar.gz`) and trend charts.

| Scenario | p50 | p95 | p99 | error rate | Status |
|----------|-----|-----|-----|------------|--------|
| Student portal (normal) | TBD | TBD | TBD | TBD | Pending |
| Staff student search (normal) | TBD | TBD | TBD | TBD | Pending |
| Exam board (normal) | TBD | TBD | TBD | TBD | Pending |
| Regulatory reports (normal) | TBD | TBD | TBD | TBD | Pending |
| Start-of-year enrolment burst | TBD | TBD | TBD | TBD | Pending |
| UCAS Clearing spike | TBD | TBD | TBD | TBD | Pending |
| Horizontal scaling (single) | TBD | TBD | TBD | TBD | Pending |
| Horizontal scaling (two-instance) | TBD | TBD | TBD | TBD | Pending |

---

## Residuals Closed by Stage 2

| Residual | Description | Disposition |
|----------|-------------|-------------|
| R-API-001 | Aggregate reporting endpoint | ✅ Closed — `GET /api/v1/reporting/enrolment-volumes` implemented |
| R-PERF-002 | N+1 on EnrolmentReportPage | ✅ Closed — page now uses aggregate endpoint |
| RR-005 | S6 load-time trend artefact | ✅ Framework — CI workflow publishes artefact; populated after first run |
