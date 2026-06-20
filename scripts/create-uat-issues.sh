#!/usr/bin/env bash
# scripts/create-uat-issues.sh
#
# Creates the UAT Round 1 milestone, labels, and all 50 story issues on GitHub.
# Requires the GitHub CLI (gh) to be installed and authenticated:
#   brew install gh && gh auth login
#
# Usage:
#   bash scripts/create-uat-issues.sh
#
# Safe to re-run: gh will error on duplicate labels/milestone (ignored with || true).
# Issues are NOT deduplicated — do not run more than once.

set -euo pipefail

REPO="RevelationCore/Revelation-SRS"
MILESTONE="UAT Round 1"

echo "==> Creating milestone: ${MILESTONE}"
gh api repos/${REPO}/milestones \
  --method POST \
  --field title="${MILESTONE}" \
  --field description="Story-based user acceptance testing — all 50 stories across portal and admin." \
  --field state="open" 2>/dev/null || echo "    (milestone may already exist — continuing)"

# Resolve milestone number
MILESTONE_NUM=$(gh api repos/${REPO}/milestones --jq ".[] | select(.title==\"${MILESTONE}\") | .number")
echo "    Milestone number: ${MILESTONE_NUM}"

echo "==> Creating labels"

create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "${name}" --color "${color}" --description "${desc}" --repo "${REPO}" 2>/dev/null \
    || echo "    (label '${name}' may already exist — skipping)"
}

create_label "uat/story"          "0075ca" "UAT story issue"
create_label "uat/bug"            "d73a4a" "Bug found during UAT"
create_label "uat/placeholder"    "e4e669" "Page is a placeholder or stub — not fully wired"
create_label "severity/critical"  "b60205" "Crash, data loss, or security issue"
create_label "severity/high"      "e4501e" "Core function broken, no workaround"
create_label "severity/medium"    "f9c513" "Workaround exists; usability impaired"
create_label "severity/low"       "cfd3d7" "Cosmetic or wording issue"
create_label "area/portal"        "7057ff" "Student portal (http://localhost:5174)"
create_label "area/admin"         "3d71d6" "Admin console (http://localhost:5173)"
create_label "area/student-records" "0e8a16" "Student records functionality"
create_label "area/corrections"   "e4a11b" "Corrections and appeals"
create_label "area/wellbeing"     "0075ca" "Wellbeing and disability"
create_label "area/exam-boards"   "5319e7" "Exam boards and ratification"
create_label "area/regulatory"    "b60205" "Regulatory compliance"
create_label "area/reporting"     "006b75" "Reporting and data extracts"
create_label "area/operations"    "cccccc" "Operations and configuration"
create_label "area/audit"         "444444" "Audit log"

echo "==> Labels created"

# Helper: create one issue
create_issue() {
  local title="$1" labels="$2" body="$3"
  echo "  Creating: ${title}"
  gh issue create \
    --repo "${REPO}" \
    --title "${title}" \
    --label "${labels}" \
    --milestone "${MILESTONE}" \
    --body "${body}"
}

echo "==> Creating portal stories"

create_issue \
  "P-01: First login and dashboard navigation" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice Henderson has received her university welcome email. She's logging in to the student portal for the very first time and wants to check that everything looks right before term starts.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Open http://localhost:5174 — you should see the Revelation SRS login page with a yellow/amber panel at the bottom listing demo accounts and the shared password
- [ ] **2.** Confirm the demo panel shows `alice.demo`, `bob.demo`, and `carol.demo` with role descriptions
- [ ] **3.** Click **Sign in with Keycloak** — you should be redirected to the Keycloak login screen
- [ ] **4.** Enter username `alice.demo` and password `Demo-2026!`, then click Sign In
- [ ] **5.** After sign-in you should land on the portal dashboard at http://localhost:5174/dashboard
- [ ] **6.** An amber banner near the top of the page should read something like "Demo environment — enrolment-induction"
- [ ] **7.** The left sidebar should show navigation items including: Dashboard, My Modules, My Profile, and others
- [ ] **8.** Alice's name should appear somewhere in the sidebar or page header
- [ ] **9.** Click **Dismiss** on the demo banner — it should disappear without reloading the page
- [ ] **10.** Refresh the page — the banner should remain dismissed for this session (it uses sessionStorage)
- [ ] **11.** Click each sidebar navigation item in turn and confirm each page loads without a blank screen or error

---

## Issues found

If any step fails, open a new issue using the **UAT Bug Report** template and reference story **P-01** with the step number. Paste the link here as a comment.
BODY
)"

create_issue \
  "P-02: View and edit profile details" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice wants to check that the university has her correct details on file — her preferred name and contact information — and update her preferred name before the semester begins.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` (see P-01 for login steps if needed)
- [ ] **2.** Click **My Profile** in the left sidebar
- [ ] **3.** Your profile page should display: legal name, preferred name, date of birth, and student number
- [ ] **4.** Enrolment status should show as **Enrolled**
- [ ] **5.** Click **Edit profile** (or the edit button/link on the page)
- [ ] **6.** The edit form should load with current values pre-filled
- [ ] **7.** Change the preferred name field to something different (e.g., add "Ali")
- [ ] **8.** Click **Save** — the form should submit without errors
- [ ] **9.** After saving you should be returned to the profile view page (not stay on the edit form)
- [ ] **10.** The updated preferred name should now appear on the profile page

---

## Issues found

Open a **UAT Bug Report** and reference story **P-02** with the step number.
BODY
)"

create_issue \
  "P-03: Add a term-time address" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice has just moved into her student accommodation and needs to register her term-time address with the university so she can receive official correspondence.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` and navigate to **My Profile**
- [ ] **2.** Look for an **Addresses** section or an **Add address** link on the profile page
- [ ] **3.** Click **Add address**
- [ ] **4.** The add address form should load
- [ ] **5.** Fill in the fields: Address line 1 (e.g., "1 University Road"), City (e.g., "London"), Postcode (use `ZZ99 1AA` — this is a safe demo postcode)
- [ ] **6.** Select address type **Term-time** (or equivalent option)
- [ ] **7.** Click **Save**
- [ ] **8.** After saving, you should be returned to the profile page (not stay on the form)
- [ ] **9.** The new address should appear in the addresses section of the profile

