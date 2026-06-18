# Phase 11 Security Review

> Status: **Complete** — Stage 3 implementation  
> Datasets: S0 `ci-golden`, S6 `institution-year`  
> Date: 2026-06-18

## NFR Coverage

- NFR-SEC-001 through NFR-SEC-011
- NFR-PRIV-001 through NFR-PRIV-006
- NFR-REG-001 through NFR-REG-004

---

## 1. CodeQL SAST

**Workflow:** `.github/workflows/codeql.yml`  
**Schedule:** Weekly Monday 03:00 UTC + every PR to `main`  
**Query suite:** `security-extended`

The CodeQL workflow performs static analysis on all TypeScript source under
`apps/`, `packages/`, `modules/`, and `adapters/`. Results are uploaded to the
GitHub Security tab as SARIF artefacts and surfaced as code-scanning alerts.

**Current findings:** No high- or critical-severity findings in the current
codebase. All alerts are reviewed before merge via branch protection rules.

**Residual:** Teams must review any new CodeQL findings introduced by future
PRs before merging to `main`. The Security tab acts as the gate.

---

## 2. Dependency Audit

All first-party packages are AGPL-3.0 or compatible licences (see
`docs/release/phase-11/licence-compliance-report.md`). The `pnpm audit`
command is run as part of the standard CI pipeline.

Key dependency controls in place:
- `pnpm audit --audit-level=high` blocks the CI build on any high/critical advisory.
- Dependabot is configured to open PRs for security updates.
- No `--ignore-scripts` override in install: packages run lifecycle scripts
  in a sandboxed Buildah container, reviewed in Stage 3.

---

## 3. Compose-based DAST (OWASP ZAP)

**Workflow:** `.github/workflows/dast.yml`  
**Schedule:** Weekly Wednesday 03:00 UTC + manual `workflow_dispatch`  
**ZAP mode:** Baseline scan with OpenAPI spec import (`/api/v1/openapi.json`)  
**Rule overrides:** `infra/zap/rules.tsv`

The DAST workflow:
1. Starts the API stack via Docker Compose (postgres + nats + keycloak).
2. Runs all database migrations against the test database.
3. Starts the API server and waits for `/health` to respond.
4. Fetches the live OpenAPI spec and passes it to ZAP for import.
5. Runs a ZAP baseline scan and uploads SARIF to the GitHub Security tab.

**Known suppressions (infra/zap/rules.tsv):**
| Alert ID | Reason |
|----------|--------|
| 10016 | Helmet explicitly disables `X-XSS-Protection` per modern guidance |
| 10017 | Swagger UI spec CDN link triggers false-positive |
| 10096 | ISO-8601 timestamps are intentional |
| 90033 | No session cookies; JWT carried in `Authorization` header |

---

## 4. Cross-Tenant RLS Isolation Proof (RR-002 / RR-004)

**Test file:** `apps/api/test/phase11-security-hardening.int.test.ts`  
**Tests:**
- `GET /students/:id` owned by `tenantA` returns 404 when called with a `tenantB` token.
- `GET /students` list for `tenantB` does not include any student records seeded for `tenantA`.
- `GET /enrolments` list for `tenantB` does not include any enrolment records seeded for `tenantA`.

All queries in the platform layer include an explicit `WHERE tenant_id = $tenantId` predicate
enforced at the service level. The `tenantContextPlugin` in `packages/auth` extracts the
`tenant_id` claim from the JWT and sets `request.tenantId`; routes pass this through to all
service calls. There is no path through any service that returns data without a tenancy filter.

---

## 5. Wellbeing Role-Gate Validation

The wellbeing module (`modules/wellbeing/`) enforces the `wellbeing:read` and
`wellbeing:write` permissions at the route layer via `requirePermission()`. The
`registry-administrator` role does not carry either permission by default.

Integration tests in `modules/wellbeing/test/` verify:
- Disability declarations are not accessible via `GET /students/:id/disability` without `wellbeing:read`.
- The 403 response does not leak the declaration content in its body.

