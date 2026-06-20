# UAT Approach — Revelation SRS

This document defines how User Acceptance Testing is conducted for the Revelation SRS application.
Testing is story-based, scenario-driven, and fully traceable through GitHub Issues.

---

## 1. Prerequisites

Before starting any story, ensure the following are running:

| Service | Command | Default URL |
|---|---|---|
| API server | `pnpm dev` from repo root | http://localhost:3000 |
| Admin console | (started by `pnpm dev`) | http://localhost:5173 |
| Student portal | (started by `pnpm dev`) | http://localhost:5174 |
| PostgreSQL | must be running | localhost:5432 |
| Keycloak | must be running | http://localhost:8080 |

Start everything from the repository root:

```bash
pnpm dev
```

---

## 2. Demo environment

### 2.1 Demo scenarios

Each story requires a specific scenario to be loaded into the database. The table below describes
what each scenario contains and which stories depend on it.

| Label | Slug | Reference date | Students | What it represents |
|---|---|---|---|---|
| S0 | `curriculum-baseline` | — | 0 | Reference data only: programmes, modules, academic calendar, rules, feature flags |
| S1 | `applicant-pipeline` | — | 600 applicants | UCAS, direct, international, and clearing applicants moving through admissions |
| S2 | `enrolment-induction` | 2026-07-31 | 1,000 | Students enrolled, intermitting, withdrawn, or graduated; fee liabilities; no marks yet |
| S3 | `module-selection` | 2026-07-31 | 1,000 | Module registrations (registered/waitlisted/withdrawn/draft), exam boards formed, exam entries |
| S4 | `assessment-marks` | 2026-07-31 | 1,000 | Submitted marks, module results, wellbeing referrals, disability declarations, EC claims, VLE integration |
| S5 | `exam-board` | 2026-07-31 | 1,000 | Post-ratification snapshot — boards ratified, progression and award decisions locked |
| S6 | `institution-year` | 2026-07-31 | 50,000 | Full institution year — four cohort bands, 16 boards, HESA returns submitted and draft |

### 2.2 Resetting a scenario

Run the following command before starting any story that specifies a required scenario.
Wait for the **"loaded successfully"** message before continuing.

```bash
pnpm --filter @revelation-srs/demo-data demo:reset <slug>
```

**Examples:**

```bash
# Load S2 — enrolled students, no marks
pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction

# Load S4 — marks, wellbeing, EC claims
pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks

# Load S5 — post-ratification
pnpm --filter @revelation-srs/demo-data demo:reset exam-board

# Load S6 — full institution (takes 30–60 seconds)
pnpm --filter @revelation-srs/demo-data demo:reset institution-year
```

After a reset, **refresh the browser** (or log in again if your session has expired).
The amber demo banner at the top of each app will confirm the active scenario.

### 2.3 Demo accounts

All demo accounts share the password **`Demo-2026!`**.

#### Student portal (http://localhost:5174)

| Username | Who they are | Key story arcs |
|---|---|---|
| `alice.demo` | Standard enrolled student | Enrolment, modules, marks, disability declaration |
| `bob.demo` | Student with wellbeing case and EC claim | Extenuating circumstances, wellbeing referral |
| `carol.demo` | Student with module override and learning adjustments | Adjustments, module override |

#### Admin console (http://localhost:5173)

| Username | Role | Key story arcs |
|---|---|---|
| `registry` | Registry Administrator | Student records, corrections, SLC, UCAS |
| `chair` | Exam Board Chair | Exam board review, candidate profiles, ratification |
| `wellbeing` | Wellbeing Advisor | Wellbeing referrals, disability cases, EC processing |
| `dpo` | Data Protection Officer | Audit log, FOI/SAR, UKVI, OfS, HESA |
| `examiner` | External Examiner | Assessment marks (read-only) |
| `ops` | Platform Operator | Value sets, feature flags, integrations, configuration |

---

## 3. Story-based testing methodology

### Why stories?

Rather than listing features to click, UAT is structured as **stories** — a person with a goal
working through the application as they would in real life. This surfaces usability issues
alongside functional ones, and makes it clear whether the application actually serves its users.

### Story structure

Each UAT story (GitHub Issue) contains:

1. **Context** — one or two sentences describing who the person is and why they are here
2. **Environment setup** — which scenario to load, the exact reset command, which URL and account to use
3. **Steps** — numbered instructions in plain language, each with a checkbox
4. **Issues found** — where to link bug reports raised during this story

### Placeholder pages

Some pages in the admin console are navigation hubs (cards linking to sub-pages) or have
stubbed functionality not yet wired to the API. These are marked
**`[PLACEHOLDER]`** within the relevant story steps. A placeholder step is informational —
note what you see, but do not raise a bug if the page contains only navigation cards or
a "coming soon" notice.

The following are known placeholders or partial implementations as of v1.0.0-rc.1:

| Page | Path | Status |
|---|---|---|
| Admin dashboard — quick search | `/dashboard` | Stats show `—`; search form is not wired |
| Regulatory hub | `/regulatory` | Navigation cards only; sub-pages are functional |
| Reporting hub | `/reporting` | Navigation cards only; sub-pages are functional |
| Operations hub | `/operations` | Navigation cards only; sub-pages are functional |
| Tenant Admin hub | `/tenant-admin` | Navigation cards only; sub-pages are functional |

