# Post-Release Backlog — v1.0.0

> Date: 2026-06-18
> Source: Phase 11 acceptance review, accepted exceptions, informational NFRs, and deferred enhancements

This document lists items that were explicitly deferred beyond v1.0.0 or that are operational targets not measurable pre-production. Each item should be tracked as a GitHub Issue after repository publication.

---

## Accepted exceptions (carry-forward)

### POST-001 — Admin mobile navigation (R-A11Y-001)

**Origin**: Accepted exception at Stage 4
**Severity**: Low
**Type**: Accessibility enhancement

The admin UI navigation bar has no responsive breakpoints. Formally accepted for v1.0.0 as admin is desktop-first and no mobile use case was identified in the Stage 4 audit. The accessibility statement documents this limitation.

**Trigger for revisit**: If an institutional user reports a legitimate mobile admin use case, implement a responsive overflow/hamburger menu.

**Labels**: accessibility, enhancement, admin-ui

---

## Informational NFRs (operational targets — post-deployment)

### POST-002 — 99.5% availability SLA measurement (NFR-AVAIL-001)

**Origin**: Informational NFR
**Type**: Operational monitoring

NFR-AVAIL-001 targets 99.5% availability during operational hours. This cannot be measured before production deployment. Create a Grafana SLA dashboard and set up alerting for availability drops below threshold once the system is deployed in a production environment.

**Labels**: operations, monitoring, post-deployment

---

### POST-003 — Maintenance window communication process (NFR-AVAIL-002)

**Origin**: Informational NFR
**Type**: Process/governance

NFR-AVAIL-002 requires 48-hour notice for planned maintenance. Establish and document the maintenance window communication process (institutional email list, status page) once the system is in production.

**Labels**: operations, governance, post-deployment

---

### POST-004 — Log retention configuration (NFR-OBS-006)

**Origin**: Informational NFR
**Type**: Operational configuration

NFR-OBS-006 requires log retention ≥ 90 days. Default Loki retention is configured at 90 days. Institutional operators must verify and adjust their Loki retention policy to meet their specific compliance obligations (e.g., some UKVI and financial audit requirements may exceed 90 days).

**Labels**: operations, observability, post-deployment

---

## Deferred enhancements

### POST-005 — RTL locale support

**Origin**: R-I18N-001 scope constraint
**Type**: Internationalisation enhancement

Welsh (cy) locale is delivered in v1.0.0 (left-to-right). Right-to-left rendering support (for Arabic, Hebrew, or other RTL locales) is explicitly out of scope for v1.0.0. RTL support requires: CSS logical properties throughout the UI, RTL-aware component testing, and an RTL test locale.

**Labels**: i18n, enhancement, frontend

---

### POST-006 — JAWS screen reader testing (NFR-ACC-003 partial)

**Origin**: Stage 4 screen reader scope
**Type**: Accessibility testing

NFR-ACC-003 mentions NVDA, JAWS, and VoiceOver. v1.0.0 was tested with NVDA (Windows primary) and VoiceOver (macOS secondary). JAWS testing was deferred as it requires a licensed installation. Commission JAWS testing for the first institutional deployment.

**Labels**: accessibility, testing, post-deployment

---

### POST-007 — Container image base image update schedule

**Origin**: NFR-OPS-006 operational continuation
**Type**: Security/maintenance

All Dockerfiles pin specific image tags for v1.0.0. Establish a quarterly schedule to review and update base images (node:22-alpine, nginx:1.27-alpine) to incorporate upstream security patches. Add automated Dependabot or Renovate configuration for Docker image tags.

**Labels**: security, maintenance, devops

---

### POST-008 — HESA coding manual re-validation for 2026–27

**Origin**: NFR-REG-001 annual cycle
**Type**: Regulatory compliance

The v1.0.0 HESA return was validated against the 2025–26 HESA coding manual. HESA publishes updated coding manuals annually. Run the S6 return validation against the 2026–27 coding manual before the first live HESA return is submitted.

**Labels**: regulatory, hesa, post-deployment

---

### POST-009 — Keycloak account lockout threshold review

**Origin**: NFR-SEC-005 operational tuning
**Type**: Security configuration

The default lockout configuration (5 failed attempts, 60-second lockout) was verified in Stage 3. Institutions should review and tune these values to match their security policies and user support capacity before production deployment.

**Labels**: security, keycloak, post-deployment

---

### POST-010 — Production performance benchmark update

**Origin**: NFR-PERF-001 through -007 ongoing
**Type**: Performance monitoring

v1.0.0 performance benchmarks were measured against a local S6 environment. Update the performance-report.md with results from the first production deployment against real institutional data volumes. Establish a regular performance review cadence (quarterly recommended).

**Labels**: performance, post-deployment

---

## GitHub issue creation

After repository publication, create GitHub Issues for each item above using the `feature_request.yml` template where appropriate. Link back to this document as context.

Command to reference in each issue:
> See `docs/release/phase-11/post-release-backlog.md` — POST-00N for background and acceptance rationale.