---

## Issues found

Open a **UAT Bug Report** and reference story **P-03** with the step number.
BODY
)"

create_issue \
  "P-04: View current enrolment status" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice wants to confirm that she is officially enrolled for the current academic year and check the details of her programme.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo`
- [ ] **2.** Click **Enrolments** (or **My Enrolment**) in the left sidebar
- [ ] **3.** Alice's current enrolment should appear in the list with status **Enrolled**
- [ ] **4.** The enrolment should show: programme name, academic year of entry, and start date
- [ ] **5.** If enrolments are clickable, click through to see more detail — mode of study and fee status should be visible
- [ ] **6.** Navigate back to the enrolment list using the sidebar or back button — the page should reload cleanly

---

## Issues found

Open a **UAT Bug Report** and reference story **P-04** with the step number.
BODY
)"

create_issue \
  "P-05: Browse module registrations" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice has been told her module registrations have been set up for the year. She logs in to check which modules she has been placed on and what the status of each registration is.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S3 — module-selection |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S3 using the command above, then log in as `alice.demo`
- [ ] **2.** Confirm the demo banner shows **module-selection**
- [ ] **3.** Click **My Modules** in the left sidebar
- [ ] **4.** Alice should have at least two module registrations listed (one autumn, one spring)
- [ ] **5.** Each registration should show: module code, module name, registration status, and academic period
- [ ] **6.** At least one module should show status **Registered**
- [ ] **7.** Check that different statuses are visible across modules (e.g., Registered, Waitlisted, Draft) — the exact mix depends on Alice's position in the demo dataset

---

## Issues found

Open a **UAT Bug Report** and reference story **P-05** with the step number.
BODY
)"

create_issue \
  "P-06: Withdraw from a module" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice has decided that one of her registered modules is not what she expected. She wants to withdraw from it before the withdrawal deadline.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S3 — module-selection |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` on S3 and navigate to **My Modules**
- [ ] **2.** Find a module with status **Registered**
- [ ] **3.** Click **Withdraw** next to that module (or the equivalent action button)
- [ ] **4.** A confirmation prompt or message should appear asking you to confirm the withdrawal
- [ ] **5.** Confirm the withdrawal
- [ ] **6.** You should be returned to the module listing page (not stay on a confirmation screen)
- [ ] **7.** The module's status should now show as **Withdrawn** in the list
- [ ] **8.** Navigate away (e.g., to Dashboard) and then back to **My Modules** — the withdrawal should still be shown

---

## Issues found

Open a **UAT Bug Report** and reference story **P-06** with the step number.
BODY
)"

create_issue \
  "P-07: Add an optional module" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice has heard that she can add an optional elective module to her programme. She wants to browse what is available and register for one.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S3 — module-selection |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` on S3 and navigate to **My Modules**
- [ ] **2.** Look for an **Add module** button or link on the page
- [ ] **3.** Click **Add module** — a list of available module offerings should appear
- [ ] **4.** The list should show module name, code, credits, and period for each offering
- [ ] **5.** Select an available module and click **Add** or **Register**
- [ ] **6.** A confirmation step should appear before the registration is submitted
- [ ] **7.** Confirm — the module should appear in Alice's module list with status **Draft** or **Registered**

---

## Issues found

Open a **UAT Bug Report** and reference story **P-07** with the step number.
BODY
)"

create_issue \
  "P-08: View the exam timetable" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice wants to find out when and where her exams will be held, and check her candidate number for the exam hall.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S3 — module-selection |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection` |
| **Reset time** | ~15 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` on S3 and click **Exam Timetable** (or **Exams**) in the sidebar
- [ ] **2.** Alice's exam entries should be listed — at least one entry should appear for her registered modules
- [ ] **3.** Each entry should show: module name, exam date and time, venue or hall, and candidate number (prefixed `DEMO-CAND-`)
- [ ] **4.** Entries should appear in chronological order by exam date
- [ ] **5.** If there are no exam entries (e.g., Alice's modules have no written exams), an empty state message should appear — that is not a failure

---

## Issues found

Open a **UAT Bug Report** and reference story **P-08** with the step number.
BODY
)"

create_issue \
  "P-09: View marks and results" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> The exam board has met and Alice is anxious to find out her results. She logs in to see whether she has passed her modules this year.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S5 and log in as `alice.demo`
- [ ] **2.** Confirm the demo banner shows **exam-board**
- [ ] **3.** Click **Results** in the left sidebar
- [ ] **4.** Alice's module results should be listed — at least two results should appear
- [ ] **5.** Each result should show: module name, mark or grade, and result code (e.g., Pass, Compensated, Fail)
- [ ] **6.** Results should be from the current academic year
- [ ] **7.** If a result is available for viewing (post-ratification), it should be clearly displayed with no "pending" or "not yet available" blocker

---

## Issues found

Open a **UAT Bug Report** and reference story **P-09** with the step number.
BODY
)"

create_issue \
  "P-10: Declare a disability" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice has recently been diagnosed with dyslexia. She wants to let the university know so that appropriate support can be arranged before her exams.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S4 and log in as `alice.demo`
- [ ] **2.** Click **Disability** in the left sidebar
- [ ] **3.** The disability page should load and show any existing declarations
- [ ] **4.** Click **Add declaration** (or equivalent button)
- [ ] **5.** The declaration form should load with a disability type dropdown
- [ ] **6.** Select a disability type from the dropdown (e.g., Dyslexia or similar)
- [ ] **7.** Optionally add supporting notes in the text field
- [ ] **8.** Click **Submit** (or **Save**)
- [ ] **9.** After submitting you should be returned to the disability **listing** page — not stay on the form
- [ ] **10.** Your new declaration should appear in the list on the listing page

---

## Issues found

Open a **UAT Bug Report** and reference story **P-10** with the step number.
BODY
)"

create_issue \
  "P-11: Submit an extenuating circumstances claim" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Bob's grandmother passed away the week before his coursework deadline. He wants to submit an extenuating circumstances claim so the board can take this into account when reviewing his marks.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `bob.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S4 and log in as `bob.demo`
