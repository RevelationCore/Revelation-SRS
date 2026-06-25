# S4 — Assessment Marks

**Slug:** `assessment-marks` · **Reference date:** 2026-07-31 · **Students:** 1,000

```bash
pnpm demo:reset assessment-marks
```

---

## What this scenario contains

Assessment marks have been submitted and module results are available. The wellbeing module is active with referrals, disability declarations, and extenuating circumstances claims in various states. The VLE integration has recorded learning activity data. This is the richest scenario for day-to-day registry, wellbeing, and audit workflows.

---

## Stories

### P-10 — Declare a disability

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/disability

> Alice has a disability and needs to submit a formal declaration so the university can arrange appropriate support.

**Steps:**

1. Log in to the student portal as `alice.demo`.
2. Navigate to **Disability** in the top navigation bar, or go to `/disability`.
3. Review any existing declarations shown. In S4, Alice may already have a declaration from the demo data.
4. If no declaration is present, select **Add declaration**. Complete the form: disability type (choose from the value-set dropdown), date of diagnosis, and any supporting notes.
5. Submit the declaration. Confirm a success message is shown.
6. The declaration should now appear in the list with a status of **submitted** or **under review**.

---

### P-11 — Submit an extenuating circumstances claim

**Persona:** `bob.demo` · **Role:** Student with EC claim · **App:** Student portal · **URL:** http://localhost:5174/circumstances

> Bob has experienced unexpected difficulties that affected his ability to sit his exam and needs to submit an extenuating circumstances claim before the board deadline.

**Steps:**

1. Log in to the student portal at http://localhost:5174 as `bob.demo` (password `Demo-2026!`).
2. Navigate to **Circumstances** in the top navigation bar, or go to `/circumstances`.
3. Review any existing claims shown. In S4, Bob may have a pre-existing claim from the demo data.
4. Select **Submit a claim**. The claim form opens.
5. Select the affected module from the dropdown — this should show Bob's registered modules.
6. Choose a circumstance type from the dropdown (for example, **Medical** or **Bereavement**).
7. Enter an explanation in the free-text field.
8. Optionally attach supporting evidence — in the demo environment the attachment field accepts a note.
9. Submit the claim. Confirm a success message is shown and the claim appears in the list with status **submitted**.

---

### P-12 — View learning adjustments

**Persona:** `carol.demo` · **Role:** Student with adjustments · **App:** Student portal · **URL:** http://localhost:5174/adjustments

> Carol has a disability support plan that includes extra time in examinations. She needs to confirm her adjustments are recorded correctly before her exams.

**Steps:**

1. Log in to the student portal as `carol.demo` (password `Demo-2026!`).
2. Navigate to **Adjustments** in the top navigation bar, or go to `/adjustments`.
3. You should see Carol's learning adjustments. Each row shows the adjustment type, description, and effective dates.
4. Confirm that at least one adjustment (for example, **25% extra time** or **separate room**) is present and currently active.
5. Note the effective-from and effective-to dates — adjustments are bitemporal records that apply for a defined period.

---

### P-13 — View notifications

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/notifications

> Alice wants to check whether she has any unread notifications from the university.

**Steps:**

1. Log in as `alice.demo` and navigate to **Notifications**, or go to `/notifications`.
2. You should see a list of notifications. In S4, there may be notifications about marks being released, wellbeing referrals, or upcoming deadlines.
3. Review each notification: subject, date, and read/unread status.
4. Select an unread notification to open it. The notification should mark itself as read.

---

### AR-01 — Search for a student and open their record

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/students

> A student has contacted the registry about their marks. The administrator needs to find the student's record quickly.

**Steps:**

1. Log in to the admin console as `registry`.
2. Navigate to **Students** (`/students`).
3. In the search box, type part of a name — try `alice`. The list filters to show matching students.
4. Locate **Alice** in the results and select **View →** to open her student detail page.
5. Confirm the student detail page opens and shows Alice's student number, legal name, and preferred name.

---

### AR-02 — Review student overview, enrolments, and contacts

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/students

> Having found Alice's record, the administrator reviews her current enrolment and checks her contact details.

**Steps:**

1. From Alice's student detail page, you start on the **Identity** tab. Review her personal details: legal name, date of birth, student number, email, and phone.
2. Select the **Enrolments** tab. Review Alice's enrolments — the current enrolment should show programme, academic year, year of study, and status.
3. Within the enrolments tab, note the **module registrations** and **timetable** sections showing her current load and scheduled exams.
4. Return to the **Identity** tab and review the Addresses section. Confirm Alice's term-time and/or home address is populated.

---

### AR-04 — Review a student's assessment marks

**Persona:** `examiner` · **Role:** External Examiner (read-only) · **App:** Admin console · **URL:** http://localhost:5173/students

> An external examiner needs to review the raw marks submitted for a module to check for consistency before the board meeting.

**Steps:**

1. Log in to the admin console as `examiner` (password `Demo-2026!`).
2. Navigate to **Students** (`/students`) and search for a student (try `alice` or `bob`).
3. Open a student's record and select the **Assessment** tab.
4. You should see a table of assessment marks: module code, component, raw mark, and grade. In S4, marks have been submitted.
5. Confirm the marks are readable but that no edit or submit action is available — the examiner role has read-only access to marks.

