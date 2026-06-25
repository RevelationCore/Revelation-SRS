# S6 — Full-Institution Year

**Slug:** `institution-year` · **Reference date:** 2026-07-31 · **Students:** 50,000

```bash
pnpm demo:reset institution-year
```

> **Note:** This scenario takes approximately 10 minutes to load. It is the largest dataset and is most suitable for performance walkthroughs, regulatory compliance reviews, and high-volume reporting.

---

## What this scenario contains

A full academic year for a medium-sized UK HE institution: four cohort bands (undergraduate, postgraduate taught, postgraduate research, continuing), 16 exam boards across all levels, HESA student and alternative provider returns in draft and submitted states, SLC loan notifications, UCAS clearing pipeline, UKVI CAS sponsorship records, and OfS condition of registration data. All 50,000 student records include enrolments, registrations, marks, and progression decisions.

---

## Stories

### RE-01 — Review the regulatory compliance overview

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/regulatory

> The DPO needs a summary of the institution's current regulatory compliance position across all statutory reporting obligations.

**Steps:**

1. Log in to the admin console as `dpo`.
2. Navigate to **Regulatory** in the sidebar (`/regulatory`). This is a **[PLACEHOLDER]** hub page showing navigation cards for each regulatory area.
3. Review the cards: HESA, UCAS, SLC, UKVI, and OfS. Each card links to a dedicated compliance sub-page.
4. Note that the hub itself does not aggregate data — it routes to the individual compliance areas where data is surfaced.

---

### RE-02 — Review HESA return status and submissions

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/regulatory/hesa

> The DPO needs to review the status of the current HESA student data return and confirm the submission timeline.

**Steps:**

1. From the regulatory hub, select **HESA** or navigate directly to `/regulatory/hesa`.
2. The HESA page shows the current student return status. In S6, a student return should be present in either **draft** or **submitted** state.
3. Review the return summary: collection period, data cut date, number of student records included, and submission status.
4. Note the **last submitted** timestamp if the return has been submitted.
5. Review any validation warnings displayed — these represent records that failed HESA validation rules.

---

### RE-03 — Review OfS regulatory obligations

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/regulatory/ofs

> The DPO needs to check the institution's OfS condition of registration status before the annual accountability return.

**Steps:**

1. From the regulatory hub, select **OfS** or navigate to `/regulatory/ofs`.
2. The OfS page shows the institution's conditions of registration and compliance status.
3. Review the conditions listed. Each condition should show a compliance status indicator.
4. In S6, the conditions should reflect data from the full-institution dataset.

---

### RE-04 — Review SLC loan data and triggers

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/regulatory/slc

> The registry needs to confirm that SLC attendance confirmation notifications have been sent for all eligible students.

**Steps:**

1. Log in as `registry` and navigate to **Regulatory → SLC** (`/regulatory/slc`).
2. The SLC page shows student loan company integration data: attendance confirmations, changes of circumstance, and withdrawal notifications.
3. Review the summary statistics: how many confirmations have been sent, how many are pending, and any failed notifications.
4. In S6 there should be a large volume of confirmations reflecting the 50,000 student cohort.
5. Review any records showing a **pending** status — these are students whose confirmation has not yet been sent and may need manual follow-up.

---

### RE-05 — Review the UCAS application pipeline

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/regulatory/ucas

> The registry needs to review the current UCAS application pipeline to understand offer conversion rates before clearing opens.

**Steps:**

1. Log in as `registry` and navigate to **Regulatory → UCAS** (`/regulatory/ucas`).
2. The UCAS page shows the application pipeline: applications received, offers made, conditions met, and acceptances.
3. Review the pipeline statistics. In S6, figures should reflect the full institution scale.
4. Note the clearing pipeline section — in S6, clearing applicants may be present.

---

### RE-06 — Review UKVI compliance and CAS records

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/regulatory/ukvi

> The DPO needs to check that all sponsored international students have active CAS records and that there are no compliance alerts.

**Steps:**

1. Log in as `dpo` and navigate to **Regulatory → UKVI** (`/regulatory/ukvi`).
2. The UKVI page shows the institution's Confirmation of Acceptance for Studies (CAS) records.
3. Review the summary: total sponsored students, active CAS records, and any alerts (students with expired or near-expiry CAS, attendance issues).
4. In S6, there should be a sizeable number of international students with CAS records.
5. Review any compliance alerts — these represent students where UKVI reporting obligations may be triggered.

---

### RP-01 — Generate and view the enrolment report

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/reporting/enrolments

> The registry needs to run the enrolment headcount report for the board of governors' meeting.

**Steps:**

1. Log in as `registry` and navigate to **Reporting → Enrolments** (`/reporting/enrolments`).
2. The enrolment report page shows a summary of student headcount by programme level, mode of study, and enrolment status.
3. In S6, the report should show figures across all four cohort bands: undergraduate, PGT, PGR, and continuing.
4. Review the breakdowns: full-time vs part-time, home vs overseas, headcount by faculty.
5. Note the report date — it reflects the reference date of the loaded scenario (2026-07-31).

---

### RP-02 — Browse the reporting hub

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/reporting

> The platform operator needs to confirm that all reporting sub-pages are accessible and loading correctly with the full-institution dataset.

**Steps:**

1. Log in as `ops` and navigate to **Reporting** (`/reporting`). This is a **[PLACEHOLDER]** hub page with navigation cards.
2. Select each card in turn: **Enrolments**, **Regulatory Status**, and **FOI / SAR**.
3. Confirm each sub-page loads without error and displays data (empty states are acceptable for FOI/SAR if no requests are seeded).
4. On the **Regulatory Status** page (`/reporting/regulatory-status`), review the compliance summary table showing each regulatory obligation and its current status.
5. Return to the reporting hub and confirm the back navigation works correctly.