- [ ] **2.** Click **Extenuating Circumstances** (or **My Circumstances**) in the left sidebar
- [ ] **3.** Any existing EC claims for Bob should be listed
- [ ] **4.** Click **Submit claim** or **Add claim**
- [ ] **5.** The claim form should appear with a module selector dropdown
- [ ] **6.** Select the affected module from the dropdown
- [ ] **7.** Enter a description of the circumstances in the text area
- [ ] **8.** Click **Submit**
- [ ] **9.** After submitting you should be returned to the EC listing page
- [ ] **10.** The new claim should appear in the list with a status such as **Submitted** or **Pending**

---

## Issues found

Open a **UAT Bug Report** and reference story **P-11** with the step number.
BODY
)"

create_issue \
  "P-12: View learning adjustments" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Carol has been assessed by the disability support team and has been granted additional time in exams. She logs in to confirm that her adjustments are recorded correctly.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `carol.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S4 and log in as `carol.demo`
- [ ] **2.** Click **Adjustments** (or **Learning Support**) in the left sidebar
- [ ] **3.** Carol's learning adjustments should be listed — S4 data includes adjustment records for students with disability cases
- [ ] **4.** Each adjustment should show: adjustment type, effective date, and status
- [ ] **5.** If Carol has no adjustments in the demo dataset, an empty state message should appear — that is not a failure; note it in a comment on this issue

---

## Issues found

Open a **UAT Bug Report** and reference story **P-12** with the step number.
BODY
)"

create_issue \
  "P-13: View notifications" \
  "uat/story,area/portal" \
  "$(cat <<'BODY'
> Alice notices the notifications icon in her sidebar. She wants to check if she has any messages from the university and mark them as read.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Student portal — http://localhost:5174 |
| **Login as** | `alice.demo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `alice.demo` on S4
- [ ] **2.** Click **Notifications** in the left sidebar
- [ ] **3.** The notifications page should load without error
- [ ] **4.** If notifications exist, they should be listed with: title, date, and a read/unread indicator
- [ ] **5.** Click a notification to mark it as read (if available)
- [ ] **6.** The notification's visual state should change to indicate it has been read
- [ ] **7.** If no notifications exist for Alice in S4, an empty state message should appear — that is not a failure

---

## Issues found

Open a **UAT Bug Report** and reference story **P-13** with the step number.
BODY
)"

echo "==> Creating admin — student records stories"

create_issue \
  "AR-01: Search for a student and open their record" \
  "uat/story,area/admin,area/student-records" \
  "$(cat <<'BODY'
> A registry officer has received a call from a student about their enrolment. She needs to find the student's record quickly using their name and open it.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Open http://localhost:5173 — you should see the admin login page with a panel listing demo staff accounts
- [ ] **2.** Log in as `registry` / `Demo-2026!`
- [ ] **3.** Confirm the demo banner shows **assessment-marks**
- [ ] **4.** The admin sidebar should be visible on the left with grouped navigation sections
- [ ] **5.** Click **Students** in the sidebar
- [ ] **6.** A student search page should load with a search input
- [ ] **7.** Type "Alice" (or part of a student name) and submit the search
- [ ] **8.** Results should appear showing matching students with student number and enrolment status
- [ ] **9.** Click on Alice's record — the student detail page should open
- [ ] **10.** The page title or heading should show Alice's name and student number

---

## Issues found

Open a **UAT Bug Report** and reference story **AR-01** with the step number.
BODY
)"

create_issue \
  "AR-02: Review student overview, enrolments, and contacts" \
  "uat/story,area/admin,area/student-records" \
  "$(cat <<'BODY'
> The registry officer has Alice's record open. She needs to check Alice's personal details, confirm her enrolment, and verify her contact address is up to date.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `registry`, open Alice's student detail page (see AR-01)
- [ ] **2.** The **Overview** tab should show: legal name, preferred name, date of birth, student number, and nationality
- [ ] **3.** Click the **Enrolments** tab — Alice's current enrolment should appear with programme, year, status, and fee information
- [ ] **4.** Click the **Communications** tab — any communications sent to Alice should be listed
- [ ] **5.** All tabs should load without a spinner remaining indefinitely or an error message
- [ ] **6.** The tab navigation should remain visible and functional as you switch between tabs

---

## Issues found

Open a **UAT Bug Report** and reference story **AR-02** with the step number.
BODY
)"

create_issue \
  "AR-03: Review module registrations from the student record" \
  "uat/story,area/admin,area/student-records" \
  "$(cat <<'BODY'
> A registry officer needs to check which modules a student is registered on this year, following a query about a timetable clash.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S3 — module-selection |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S3, log in as `registry`, and open Alice's student detail page
- [ ] **2.** Navigate to the **Modules** or **Registrations** tab on the student detail page
- [ ] **3.** Alice's module registrations for this year should be listed
- [ ] **4.** Each registration shows: module code, module name, registration status, and academic period
- [ ] **5.** Confirm at least two registrations appear (one autumn, one spring)

---

## Issues found

Open a **UAT Bug Report** and reference story **AR-03** with the step number.
BODY
)"

create_issue \
  "AR-04: Review a student's assessment marks" \
  "uat/story,area/admin,area/student-records" \
  "$(cat <<'BODY'
> An external examiner has been asked to spot-check the marks entered for a student's modules before the exam board meets.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `examiner` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S4, log in as `examiner`, and search for Alice in **Students**
- [ ] **2.** Open Alice's student detail page
- [ ] **3.** Navigate to the **Assessment** or **Marks** tab
- [ ] **4.** Component marks (coursework and exam) should be listed with numerical values in the range 30–85
- [ ] **5.** A module result summary should show the aggregate mark and result code (Pass / Compensated / Fail)
- [ ] **6.** Marks should show as **not locked** (the board has not yet met in S4)