---

## 4. Recording issues

When a step fails or produces unexpected behaviour, open a new GitHub Issue using the
**UAT Bug Report** template. The template asks for:

- Which story and step number failed
- Steps to reproduce
- Expected behaviour
- Actual behaviour
- Severity (Critical / High / Medium / Low)
- A screenshot or screen recording

Use the following severity guide:

| Severity | When to use |
|---|---|
| **Critical** | Application crash, data loss, security issue, or complete functional failure with no workaround |
| **High** | Core function is broken; no reasonable workaround exists |
| **Medium** | Function works but requires a workaround; usability significantly impaired |
| **Low** | Cosmetic issue, wording error, or minor inconsistency |

After filing the bug, paste the issue link as a comment on the story issue and leave the
story step unchecked.

---

## 5. Fix planning

Once all story issues are closed (all steps checked or bugs filed), a **UAT Fix Plan** issue
will be created. This issue groups all open `uat/bug` issues by severity and affected area,
proposes a fix approach for each cluster, and defines the acceptance criteria for a UAT
re-test round.

---

## 6. Story index

### Portal — student-facing

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| P-01 | First login and dashboard navigation | S2 | alice.demo |
| P-02 | View and edit profile details | S2 | alice.demo |
| P-03 | Add a term-time address | S2 | alice.demo |
| P-04 | View current enrolment status | S2 | alice.demo |
| P-05 | Browse module registrations | S3 | alice.demo |
| P-06 | Withdraw from a module | S3 | alice.demo |
| P-07 | Add an optional module | S3 | alice.demo |
| P-08 | View the exam timetable | S3 | alice.demo |
| P-09 | View marks and results | S5 | alice.demo |
| P-10 | Declare a disability | S4 | alice.demo |
| P-11 | Submit an extenuating circumstances claim | S4 | bob.demo |
| P-12 | View learning adjustments | S4 | carol.demo |
| P-13 | View notifications | S4 | alice.demo |

### Admin — student records

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| AR-01 | Search for a student and open their record | S4 | registry |
| AR-02 | Review student overview, enrolments, and contacts | S4 | registry |
| AR-03 | Review module registrations from the student record | S3 | registry |
| AR-04 | Review a student's assessment marks | S4 | examiner |
| AR-05 | Review communications sent to a student | S4 | registry |

### Admin — corrections and appeals

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| CO-01 | Raise a new correction case against a board decision | S5 | registry |
| CO-02 | Progress and resolve a correction case | S5 | registry |

### Admin — wellbeing and disability

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| WB-01 | View and manage a student wellbeing referral | S4 | wellbeing |
| WB-02 | Review a disability support case | S4 | wellbeing |
| WB-03 | Process an extenuating circumstances submission | S4 | wellbeing |

### Admin — exam boards

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| EB-01 | Browse the exam boards list | S5 | chair |
| EB-02 | Review an exam board — agenda and data pack | S5 | chair |
| EB-03 | Review candidate profiles and progression decisions | S5 | chair |
| EB-04 | Review ratified award decisions | S5 | chair |

### Admin — task inbox

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| TI-01 | Work through the task inbox | S4 | registry |

### Admin — regulatory compliance

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| RE-01 | Review the regulatory compliance overview | S6 | dpo |
| RE-02 | Review HESA return status and submissions | S6 | dpo |
| RE-03 | Review OfS regulatory obligations | S6 | dpo |
| RE-04 | Review SLC loan data and triggers | S6 | registry |
| RE-05 | Review UCAS application pipeline data | S6 | registry |
| RE-06 | Review UKVI compliance and CAS records | S6 | dpo |
| RE-07 | Process an FOI / Subject Access Request | S4 | dpo |

### Admin — reporting

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| RP-01 | Generate and view the enrolment report | S6 | registry |
| RP-02 | Browse the reporting hub | S6 | ops |

### Admin — operations and configuration

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| OP-01 | Manage value sets — view, edit, retire, and add members | S2 | ops |
| OP-02 | Manage feature flags | S2 | ops |
| OP-03 | Browse the integration registry | S2 | ops |
| OP-04 | Review integration operations and connector status | S2 | ops |
| OP-05 | Review academic rules configuration | S2 | ops |
| OP-06 | Review workflow definitions | S2 | ops |
| OP-07 | Globalisation and locale settings | S2 | ops |
| OP-08 | View environment runtime information | S2 | ops |
| OP-09 | Tenant administration and configuration | S2 | ops |

### Admin — audit

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| AU-01 | Browse the system audit log | S4 | dpo |

### Cross-cutting

| Issue | Story | Scenario | Persona |
|---|---|---|---|
| X-01 | Demo environment: reset a scenario and verify the banner | — | any |
| X-02 | Admin sidebar navigation — all sections reachable | S2 | registry |
| X-03 | Accessibility statements and error pages | — | any |

---

*Total: 50 stories — 13 portal, 5 student records, 2 corrections, 3 wellbeing, 4 exam boards,
1 task inbox, 7 regulatory, 2 reporting, 9 operations, 1 audit, 3 cross-cutting.*