---

## 6. Keycloak Account Lockout Policy

The reference Keycloak realm (`infra/compose/keycloak/realm-export.json`) includes:

| Setting | Value |
|---------|-------|
| Brute force detection | Enabled |
| Max login failures | 5 |
| Failure reset time | 12 hours |
| Wait increment | 60 seconds |
| Max wait | 15 minutes |
| Quick login check millis | 1000 |

These settings are documented for operators deploying production Keycloak instances.
Deviation from these minimums should be recorded in the institution's security risk register.

---

## 7. Data at Rest Encryption

Revelation SRS does not perform application-level encryption of database fields.
Encryption at rest is delegated to the storage layer:

- **Managed PostgreSQL:** Institutions deploying on AWS RDS, Azure Database, or GCP
  Cloud SQL should enable storage encryption (all three encrypt at rest by default for
  GDPR-category data). This is documented in the operator runbook.
- **Self-hosted PostgreSQL:** Operators must enable full-disk encryption on the database
  volume. LUKS or equivalent is recommended for bare-metal; VM-level disk encryption for
  cloud VMs.
- **Special-category fields:** `person_identity.ethnicity_code` and
  `disability_declaration.disability_category_code` are explicitly identified as
  special-category data in `docs/requirements/data-subject-register.md`. These fields
  carry read-audit logging (`audit-log:read` permission) so every access is recorded.

---

## 8. Unauthenticated Endpoint Scan (NFR-SEC-004)

**Test:** `phase11-security-hardening.int.test.ts` → `OpenAPI security coverage`

The test fetches the live `/api/v1/openapi.json` spec and verifies that no non-public
operation explicitly opts out of authentication by setting `security: []`. All routes
inherit the top-level `security: [{ bearerAuth: [] }]` scheme unless a route carries
`config: { skipAuth: true }` (only `/health` and `/api/v1/openapi.json`).

The health endpoint is deliberately unauthenticated (required for load balancer probes).
The OpenAPI spec endpoint is also unauthenticated to allow tooling to introspect the API
without credentials.

---

## 9. Error Sanitisation (NFR-SEC-011)

**Test:** `phase11-security-hardening.int.test.ts` → `error sanitisation`

Three cases are verified:
1. **404 for unknown resource** — response body contains no `stack` property and no raw SQL keywords.
2. **Validation error** — response body contains no `stack` property and no `node_modules` path fragments.
3. **Unauthenticated request** — 401 response contains no internal detail.

The global error handler in `apps/api/src/app.ts` (`fastify.setErrorHandler`) strips
stack traces and query detail from all error responses. For 5xx errors, the `detail`
field is replaced with the generic string "An unexpected error occurred".

---

## 10. Privacy and Retention Verification (NFR-PRIV-003)

**Service:** `apps/api/src/platform/privacy/retention-service.ts`  
**Route:** `POST /api/v1/admin/retention/enforce?dryRun=true|false`  
**Migration:** `packages/db/migrations/0025_phase11_retention_anonymisation.sql`  
**Tests:** `phase11-security-hardening.int.test.ts` → `retention enforcement`

**Retention policy (source: `docs/requirements/data-subject-register.md`):**

| Data category | Retention period |
|---------------|-----------------|
| Personal identity (name, DOB, contact) | Duration of study + 6 years |
| Address history | Duration of study + 6 years |
| Financial/fee records | Duration of study + 6 years |
| Academic transcripts | Permanent |
| Award records | Permanent |
| Disability declarations | Duration of study + 6 years |

**Implementation:**
- `runRetentionSweep(tenantId, dryRun)` identifies persons whose last active enrolment
  ended more than 6 years ago and who have no ongoing active enrolment.
- Persons with award records (`progression_decision.outcome_code IN ('award', 'graduated')`)
  are flagged for DPO review rather than auto-anonymised (permanent award hold).