---

## Issues found

Open a **UAT Bug Report** and reference story **AR-04** with the step number.
BODY
)"

create_issue \
  "AR-05: Review communications sent to a student" \
  "uat/story,area/admin,area/student-records" \
  "$(cat <<'BODY'
> A registry officer wants to check what communications the university has sent to a student, to respond to a complaint that a letter was not received.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `registry` on S4 and open any student's detail page
- [ ] **2.** Click the **Communications** tab
- [ ] **3.** Any communications sent to this student should be listed
- [ ] **4.** Each entry should show: communication type, date sent, and subject or summary
- [ ] **5.** If no communications exist for the selected student in S4, try a different student — or note it as an empty state and verify the empty state message is helpful

---

## Issues found

Open a **UAT Bug Report** and reference story **AR-05** with the step number.
BODY
)"

echo "==> Creating admin — corrections stories"

create_issue \
  "CO-01: Raise a new correction case against a board decision" \
  "uat/story,area/admin,area/corrections" \
  "$(cat <<'BODY'
> A student has formally challenged the mark awarded for one of her modules. The registry officer needs to open a correction case on her record so the query can be tracked through to resolution.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S5, log in as `registry`, and open Alice's student detail page
- [ ] **2.** Click the **Corrections** tab
- [ ] **3.** Any existing correction cases should be listed
- [ ] **4.** Click **Raise correction** or **New case**
- [ ] **5.** A case type dropdown should appear — select a type (e.g., "Mark query" or "Assessment appeal")
- [ ] **6.** Enter a description of the issue
- [ ] **7.** Submit the case
- [ ] **8.** The new case should appear in the corrections list with status **Open**

---

## Issues found

Open a **UAT Bug Report** and reference story **CO-01** with the step number.
BODY
)"

create_issue \
  "CO-02: Progress and resolve a correction case" \
  "uat/story,area/admin,area/corrections" \
  "$(cat <<'BODY'
> The registry officer has reviewed the evidence submitted with a correction case. She needs to update the case status as it moves through the review process towards resolution.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Open a student's **Corrections** tab (raise one first using CO-01 if none exist)
- [ ] **2.** Find an **Open** correction case
- [ ] **3.** Click the button to move it to **Under Review** — the status should update immediately
- [ ] **4.** Now move it to **Upheld** — the status should update
- [ ] **5.** Reset the scenario and try again, this time resolving as **Not Upheld**
- [ ] **6.** Verify that each status transition is reflected without a page reload being required
- [ ] **7.** Confirmed status labels should match the value-set entries (Open, Under Review, Upheld, Not Upheld, Withdrawn)

---

## Issues found

Open a **UAT Bug Report** and reference story **CO-02** with the step number.
BODY
)"

echo "==> Creating admin — wellbeing stories"

create_issue \
  "WB-01: View and manage a student wellbeing referral" \
  "uat/story,area/admin,area/wellbeing" \
  "$(cat <<'BODY'
> A wellbeing advisor has been alerted that a student is struggling. She needs to find his record and review the open wellbeing referral to understand the situation before their appointment.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `wellbeing` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S4, log in as `wellbeing`, and search for Bob in **Students** (Bob has a wellbeing case in S4)
- [ ] **2.** Open Bob's student detail page
- [ ] **3.** Click the **Wellbeing** tab
- [ ] **4.** Bob's wellbeing referral(s) should be listed with: case type, referral date, and status
- [ ] **5.** Click through to the case detail if the interface allows it
- [ ] **6.** Case notes or supporting information should be visible

---

## Issues found

Open a **UAT Bug Report** and reference story **WB-01** with the step number.
BODY
)"

create_issue \
  "WB-02: Review a disability support case" \
  "uat/story,area/admin,area/wellbeing" \
  "$(cat <<'BODY'
> A wellbeing advisor needs to review a student's disability declaration to ensure the agreed support plan is in place before the exam period.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `wellbeing` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `wellbeing` on S4 and open Alice's student detail page
- [ ] **2.** Click the **Wellbeing** tab and look for a **Disability** sub-section or tab
- [ ] **3.** Alice's disability declaration(s) should be listed — S4 includes disability support cases for some students
- [ ] **4.** Each case should show: disability type, date declared, and any case notes
- [ ] **5.** If Alice has no disability case in S4, check a different student or note the empty state

---

## Issues found

Open a **UAT Bug Report** and reference story **WB-02** with the step number.
BODY
)"

create_issue \
  "WB-03: Process an extenuating circumstances submission" \
  "uat/story,area/admin,area/wellbeing" \
  "$(cat <<'BODY'
> Bob has submitted an extenuating circumstances claim. The wellbeing advisor needs to review the claim and update its status to indicate it has been verified and is ready for the board.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `wellbeing` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `wellbeing` on S4 and open Bob's student detail page
- [ ] **2.** Click the **Wellbeing** tab and find the **Extenuating Circumstances** section
- [ ] **3.** Bob's EC claim(s) should be listed with status, affected module, and description
- [ ] **4.** Click to view or expand a claim
- [ ] **5.** If a status change action is available (e.g., Approve, Reject, or Request evidence), click it
- [ ] **6.** The status should update and be reflected in the list

---

## Issues found

Open a **UAT Bug Report** and reference story **WB-03** with the step number.
BODY
)"

echo "==> Creating admin — exam board stories"

create_issue \
  "EB-01: Browse the exam boards list" \
  "uat/story,area/admin,area/exam-boards" \
  "$(cat <<'BODY'
> The exam board chair has been sent a meeting invitation and wants to check the schedule of upcoming and recent boards in the system.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `chair` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S5, log in as `chair`
- [ ] **2.** Click **Exam Boards** in the admin sidebar
- [ ] **3.** A list of exam boards should appear — S5 has 4 boards (3 module boards + 1 award board)
- [ ] **4.** Each board entry should show: board name, academic year, board type, and ratification status
- [ ] **5.** Ratified boards should be visually distinguished from pending ones
- [ ] **6.** The award board should be identifiable in the list

---

## Issues found

