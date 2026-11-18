# Demo Scenario Walkthroughs

Each scenario represents a realistic point in the UK HE academic year and comes with a set of stories — step-by-step walkthroughs showing how each user interacts with the system at that moment in time.

---

## How to use these walkthroughs

**1. Start the full application stack**

```bash
# From the repository root
pnpm dev
```

Wait until all services are ready, then open:
- **Admin console** — http://localhost:5173
- **Student portal** — http://localhost:5174

**2. Load the scenario for the walkthrough you want to run**

```bash
pnpm demo:reset <slug>
```

Wait for the "loaded successfully" message. Refresh your browser.

A reset first wipes everything recorded for the demo tenant, including what was done during a previous demo (applications, offers, credit, exceptions, awards, documents, tasks), then loads the scenario. It keeps only reference data, configuration and the audit trail: the catalogue, calendar, rules, value sets, tenant settings and workflow definitions. The kept tables are listed, with a reason for each, in `PRESERVED_TENANT_TABLES` in `packages/demo-data/src/reset.ts`; any table not listed there is wiped.

The amber banner at the top of each app confirms the active scenario.

**3. Log in with the appropriate demo account**

All demo accounts use the password **`Demo-2026!`**.

| Username | App | Role |
|---|---|---|
| `alice.demo` | Portal (http://localhost:5174) | Enrolled student |
| `bob.demo` | Portal | Student with wellbeing case and EC claim |
| `carol.demo` | Portal | Student with adjustments |
| `registry` | Admin (http://localhost:5173) | Registry Administrator |
| `chair` | Admin | Exam Board Chair |
| `wellbeing` | Admin | Wellbeing Advisor |
| `dpo` | Admin | Data Protection Officer |
| `examiner` | Admin | External Examiner (read-only) |
| `ops` | Admin | Platform Operator |
| `sysadmin` | Admin | System and Tenant Administrator |
| `dee.applicant` | Portal | Applicant, direct channel (see [self-service portal personas](#self-service-portal-personas)) |
| `uma.applicant` | Portal | Applicant, UCAS channel |
| `helena.cross` | Portal | PGR supervisor |
| `david.okonkwo` | Portal | External PGR examiner |

**4. Follow the steps in the story**

Each story is self-contained. Steps describe what to do and what to expect. Placeholder pages (navigation hubs or not-yet-wired features) are marked **[PLACEHOLDER]** — note what you see but do not raise a bug.

---

## Scenario index

| Scenario | Slug | Walkthroughs |
|---|---|---|
| S1 — Applicant Pipeline | `applicant-pipeline` | [s1-applicant-pipeline.md](s1-applicant-pipeline.md) |
| S2 — Enrolment and Induction | `enrolment-induction` | [s2-enrolment-induction.md](s2-enrolment-induction.md) |
| S3 — Module Selection Peak | `module-selection` | [s3-module-selection.md](s3-module-selection.md) |
| S4 — Assessment Marks | `assessment-marks` | [s4-assessment-marks.md](s4-assessment-marks.md) |
| S5 — Exam Board and Ratification | `exam-board` | [s5-exam-board.md](s5-exam-board.md) |
| S6 — Full-Institution Year | `institution-year` | [s6-institution-year.md](s6-institution-year.md) |
| Curriculum Baseline | `curriculum-baseline` | — (programmes, modules, offerings and rules only) |
| PGR Lifecycle | `pgr-lifecycle` | [Self-service portal personas](#self-service-portal-personas) |

`pnpm demo:list` lists every scenario.

---

## Self-service portal personas

The portal serves applicants and research staff as well as students (Phase 5, [ADR-025](../decisions/ADR-025-self-service-audiences-and-identity-binding.md)). Each persona is bound to its person record in the default demo tenant, so load the scenario that holds that record first. The Keycloak accounts themselves are created for every persona by any scenario with a personas phase (for example `applicant-pipeline`) or by `pnpm setup:keycloak`; `pgr-lifecycle` does not create them, so run `pnpm setup:keycloak` once if it is the only scenario you load.

| Username | Load | What to try |
|---|---|---|
| `dee.applicant` | `applicant-pipeline` | Applications: open the BSc Computer Science application, accept or decline the conditional offer, upload evidence for the AAB condition, or withdraw. In the admin app, the evidence appears on the application unverified. |
| `uma.applicant` | `applicant-pipeline` | Applications: the same offer, with a notice that UCAS applicants reply and withdraw in UCAS Hub; no reply or withdraw controls. |
| `helena.cross` | `pgr-lifecycle` | Research: her research students, their supervisory team, milestones, progress reviews and examination stage; a supervisor report can be added to an open review. Examiner reports are never shown. |
| `david.okonkwo` | `pgr-lifecycle` | Research: Taylor's examination, where he has not yet reported. Download the thesis, submit a preliminary report with a recommendation, and see the internal examiner's report only once both are in. |
