# Phase 11 NFR Gate Classification

> Date: 2026-06-18
> Stage: 0
> Author: Steve J White

This document classifies every NFR in `docs/requirements/non-functional-requirements.md` as either **gate-blocking** (failure prevents v1.0.0 publication) or **informational** (tracked but not blocking). This classification is agreed at Stage 0 and applies to the Phase 11 release candidate.

---

## Classification key

| Class | Meaning |
|---|---|
| **Gate-blocking** | The v1.0.0 release candidate may not be published unless this NFR is met or a formally accepted exception is on record in `release-checklist.md`. |
| **Informational** | The NFR is tracked and evidence is gathered, but failure does not prevent publication. Typically: operational targets that cannot be measured pre-production, or process/communication policies. |

---

## Performance (NFR-PERF)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-PERF-001 | Interactive API p95 ≤ 500ms under normal operating load | Gate-blocking | 2 | Measured by k6 against S6 |
| NFR-PERF-002 | System operates correctly with up to 50,000 enrolled students per tenant | Gate-blocking | 2 | S6 `institution-year` is the verification dataset |
| NFR-PERF-003 | Batch operations execute asynchronously and do not degrade interactive API | Gate-blocking | 2 | Verified by concurrent k6 + batch operation test |
| NFR-PERF-004 | Horizontal scaling: adding API instances increases throughput | Gate-blocking | 2 | Two-instance throughput test against S6 |
| NFR-PERF-005 | Performance benchmarks defined, documented, and in CI/CD release process | Gate-blocking | 1, 2 | Lighthouse CI (Stage 1) + k6 scheduled run (Stage 2) |
| NFR-PERF-006 | Performance maintained during peak periods (enrolment, results, Clearing) | Gate-blocking | 2 | Peak-load k6 scenarios required |
| NFR-PERF-007 | DB single-record lookup p95 ≤ 50ms | Gate-blocking | 2 | Measured by k6 DB profiling against S6 |

---

## Availability (NFR-AVAIL)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-AVAIL-001 | 99.5% availability during operational hours | **Informational** | — | Not measurable before production deployment. Operational target only; document as institutional SLA expectation. |
| NFR-AVAIL-002 | Planned maintenance with 48h notice | **Informational** | 9 | Communication policy; include in operational runbook. |
| NFR-AVAIL-003 | Graceful degradation when non-critical integrations unavailable | Gate-blocking | 8 | Verified in integration-outage game day |
| NFR-AVAIL-004 | RTO ≤ 4h following unplanned outage | Gate-blocking | 7 | Demonstrated in restore rehearsal against S6 |
| NFR-AVAIL-005 | RPO ≤ 1h (no more than 1h data loss) | Gate-blocking | 7 | Demonstrated by backup strategy (WAL/PITR + daily full) |
| NFR-AVAIL-006 | Daily full + continuous WAL backup; integrity verified by restore testing | Gate-blocking | 7 | Restore rehearsal evidence required |

---

## Security (NFR-SEC)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-SEC-001 | TLS 1.2+ for all data in transit; TLS 1.0/1.1 disabled | Gate-blocking | 7 | Enforced at ingress; documented in deployment runbook |
| NFR-SEC-002 | All data at rest (DB, backups, file storage) encrypted | Gate-blocking | 7 | Documented configuration; operator responsibility for storage-level encryption |
| NFR-SEC-003 | Auth token expiry: access ≤ 1h, refresh ≤ 8h (configurable) | Gate-blocking | 3 | Keycloak realm configuration verification |
| NFR-SEC-004 | All API endpoints reject unauthenticated requests; no public data endpoints | Gate-blocking | 3 | Automated OpenAPI `security` declaration scan |
| NFR-SEC-005 | Max failed auth attempt limit before lockout (configurable per tenant) | Gate-blocking | 3 | Keycloak brute-force detection configuration and verification |
| NFR-SEC-006 | Secrets never in source code, container images, or unencrypted config | Gate-blocking | 3, 7 | Stage 3: code scan; Stage 7: OpenBao integration |
| NFR-SEC-007 | Container images scanned for CVEs at build time; CRITICAL/HIGH block deployment | Gate-blocking | 1 | Trivy in CI (already present; extend to portal/admin images) |
| NFR-SEC-008 | SAST on every PR; HIGH/CRITICAL block merge | Gate-blocking | 1 | CodeQL GitHub Actions |
| NFR-SEC-009 | DAST before each major release | Gate-blocking | 3, 10 | Stage 3: Compose-based DAST; Stage 10: K8s-based final DAST |
| NFR-SEC-010 | Tenant isolation enforced at PostgreSQL RLS; penetration test verifies isolation | Gate-blocking | 3 | Restricted-role RLS validation; cross-tenant query test |
| NFR-SEC-011 | No internal stack traces or DB error details in API responses | Gate-blocking | 3 | Integration test assertion |

---

## Accessibility (NFR-ACC)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-ACC-001 | All user-facing interfaces conform to WCAG 2.1 AA | Gate-blocking | 4 | Manual audit + axe automated scan |
| NFR-ACC-002 | All interactive components operable by keyboard alone | Gate-blocking | 4 | Keyboard-only journey tests |
| NFR-ACC-003 | All interactive components compatible with NVDA, JAWS, VoiceOver | Gate-blocking | 4 | Manual screen reader testing (NVDA + VoiceOver for mandatory journeys) |
| NFR-ACC-004 | Colour not the sole means of conveying information | Gate-blocking | 4 | Manual audit: verify badge text/icon alternatives |
| NFR-ACC-005 | Contrast ratio ≥ 4.5:1 (normal text), ≥ 3:1 (large text) | Gate-blocking | 4 | Axe automated + manual spot-check |
| NFR-ACC-006 | Axe scanning in CI; WCAG 2.1 AA violations block merge | Gate-blocking | 1 | Already in CI (`frontend-smoke` job); verify continues to pass |
| NFR-ACC-007 | Manual accessibility audit before each major release | Gate-blocking | 4 | Full manual audit documented in `accessibility-audit.md` |
| NFR-ACC-008 | Accessibility statement published for each user-facing interface | Gate-blocking | 4 | Statements for portal and admin |