Open a **UAT Bug Report** and reference story **EB-01** with the step number.
BODY
)"

create_issue \
  "EB-02: Review an exam board — agenda and data pack" \
  "uat/story,area/admin,area/exam-boards" \
  "$(cat <<'BODY'
> The chair needs to review the data pack and agenda for a ratified module board before chairing the appeal panel that will review contested decisions.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `chair` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `chair` on S5 and navigate to **Exam Boards**
- [ ] **2.** Click on one of the ratified module boards
- [ ] **3.** The board detail page should open
- [ ] **4.** The board's ratification date and status should be prominently displayed
- [ ] **5.** A data pack summary or reference should be visible
- [ ] **6.** Board membership / attendees should be listed (members, external examiner sign-offs)
- [ ] **7.** Navigate back to the boards list and open a different board — the detail page should load cleanly each time

---

## Issues found

Open a **UAT Bug Report** and reference story **EB-02** with the step number.
BODY
)"

create_issue \
  "EB-03: Review candidate profiles and progression decisions" \
  "uat/story,area/admin,area/exam-boards" \
  "$(cat <<'BODY'
> The chair wants to review the candidate profiles for students who were considered at a board, checking that progression decisions have been recorded correctly.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `chair` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `chair` on S5 and open a ratified module board (see EB-02)
- [ ] **2.** Look for a **Candidates** or **Profiles** section within the board detail
- [ ] **3.** A list of students considered at this board should appear — S5 has ~700 candidate profiles
- [ ] **4.** Each candidate row should show: student name or number, programme, and progression recommendation or decision
- [ ] **5.** Click on one candidate to see their profile — marks, prior decisions, and recommendation should be visible
- [ ] **6.** Navigate back to the full candidate list — it should reload correctly

---

## Issues found

Open a **UAT Bug Report** and reference story **EB-03** with the step number.
BODY
)"

create_issue \
  "EB-04: Review ratified award decisions" \
  "uat/story,area/admin,area/exam-boards" \
  "$(cat <<'BODY'
> The chair needs to review the award decisions made at the award board to confirm that all classifications are correctly recorded before degree certificates are prepared.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S5 — exam-board |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset exam-board` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `chair` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `chair` on S5, navigate to **Exam Boards**, and find the award board
- [ ] **2.** Open the award board detail page
- [ ] **3.** Award decisions should be listed: student, programme, classification, and award type
- [ ] **4.** Classifications should be from the valid set: First, 2:1, 2:2, Third, Pass, Fail
- [ ] **5.** The total count of awards should be visible (S5 has ~200 awards)
- [ ] **6.** The board should be shown as **Ratified** with a ratification date

---

## Issues found

Open a **UAT Bug Report** and reference story **EB-04** with the step number.
BODY
)"

echo "==> Creating admin — task inbox story"

create_issue \
  "TI-01: Work through the task inbox" \
  "uat/story,area/admin" \
  "$(cat <<'BODY'
> A registry officer starts their morning by checking the task inbox to see if any workflow tasks have been assigned to them that need action today.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `registry` on S4
- [ ] **2.** Click **Tasks** in the admin sidebar
- [ ] **3.** The task inbox page should load without error
- [ ] **4.** If tasks exist, each should show: task title, due date, priority, and task type
- [ ] **5.** Click on a task to view its detail
- [ ] **6.** The task detail should provide enough context to understand what action is required
- [ ] **7.** If the inbox is empty in S4, confirm that the empty state message is clear and helpful — an empty inbox is not a failure

---

## Issues found

Open a **UAT Bug Report** and reference story **TI-01** with the step number.
BODY
)"

echo "==> Creating admin — regulatory stories"

create_issue \
  "RE-01: Review the regulatory compliance overview" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> The data protection officer wants a high-level view of where the institution stands with all its regulatory obligations before the annual compliance review meeting.

> **Note:** S6 loads 50,000 students. The reset takes 30–60 seconds. Wait for the "Reset complete" message.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S6 (be patient — this loads 50,000 students), then log in as `dpo`
- [ ] **2.** Confirm the demo banner shows **institution-year**
- [ ] **3.** Click **Regulatory** in the admin sidebar
- [ ] **4.** **[PLACEHOLDER — navigation hub]** The regulatory page shows navigation cards for: HESA, UCAS, SLC, UKVI, and OfS — this is expected
- [ ] **5.** Click each card in turn and verify that the relevant sub-page loads
- [ ] **6.** All five sub-pages (HESA, UCAS, SLC, UKVI, OfS) should load without an error

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-01** with the step number.
BODY
)"

create_issue \
  "RE-02: Review HESA return status and submissions" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> The DPO needs to check the status of the annual HESA student data return before signing off the institution's regulatory compliance report.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `dpo` on S6 and navigate to **Regulatory → HESA**
- [ ] **2.** The HESA page should show submission status for the current year
- [ ] **3.** S6 contains 3 submitted HESA returns and 1 draft — these should be visible or counted
- [ ] **4.** Submission statistics (e.g., student count, extract date) should be displayed
- [ ] **5.** The page should load fully without requiring a manual refresh

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-02** with the step number.
BODY
)"

create_issue \
  "RE-03: Review OfS regulatory obligations" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> The DPO needs to check the institution's Office for Students compliance position, including B3 extract status and participation metrics.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `dpo` on S6 and navigate to **Regulatory → OfS**
- [ ] **2.** The OfS page should load without error
- [ ] **3.** B3 extract status and/or participation metrics should be displayed
- [ ] **4.** Note any data shown and whether it appears plausible for a 50,000-student institution

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-03** with the step number.
BODY
)"

create_issue \
  "RE-04: Review SLC loan data and triggers" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> A registry officer needs to check the SLC confirmation status and understand how to trigger a transmission if required.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `registry` on S6 and navigate to **Regulatory → SLC**
- [ ] **2.** The SLC page should load showing a description of the confirmation process
- [ ] **3.** A **Generate SLC confirmations** button should be visible
- [ ] **4.** **Do NOT click the button** — this would queue a transmission against demo data
- [ ] **5.** Verify the page description is clear about what the action will do
- [ ] **6.** The page should load without error and display correctly

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-04** with the step number.
BODY
)"

create_issue \
  "RE-05: Review UCAS application pipeline data" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> A registry officer wants to review the current state of UCAS applications to understand how many offers are outstanding ahead of Clearing.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `registry` on S6 and navigate to **Regulatory → UCAS**
- [ ] **2.** The UCAS page should load without error
- [ ] **3.** Application pipeline data should be visible — counts or statuses by application state
- [ ] **4.** The data should be plausible for a large institution (S6 has a full cohort of applicants from S1 at scale)

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-05** with the step number.
BODY
)"

create_issue \
  "RE-06: Review UKVI compliance and CAS records" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> The DPO needs to review the institution's UKVI compliance position — specifically checking CAS (Confirmation of Acceptance for Studies) records and any flagged attendance issues.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `dpo` on S6 and navigate to **Regulatory → UKVI**
- [ ] **2.** The UKVI page should load without error
- [ ] **3.** CAS records should be listed or summarised — counts by status should appear
- [ ] **4.** Any flagged compliance issues should be visible
- [ ] **5.** The data should be plausible (S6 has ~30 CAS records per cohort year)

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-06** with the step number.
BODY
)"

create_issue \
  "RE-07: Process an FOI / Subject Access Request" \
  "uat/story,area/admin,area/regulatory" \
  "$(cat <<'BODY'
> The DPO has received a Subject Access Request from a student. She needs to locate the FOI/SAR register and understand how to trigger a data extract.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `dpo` on S4 and navigate to **Reporting → FOI** (accessible via the Reporting hub or sidebar)
- [ ] **2.** The FOI/SAR page should load without error
- [ ] **3.** A register of FOI and SAR requests should be visible (or an empty state if no requests exist in S4)
- [ ] **4.** An option to create a new request or trigger an extract should be visible
- [ ] **5.** Complete the register entry form if available — fill in requester name, request type, and received date
- [ ] **6.** Submit the form and confirm the new entry appears in the register

---

## Issues found

Open a **UAT Bug Report** and reference story **RE-07** with the step number.
BODY
)"

echo "==> Creating admin — reporting stories"

create_issue \
  "RP-01: Generate and view the enrolment report" \
  "uat/story,area/admin,area/reporting" \
  "$(cat <<'BODY'
> A registry officer needs to pull enrolment statistics ahead of the governors' meeting to show how many students are currently active, intermitting, or withdrawn.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S6 and log in as `registry`
- [ ] **2.** Navigate to **Reporting → Enrolment volumes**
- [ ] **3.** The enrolment report should load with counts broken down by status (Enrolled, Intermitting, Withdrawn, Graduated) and year of entry
- [ ] **4.** With 50,000 students in S6, the totals should be substantial
- [ ] **5.** Any filter or breakdown controls (by year, status, programme) should be functional
- [ ] **6.** The data should update if you change filters

---

## Issues found

Open a **UAT Bug Report** and reference story **RP-01** with the step number.
BODY
)"

create_issue \
  "RP-02: Browse the reporting hub" \
  "uat/story,area/admin,area/reporting,uat/placeholder" \
  "$(cat <<'BODY'
> A platform operator wants to familiarise herself with the reporting section to understand what data extracts are available.

> **Note:** The reporting hub page (`/reporting`) is a **[PLACEHOLDER — navigation hub]** showing cards linking to sub-pages. This is expected behaviour. Test that the hub loads and the links work.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S6 — institution-year |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset institution-year` |
| **Reset time** | 30–60 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S6 and click **Reporting** in the admin sidebar
- [ ] **2.** The reporting hub should show three navigation cards: Enrolment volumes, Regulatory submission status, FOI
- [ ] **3.** Click **Enrolment volumes** — the report page should load (see RP-01)
- [ ] **4.** Navigate back to **Reporting** and click **Regulatory submission status** — a summary page should load
- [ ] **5.** Navigate back to **Reporting** and click **FOI** — the FOI register page should load
- [ ] **6.** All three sub-pages should load without error