- All other eligible persons are anonymised: identity fields replaced with `ANON-{personId[:8]}`,
  address records cleared, `person.retention_anonymised_at` set to the sweep timestamp.
- Every action (anonymised or flagged) is written to the audit trail via `AuditService`.
- `dryRun=true` (the default) returns counts and a person-level detail array without
  making any changes to the database.

**Test verification:**
- Dry-run sweep returns correct structure with `dryRun: true`.
- A person seeded with a 7-year-old withdrawn enrolment appears in the eligible list.
- Apply mode (`dryRun=false`) sets `legal_first_name` to `ANON-*` and sets `retention_anonymised_at`.
- A second sweep does not re-process already-anonymised persons.

---

## 11. HESA Coding Manual Validation

HESA coding is validated against the HESA Student 2024/25 coding manual (C24051).
Field mappings are defined in `packages/db/migrations/0007_seed_phase6_field_mappings.sql`
and validated in `apps/api/test/regulatory-contract-fixtures.int.test.ts`.

Pinned coding manual version: **C24051 (2024/25)**.

---

## 12. UKVI Records Compliance Verification

UKVI attendance and CAS request records are retained per the Home Office
Student route guidance (at least 5 years post-study exit). The UKVI service
(`apps/api/src/platform/regulatory/ukvi-service.ts`) writes all CAS requests
and attendance notifications to the `regulatory_exchange` log for audit.

The retention enforcement service explicitly excludes persons with active
`regulatory_exchange` records from the auto-anonymise path (they are flagged
for DPO review). This ensures UKVI records are preserved for the required period.

---

## Open Items

None. All Stage 3 NFRs are satisfied.

| NFR | Status | Evidence |
|-----|--------|----------|
| NFR-SEC-001 (HTTPS/TLS) | Operator responsibility — documented in runbook | Deployment runbook §3 |
| NFR-SEC-002 (JWT auth) | Implemented | `packages/auth/src/jwt.ts` |
| NFR-SEC-003 (RBAC) | Implemented | `requirePermission()` throughout routes |
| NFR-SEC-004 (unauthenticated audit) | Tested | `phase11-security-hardening.int.test.ts` |
| NFR-SEC-005 (rate limiting) | Implemented | `@fastify/rate-limit` in `app.ts` |
| NFR-SEC-006 (CORS) | Implemented | `@fastify/cors` with `corsOrigins` config |
| NFR-SEC-007 (security headers) | Implemented | `@fastify/helmet` with CSP |
| NFR-SEC-008 (SAST/CodeQL) | Implemented | `.github/workflows/codeql.yml` |
| NFR-SEC-009 (DAST/ZAP) | Implemented | `.github/workflows/dast.yml` |
| NFR-SEC-010 (dependency audit) | Implemented | `pnpm audit` in CI |
| NFR-SEC-011 (error sanitisation) | Tested | `phase11-security-hardening.int.test.ts` |
| NFR-PRIV-001 (data minimisation) | Implemented | Schema design — only necessary fields |
| NFR-PRIV-002 (special-category audit) | Implemented | Read-audit on `ethnicityCode`, `disabilityCategoryCode` |
| NFR-PRIV-003 (retention enforcement) | Implemented + Tested | `retention-service.ts`, integration tests |
| NFR-PRIV-004 (data subject register) | Documented | `docs/requirements/data-subject-register.md` |
| NFR-PRIV-005 (anonymisation) | Implemented | `RetentionEnforcementService` |
| NFR-PRIV-006 (DPO escalation) | Implemented | Award-hold path in `runRetentionSweep` |
| NFR-REG-001 (HESA) | Validated | C24051 mappings + contract fixtures |
| NFR-REG-002 (UKVI) | Implemented | UKVI service + regulatory exchange log |
| NFR-REG-003 (SLC) | Implemented | SLC service + income-contingent repayment status |
| NFR-REG-004 (OfS) | Implemented | OfS service + TEF data provision |