---

### AR-05 — Review communications sent to a student

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/students

> A student has claimed they did not receive a notification about their marks. The registry needs to verify the communications log.

**Steps:**

1. Log in as `registry` and open Alice's student detail page (search for `alice` from `/students`).
2. Select the **Communications** tab.
3. Review the list of communications sent to Alice. Each row shows the subject, channel (email/portal), sent date, and delivery status.
4. In S4, there should be at least one notification about marks or a wellbeing referral.
5. Note the delivery status — `delivered` indicates the message was sent successfully.

---

### WB-01 — View and manage a student wellbeing referral

**Persona:** `wellbeing` · **Role:** Wellbeing Advisor · **App:** Admin console · **URL:** http://localhost:5173/students

> A wellbeing advisor has received an alert that a student has been referred for wellbeing support. They need to review the referral and update its status.

**Steps:**

1. Log in to the admin console as `wellbeing`.
2. Navigate to **Students** (`/students`) and search for `bob`. Open Bob's student record.
3. Select the **Wellbeing** tab on Bob's student detail page.
4. You should see a wellbeing referral in the list. Review its type, date, and current status.
5. Select the referral to open its detail view (if available) or review the summary shown in the tab.
6. Note the current status (for example, **open** or **in-progress**). In S4, Bob has an active referral.

---

### WB-02 — Review a disability support case

**Persona:** `wellbeing` · **Role:** Wellbeing Advisor · **App:** Admin console · **URL:** http://localhost:5173/students

> A wellbeing advisor needs to review a student's disability declaration and the associated support plan.

**Steps:**

1. Log in as `wellbeing` and open the student record for Alice (`/students`, search `alice`).
2. Select the **Wellbeing** tab.
3. Locate the **Disability declarations** section within the Wellbeing tab. Alice should have a disability declaration in S4.
4. Review the declaration: disability type, date of declaration, and current status.
5. Note the **Adjustments** section — any approved adjustments derived from the declaration should appear here or be accessible via the student's Adjustments tab.

---

### WB-03 — Process an extenuating circumstances submission

**Persona:** `wellbeing` · **Role:** Wellbeing Advisor · **App:** Admin console · **URL:** http://localhost:5173/students

> A wellbeing advisor needs to review Bob's extenuating circumstances claim and approve it ahead of the exam board.

**Steps:**

1. Log in as `wellbeing` and navigate to Bob's student record (`/students`, search `bob`).
2. Select the **Wellbeing** tab and locate the **Extenuating circumstances** section.
3. Bob should have at least one EC claim in S4. Review the claim: affected module, circumstance type, description, and current status.
4. If a workflow task for this claim is available (status `pending` or `in-progress`), note that progression requires the wellbeing advisor to act via the **Task Inbox** — see story TI-01 below.
5. Review whether supporting evidence has been provided (noted in the claim record).

---

### TI-01 — Work through the task inbox

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/tasks

> The registry administrator has tasks assigned to them from several workflow processes and needs to work through the inbox before the end of the day.

**Steps:**

1. Log in as `registry` and navigate to **Tasks** (`/tasks`).
2. The task inbox shows all tasks assigned to the registry role, filtered to **pending** by default.
3. Review the list. Each task shows its type, step name, assigned role, due date, and status.
4. Use the **Status** filter dropdown to view tasks in other states (for example, `in-progress` or `completed`).
5. Select **Complete** on a pending task. A confirmation prompt appears.
6. Confirm the completion. The task status updates to `completed` and it moves out of the pending view.
7. Select **View workflow** on any task to open the associated workflow instance detail.

---

### RE-07 — Process an FOI / Subject Access Request

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/reporting/foi

> The DPO has received a Subject Access Request and needs to log it in the register and track its progress.

**Steps:**

1. Log in to the admin console as `dpo`.
2. Navigate to **Reporting → FOI / SAR** (`/reporting/foi`). You see the Freedom of Information and Subject Access Request register.
3. Review any existing requests in the list. In S4, there may be pre-seeded FOI/SAR records.
4. The register shows each request's type (FOI or SAR), received date, requester name, status, and response deadline.
5. Note the response deadlines — FOI requests must be responded to within 20 working days; SARs within 30 calendar days.
6. If the list is empty, note that this is expected — the demo data for S4 may not include active FOI records. The page structure and columns are the key things to verify.

---

### AU-01 — Browse the system audit log

**Persona:** `dpo` · **Role:** Data Protection Officer · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/audit

> The DPO needs to check the audit log for evidence of recent changes to student records.

**Steps:**

1. Log in as `dpo` and navigate to **Tenant Admin → Audit** (`/tenant-admin/audit`).
2. The audit page explains that entity-level audit history is accessed via the **History** tab on each student record. This is the designed approach in v1.0.0 — a DPO-facing global audit dashboard is on the roadmap.
3. To review a student's audit trail, navigate to **Students** (`/students`), open any student record, and select the **History** tab.
4. The History tab shows a bitemporal record of all changes: what was changed, when it was changed, and the transaction time at which the change was recorded.
5. Confirm that data-modifying actions from earlier in this walkthrough (for example, profile edits from story P-02) are visible in the History tab.