---

## Issues found

Open a **UAT Bug Report** and reference story **RP-02** with the step number.
BODY
)"

echo "==> Creating admin — operations stories"

create_issue \
  "OP-01: Manage value sets — view, edit, retire, and add members" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator needs to review the valid values used in picklist dropdowns across the system, update an existing entry's label, retire a no-longer-used value, and add a new custom value for the institution.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Reset to S2 and log in as `ops`
- [ ] **2.** Navigate to **Tenant Admin → Value Sets** (accessible via the Administration section in the sidebar)
- [ ] **3.** A list of value sets should appear — multiple sets should be visible with their source and extensibility status
- [ ] **4.** Find a value set marked **extensible** and click to expand it
- [ ] **5.** The member list should appear — platform members show **Platform** (read-only); tenant members show **Edit** and **Retire** buttons
- [ ] **6.** Click **Edit** on a tenant-owned member, change the display label, and click **Save** — the label should update in the list
- [ ] **7.** Click **Retire** on a tenant-owned member, confirm the retirement — the member's status badge should change to **retired**
- [ ] **8.** Click **+ Add member**, fill in Code, Label, and Sort Order, leave Active from and Active to blank
- [ ] **9.** Click **Add member** — the new member should appear in the list as **active**
- [ ] **10.** The **Active from** column for the new member should show **—** (null means "valid from always")

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-01** with the step number.
BODY
)"

create_issue \
  "OP-02: Manage feature flags" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator needs to review the feature flags registered in the system to understand which optional capabilities are active for the institution.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Feature Flags**
- [ ] **2.** The feature flags page should list all registered flags — S2 has 5 demo flags configured
- [ ] **3.** Each flag should show: flag name, description, and current variant/assignment
- [ ] **4.** If a flag variant can be toggled from this page, toggle one and verify the change persists on refresh
- [ ] **5.** Navigate away and back — the flag state should be consistent

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-02** with the step number.
BODY
)"

