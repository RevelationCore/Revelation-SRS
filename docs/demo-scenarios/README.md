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