---

## Observability (NFR-OBS)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-OBS-001 | Structured JSON logs with correlation ID on every entry | Gate-blocking | 8 | Verified across API, modules, workers, adapters |
| NFR-OBS-002 | Prometheus metrics: request rate, error rate, latency p50/95/99, queue depth | Gate-blocking | 8 | Grafana dashboard evidence |
| NFR-OBS-003 | OpenTelemetry trace context propagated across all services and integrations | Gate-blocking | 8 | OTel SDK integration; Tempo trace visualisation |
| NFR-OBS-004 | `/health` and `/ready` endpoints on all services; consumed by orchestrator | Gate-blocking | 8 | Readiness checks include DB, NATS, Temporal, Keycloak JWKS |
| NFR-OBS-005 | Alert thresholds defined and versioned in source control | Gate-blocking | 8 | Alert rules in `infra/prometheus/` |
| NFR-OBS-006 | Logs retained ≥ 90 days (configurable) | **Informational** | 8 | Operational configuration; not verifiable pre-production. Document default in deployment guide. |

---

## Operations (NFR-OPS)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-OPS-001 | Full local dev environment starts with `docker compose up`; setup ≤ 15 min from clean machine | Gate-blocking | 9 | Verified via developer setup guide walkthrough |
| NFR-OPS-002 | Containers run as non-root; no privileged execution | Gate-blocking | 7 | `securityContext: runAsNonRoot: true` in all K8s manifests |
| NFR-OPS-003 | All config via environment variables; nothing baked into images | Gate-blocking | 7 | Verified in deployment rehearsal |
| NFR-OPS-004 | Each service has an operational runbook (startup, shutdown, failure scenarios) | Gate-blocking | 8 | Runbooks in `docs/runbooks/` |
| NFR-OPS-005 | Zero-downtime deployment via rolling update | Gate-blocking | 7 | Rolling update strategy documented and rehearsed |
| NFR-OPS-006 | Base container images pinned to specific version; updated on schedule | Gate-blocking | 1 | Pin `FROM` image tags in all Dockerfiles; include in Stage 1 |

---

## Privacy (NFR-PRIV)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-PRIV-001 | All personal data processing has documented lawful basis (UK GDPR) | Gate-blocking | 3 | Verified against data subject register |
| NFR-PRIV-002 | Special category data requires explicit role assignment; more restrictive access | Gate-blocking | 3 | RLS validation; wellbeing role-gate test |
| NFR-PRIV-003 | Automated/managed deletion or anonymisation past retention period | Gate-blocking | 3 | Retention enforcement worker **must be implemented** (not just reviewed) |
| NFR-PRIV-004 | DSAR response producible within 30-day statutory window | Gate-blocking | 3 | DSAR export endpoint verified against S0 story marker |
| NFR-PRIV-005 | Right-to-erasure workflow validates against overriding legal obligations | Gate-blocking | 3 | Erasure workflow tested via S0 |
| NFR-PRIV-006 | Data fields classified by sensitivity tier; documented in data subject register | Gate-blocking | 3 | Data subject register reviewed and current |

---

## Regulatory (NFR-REG)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-REG-001 | HESA Student Record return conforms to coding manual; passes HESA validation rules | Gate-blocking | 3 | S6 return validated against published HESA coding manual version (pinned in `security-review.md`) |
| NFR-REG-002 | Records sufficient for UKVI sponsor licence inspection at any time | Gate-blocking | 3 | Verified via data subject register and S6 dataset |
| NFR-REG-003 | DSAR disclosure producible within 30-day window | Gate-blocking | 3 | Overlaps NFR-PRIV-004 |
| NFR-REG-004 | Records retained for regulatory minimum (study duration + 6 years academic; 7 years financial) | Gate-blocking | 3 | Retention enforcement worker and data class configuration |

---

## Testability (NFR-TEST)

| ID | Requirement summary | Class | Target stage | Notes |
|---|---|---|---|---|
| NFR-TEST-001 | Full test suite (unit, integration, contract, accessibility) passes on every PR | Gate-blocking | 1 | Currently failing due to P11-CI-001/002/003; fix in Stage 1 |
| NFR-TEST-002 | Integration tests use real infrastructure via Testcontainers; no mocked infra | Gate-blocking | Verify | Already the standard; verify no new mocks introduced in Phase 11 stages |
| NFR-TEST-003 | Domain logic coverage ≥ 90% line coverage | Gate-blocking | 1 | Add vitest coverage + CI threshold check in Stage 1 |
| NFR-TEST-004 | Each integration contract has a corresponding contract test | Gate-blocking | Verify | Contract tests exist for Stages 1–3 and Stage 6; verify new Stage 11 APIs are covered |
| NFR-TEST-005 | Performance benchmarks verified by automated load tests on a scheduled basis | Gate-blocking | 2 | k6 scheduled workflow added in Stage 2 |
| NFR-TEST-006 | TypeScript strict mode enabled; type errors are build failures | Gate-blocking | — | Already enforced; `pnpm typecheck` clean |

---

## Summary counts

| Class | Count |
|---|---|
| Gate-blocking | 47 |
| Informational | 3 (NFR-AVAIL-001, NFR-AVAIL-002, NFR-OBS-006) |
| **Total** | **50** |