create_issue \
  "OP-03: Browse the integration registry" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator wants to review all integration contracts registered in the system to audit which external systems are connected.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Integrations**
- [ ] **2.** The integration registry should list all registered integration contracts
- [ ] **3.** Each entry should show: integration name, version, and status
- [ ] **4.** Click on an entry to see contract details (schema version, endpoints) if the interface allows it
- [ ] **5.** The page should load without error

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-03** with the step number.
BODY
)"

create_issue \
  "OP-04: Review integration operations and connector status" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator wants to check the health of integration connectors and review any failed exchange records that may need attention.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Operations → Integration operations**
- [ ] **2.** The integration operations page should load without error
- [ ] **3.** Connector health summaries should be visible — each connector should show its status
- [ ] **4.** A failed exchange log or retry/replay controls should be accessible
- [ ] **5.** VLE connector residual status should be visible if the VLE integration is configured

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-04** with the step number.
BODY
)"

create_issue \
  "OP-05: Review academic rules configuration" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator needs to confirm that the institution's academic rules — progression criteria, classification boundaries, and award eligibility — are correctly configured.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Academic Rules**
- [ ] **2.** The academic rules page should list all configured rules — S2 has 22 rules
- [ ] **3.** Rules should be grouped or filterable by type (progression, classification, award eligibility, assessment)
- [ ] **4.** Each rule should show: rule type, parameters or criteria, and active status
- [ ] **5.** The page should load without error

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-05** with the step number.
BODY
)"

create_issue \
  "OP-06: Review workflow definitions" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator needs to check the workflow definitions to confirm that the correct workflow types and versions are active for the institution's processes.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Workflow Definitions**
- [ ] **2.** The workflow definitions page should list all registered workflow types and versions
- [ ] **3.** Each entry should show: workflow type, version, and responsibility assignment
- [ ] **4.** The page should load without error

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-06** with the step number.
BODY
)"

create_issue \
  "OP-07: Globalisation and locale settings" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator wants to review the institution's locale and currency settings, and check whether any value-set label overrides have been configured.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Globalisation**
- [ ] **2.** The globalisation page should load without error
- [ ] **3.** Locale, timezone, and currency settings should be displayed
- [ ] **4.** Any value-set label overrides configured for this institution should be listed
- [ ] **5.** If editable fields are present, verify they can be updated and saved

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-07** with the step number.
BODY
)"

create_issue \
  "OP-08: View environment runtime information" \
  "uat/story,area/admin,area/operations,uat/placeholder" \
  "$(cat <<'BODY'
> The platform operator needs to check the current system state — release version, migration status, and feature flag summary — to confirm the environment is healthy before a demonstration.

> **Note:** The dashboard quick-search is **[PLACEHOLDER — not yet wired]**. Stats show `—`. This is expected. The Environment Runtime page is fully functional.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Operations → Environment Runtime**
- [ ] **2.** The page should display the current release version (e.g., v1.0.0-rc.1)
- [ ] **3.** Migration state should show the highest applied migration number
- [ ] **4.** Active workflow definition count should be displayed
- [ ] **5.** Feature flag summary (active flags and their variants) should be listed
- [ ] **6.** All data should load without requiring a refresh
- [ ] **7.** Also visit the **Dashboard** (`/dashboard`) and note that the quick-search form is present but the stat cards show `—` — this is a known placeholder

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-08** with the step number.
BODY
)"

create_issue \
  "OP-09: Tenant administration and configuration" \
  "uat/story,area/admin,area/operations" \
  "$(cat <<'BODY'
> The platform operator needs to review the institution's core configuration — its name, academic year, and HESA/UCAS identifiers — before submitting a regulatory return.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `ops` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `ops` on S2 and navigate to **Tenant Admin → Tenant Configuration**
- [ ] **2.** The tenant configuration page should load without error
- [ ] **3.** Institution name, current academic year, locale, and HESA/UCAS institution identifiers should be visible
- [ ] **4.** Editable fields should be available for tenant-owned settings
- [ ] **5.** Update a non-critical field (e.g., a display setting) and save — confirm the change persists on refresh
- [ ] **6.** Also navigate to the **Tenant Admin hub** (`/tenant-admin`) and confirm all eight sub-section cards are visible and link to the correct pages

---

## Issues found

Open a **UAT Bug Report** and reference story **OP-09** with the step number.
BODY
)"

echo "==> Creating admin — audit story"

create_issue \
  "AU-01: Browse the system audit log" \
  "uat/story,area/admin,area/audit" \
  "$(cat <<'BODY'
