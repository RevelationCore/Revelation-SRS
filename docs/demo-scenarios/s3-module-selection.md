# S3 — Module Selection Peak

**Slug:** `module-selection` · **Reference date:** 2026-07-31 · **Students:** 1,000

```bash
pnpm demo:reset module-selection
```

---

## What this scenario contains

Module registrations are in place with a mix of statuses: registered, waitlisted, withdrawn, and draft. Exam boards have been formed and exam entries have been created for registered students. The system is at the point in the year where module selection is open but marks have not yet been submitted.

This scenario demonstrates the module registration workflow from both the student's perspective in the portal and the registry's view in the admin console.

---

## Stories

### P-05 — Browse module registrations

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/modules

> Alice wants to review the modules she is currently registered on and check the status of each registration.

**Steps:**

1. Log in to the student portal at http://localhost:5174 as `alice.demo`.
2. Navigate to **Modules** in the top navigation bar, or go directly to `/modules`.
3. You should see a list of Alice's current module registrations. Each row shows the module code, title, credit value, and registration status.
4. Confirm at least one module shows a status of **registered**.
5. Check whether any modules show **waitlisted** or **draft** status — these may appear depending on the demo data seeded for Alice.
6. Review the credit total shown at the bottom of the list. It should reflect the sum of registered modules.

---

### P-06 — Withdraw from a module

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/modules

> Alice has decided to drop one of her optional modules and needs to withdraw her registration before the deadline.

**Steps:**

1. Log in as `alice.demo` and navigate to **Modules** (`/modules`).
2. Identify an optional module in the list that has a **Withdraw** action available. Optional modules can be withdrawn; core modules may not show this option.
3. Select **Withdraw** on the optional module. A confirmation prompt appears asking you to confirm the withdrawal.
4. Confirm the withdrawal. The module's status should update to **withdrawn** in the list.
5. Confirm the credit total has decreased to reflect the withdrawn module.

---

### P-07 — Add an optional module

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/modules

> Alice wants to add an optional module to her registration to bring her credit load back up to the required level.

**Steps:**

1. Log in as `alice.demo` and navigate to **Modules** (`/modules`).
2. Select **Add module** (or the equivalent button). You are taken to the module selection page at `/modules/add`.
3. Browse the available modules. You should see a list of modules available to Alice's programme and year.
4. Select a module that is not already in Alice's list. Review its details: credits, description, and any prerequisites.
5. Select **Register**. Confirm a success message is shown.
6. Navigate back to **Modules**. The new module should appear in the list with a status of **registered** or **draft** (subject to capacity and prerequisites).

---

### P-08 — View the exam timetable

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/timetable

> Alice wants to check when her exams are scheduled so she can plan her revision.

**Steps:**

1. Log in as `alice.demo` and navigate to **Timetable** in the top navigation bar, or go to `/timetable`.
2. You should see Alice's exam timetable entries. Each entry shows the module, paper title, date, time, and location.
3. Confirm the entries correspond to modules where Alice is registered.
4. Review the location field — exam room codes are populated from the demo data.
5. Navigate also to **Exams** (`/exams`) — this page provides a summary of Alice's exam entries grouped by sitting.

---

### AR-03 — Review module registrations from the student record

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/students

> A registry administrator needs to review a student's module registrations to answer a query about their credit load.

**Steps:**

1. Log in to the admin console at http://localhost:5173 as `registry`.
2. Navigate to **Students** (`/students`). The students list shows all enrolled students.
3. Use the search box to search for **Alice** (or the full name from the demo data). The list filters as you type.
4. Select Alice's record from the results to open the **Student Detail** page.
5. Select the **Registrations** tab at the top of the student detail page.
6. Review the module registrations table. Each row shows the module code, title, credit value, academic period, and registration status.
7. Confirm the registrations match what Alice sees in the student portal.
8. Note the **Timetable** section within the enrolment tab — exam entries are also visible here, giving the registry a full picture of the student's current load.