> The DPO needs to review the audit log to trace a series of changes made to a student record following a data breach notification.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S4 — assessment-marks |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset assessment-marks` |
| **Reset time** | ~20 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `dpo` / `Demo-2026!` |

---

## Steps

- [ ] **1.** Log in as `dpo` on S4 and navigate to **Tenant Admin → Audit Log**
- [ ] **2.** The audit log should list recent system events in reverse chronological order
- [ ] **3.** Each entry should show: timestamp, actor (user or system), action performed, and entity type and ID affected
- [ ] **4.** Use any available filters (by date range, actor, or entity type) and verify they narrow the results
- [ ] **5.** If pagination is available, navigate to a later page to confirm it works
- [ ] **6.** The audit log should load within a few seconds even for S4's dataset

---

## Issues found

Open a **UAT Bug Report** and reference story **AU-01** with the step number.
BODY
)"

echo "==> Creating cross-cutting stories"

create_issue \
  "X-01: Demo environment reset and scenario banner verification" \
  "uat/story,area/admin,area/portal" \
  "$(cat <<'BODY'
> Before starting UAT in earnest, a tester needs to verify that the scenario reset process works correctly and that the demo banner accurately reflects the active scenario in both applications.

---

## Environment setup

No specific scenario required — this story tests the reset process itself.

| | |
|---|---|
| **Application** | Both — admin (http://localhost:5173) and portal (http://localhost:5174) |
| **Login as** | Any demo account |

---

## Steps

- [ ] **1.** Note the current scenario shown in the demo banner in the admin app (or run `pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` to start from a known state)
- [ ] **2.** Run the reset command to switch to a different scenario:
       `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset module-selection`
- [ ] **3.** Wait for the **"Reset complete"** or **"Migrations applied successfully"** output — do not proceed until you see it
- [ ] **4.** Refresh the admin app — the demo banner should now read **module-selection**
- [ ] **5.** Navigate to **Students** — the student count and data should reflect the S3 dataset
- [ ] **6.** Now reset to S5: `DATABASE_URL=... pnpm ... demo:reset exam-board`
- [ ] **7.** Refresh both apps — both banners should update to **exam-board**
- [ ] **8.** Log in to the portal as `alice.demo` — the banner should show **exam-board**
- [ ] **9.** There should be no residual data from the previous scenario visible (e.g., no S3-only records appearing in S5 views)

---

## Issues found

Open a **UAT Bug Report** and reference story **X-01** with the step number.
BODY
)"

create_issue \
  "X-02: Admin sidebar navigation — all sections reachable" \
  "uat/story,area/admin,uat/placeholder" \
  "$(cat <<'BODY'
> Before detailed testing begins, a tester walks through every section of the admin sidebar to confirm the navigation structure is complete and no links are broken.

> **Note:** Hub pages (Regulatory, Reporting, Operations, Tenant Admin) show navigation cards only — that is expected and marked **[PLACEHOLDER — navigation hub]** below.

---

## Environment setup

| | |
|---|---|
| **Scenario** | S2 — enrolment-induction |
| **Reset command** | `DATABASE_URL=postgres://srs:srs@localhost:5432/srs pnpm --filter @revelation-srs/demo-data demo:reset enrolment-induction` |
| **Reset time** | ~15 seconds |
| **Application** | Admin console — http://localhost:5173 |
| **Login as** | `registry` / `Demo-2026!` |

---

## Steps

Work through each sidebar section in order. Each page should load without a blank screen, spinner that never resolves, or unhandled error.

**Core**
- [ ] **1.** Dashboard — loads with stat cards (showing `—`) and search form **[PLACEHOLDER — stats and search not wired]**
- [ ] **2.** Students — search page loads
- [ ] **3.** Tasks — task inbox loads
- [ ] **4.** Exam Boards — board list loads

**Regulatory**
- [ ] **5.** Regulatory hub — **[PLACEHOLDER — navigation hub]** shows 5 cards
- [ ] **6.** Regulatory → HESA — loads
- [ ] **7.** Regulatory → UCAS — loads
- [ ] **8.** Regulatory → SLC — loads
- [ ] **9.** Regulatory → UKVI — loads
- [ ] **10.** Regulatory → OfS — loads

**Reporting**
- [ ] **11.** Reporting hub — **[PLACEHOLDER — navigation hub]** shows 3 cards
- [ ] **12.** Reporting → Enrolment volumes — loads
- [ ] **13.** Reporting → Regulatory submission status — loads
- [ ] **14.** Reporting → FOI — loads

**Administration (Tenant Admin)**
- [ ] **15.** Tenant Admin hub — **[PLACEHOLDER — navigation hub]** shows 8 cards
- [ ] **16.** Tenant Admin → Tenant Configuration — loads
- [ ] **17.** Tenant Admin → Value Sets — loads
- [ ] **18.** Tenant Admin → Globalisation — loads
- [ ] **19.** Tenant Admin → Academic Rules — loads
- [ ] **20.** Tenant Admin → Workflow Definitions — loads
- [ ] **21.** Tenant Admin → Feature Flags — loads
- [ ] **22.** Tenant Admin → Integrations — loads
- [ ] **23.** Tenant Admin → Audit Log — loads

**Operations**
- [ ] **24.** Operations hub — **[PLACEHOLDER — navigation hub]** shows 2 cards
- [ ] **25.** Operations → Environment Runtime — loads
- [ ] **26.** Operations → Integration Operations — loads

**Other**
- [ ] **27.** The currently active sidebar item should be visually highlighted at all times

---

## Issues found

Open a **UAT Bug Report** and reference story **X-02** with the step number.
BODY
)"

create_issue \
  "X-03: Accessibility statements and error pages" \
  "uat/story,area/admin,area/portal" \
  "$(cat <<'BODY'
> A tester verifies that both applications handle common edge-case navigations gracefully: the accessibility statement page is reachable, unknown paths show a helpful 404, and unauthorised access is blocked.

---

## Environment setup

No specific scenario required.

| | |
|---|---|
| **Application** | Both — admin (http://localhost:5173) and portal (http://localhost:5174) |

---

## Steps

**Portal**
- [ ] **1.** Open http://localhost:5174/accessibility-statement (without logging in if possible, or after logging in)
- [ ] **2.** The page should load and contain a meaningful accessibility commitment statement — not a blank page
- [ ] **3.** Navigate to a non-existent path: http://localhost:5174/this-page-does-not-exist
- [ ] **4.** A 404 or "not found" page should appear with a helpful message and a link back to the dashboard or login
- [ ] **5.** Log out of the portal, then try to navigate directly to http://localhost:5174/dashboard — you should be redirected to the login page or see an appropriate message

**Admin**
- [ ] **6.** Open http://localhost:5173/accessibility-statement
- [ ] **7.** The page should load with an accessibility commitment statement
- [ ] **8.** Navigate to a non-existent admin path: http://localhost:5173/this-page-does-not-exist
- [ ] **9.** A 404 or "not found" page should appear
- [ ] **10.** Log out of the admin app, then try to navigate directly to http://localhost:5173/students — you should be redirected to the login page

---

## Issues found

Open a **UAT Bug Report** and reference story **X-03** with the step number.
BODY
)"

echo ""
echo "==> All done!"
echo "    Milestone: ${MILESTONE}"
echo "    Labels: 17 created"
echo "    Issues: 50 created"
echo ""
echo "    View the milestone: https://github.com/${REPO}/milestone/${MILESTONE_NUM}"
echo "    View all UAT stories: https://github.com/${REPO}/issues?label=uat%2Fstory&milestone=${MILESTONE_NUM}"
