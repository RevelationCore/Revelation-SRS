# S2 — Enrolment and Induction

**Slug:** `enrolment-induction` · **Reference date:** 2026-07-31 · **Students:** 1,000

```bash
pnpm demo:reset enrolment-induction
```

---

## What this scenario contains

Students are enrolled, intermitting, withdrawn, or graduated. Fee liabilities are recorded. The academic calendar is set. No assessment marks or module registrations exist yet. The integration registry is populated and the platform configuration (feature flags, value sets, workflow definitions, academic rules) is fully seeded.

This is the best scenario for exploring the platform configuration area and the student record at the point of initial enrolment.

---

## Stories

### P-01 — First login and dashboard navigation

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174

> Alice has just started her course and is logging in to the student portal for the first time to see what information is available to her.

**Steps:**

1. Navigate to the student portal at http://localhost:5174. You are redirected to the Keycloak login page.
2. Log in with username `alice.demo` and password `Demo-2026!`.
3. After login you arrive at the **Dashboard**. Confirm the amber demo banner is visible at the top of the page.
4. Read the welcome message — it should show Alice's preferred name.
5. Review the **Quick links** section. You should see links for Enrolments, Modules, Results, Timetable, and Notifications.
6. Review the **Current enrolment** section. It should display Alice's active programme, year of study, and enrolment status.
7. Use the top navigation bar to move between sections. Confirm all links respond without error.

---

### P-02 — View and edit profile details

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/profile

> Alice wants to check that her personal details are correct and update her preferred name.

**Steps:**

1. Log in as `alice.demo` at http://localhost:5174.
2. Navigate to **Profile** using the top navigation bar. You should see Alice's legal name, student number, date of birth, and contact details.
3. Note the **Personal email** field. It should be pre-populated from the demo data.
4. Select **Edit profile**. You are taken to the profile edit form at `/profile/edit`.
5. Clear the **Preferred name** field and enter a new value (for example, `Ali`).
6. Submit the form. Confirm a success message is shown.
7. Navigate back to **Profile**. The preferred name should reflect your change.

---

### P-03 — Add a term-time address

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/profile

> Alice needs to register her term-time address so the university has her current contact details.

**Steps:**

1. Log in as `alice.demo` and navigate to **Profile**.
2. Review the **Addresses** section. It may already contain a home address from the demo data.
3. Select **Add address**. You are taken to the address form at `/profile/addresses/new`.
4. Select the address type **Term-time** from the dropdown.
5. Complete the address fields: address line 1, city, postcode, and country.
6. Submit the form. Confirm a success message is shown.
7. Navigate back to **Profile** and confirm the new term-time address appears in the Addresses section.

---

### P-04 — View current enrolment status

**Persona:** `alice.demo` · **Role:** Enrolled student · **App:** Student portal · **URL:** http://localhost:5174/enrolments

> Alice wants to confirm her enrolment status and check the details of her current registration on her programme.

**Steps:**

1. Log in as `alice.demo` and navigate to **Enrolments** in the top navigation bar, or go directly to http://localhost:5174/enrolments.
2. You should see a list of Alice's enrolments. In scenario S2 there should be at least one active enrolment.
3. Review the enrolment card: programme title, academic year, year of study, enrolment status, and fee status should all be populated.
4. Confirm the enrolment status badge shows **enrolled** (or the equivalent active status from the value set).
5. Note the programme and academic year match the welcome message on the Dashboard.

---

### OP-01 — Manage feature flags

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/flags

> The platform operator needs to review the current feature flags and toggle a flag to enable a feature for testing.

**Steps:**

1. Log in to the admin console at http://localhost:5173 with username `ops` and password `Demo-2026!`.
2. In the left sidebar, expand **Tenant Admin** and select **Feature Flags**, or navigate directly to `/tenant-admin/flags`.
3. You should see a table of feature flags, each with a name, description, and current enabled/disabled state.
4. Review the list. Note the flags that are currently enabled (shown with a green indicator) and those that are disabled.
5. Find a disabled flag (for example, one related to a workflow variant or module). Toggle it on using the switch in its row.
6. Confirm the change is saved — the flag should now show as enabled without a page reload.
7. Toggle the same flag back off to restore the original state.

---

### OP-02 — Manage value sets

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/value-sets

> The operator needs to review the controlled vocabulary for student statuses and check whether a new status value is needed.

**Steps:**

1. In the admin console sidebar, navigate to **Tenant Admin → Value Sets**, or go to `/tenant-admin/value-sets`.
2. You are shown a list of all value-set domains (for example, `person`, `module`, `exam_board`).
3. Select the **person** domain from the list. A second panel shows the value sets within that domain.
4. Select **person_status_code**. The members table appears on the right, showing all valid student status codes with their display labels, active-from and active-to dates.
5. Review the members. Confirm that standard statuses such as `enrolled`, `withdrawn`, and `intermitting` are present.
6. Select **Add member** and enter a new status code (for example, `test-status`) with a display label. Set the active-from date to today.
7. Save the new member. Confirm it appears in the table.
8. Delete or retire the test member you just added (set its active-to date to today) to clean up.

---

### OP-03 — Browse workflow definitions

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/workflows

> The operator needs to understand which workflow definitions are configured and confirm that the reasonable adjustments workflow is active.

**Steps:**

1. Navigate to **Tenant Admin → Workflow Definitions** (`/tenant-admin/workflows`).
2. You should see a table of workflow definitions, each with a type code, version, and enabled status.
3. Locate the **reasonable-adjustments** workflow definition in the list (or any wellbeing-related workflow).
4. Confirm it is enabled and note its current version.
5. Review other workflow types — you should see definitions for EC claims, admissions, and progression processes.

---

### OP-04 — Review academic rules configuration

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/rules

> The operator needs to verify the academic rules are correctly configured for the current academic year.

**Steps:**

1. Navigate to **Tenant Admin → Academic Rules** (`/tenant-admin/rules`).
2. The page lists all academic rules, each with a rule type, applicable academic year, and value.
3. Review the rules table. Confirm rules are present for credit thresholds, pass mark requirements, and maximum module loads.
4. Note the bitemporal timestamps — each rule shows an active-from and active-to date, indicating when it applies.

---

### OP-05 — View tenant configuration

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/config

> The operator needs to check the tenant's display name and contact details are correct before the student portal goes live.

**Steps:**

1. Navigate to **Tenant Admin → Configuration** (`/tenant-admin/config`).
2. Review the tenant configuration details: institution name, short name, and contact email.
3. The configuration should reflect the demo institution (Revelation University or similar).

---

### OP-06 — Globalisation and locale settings

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/globalisation

> The operator needs to confirm the locale configuration is set correctly for a UK HE institution.

**Steps:**

1. Navigate to **Tenant Admin → Globalisation** (`/tenant-admin/globalisation`).
2. The page shows locale configuration: default locale, date format, and currency.
3. Confirm the default locale is `en-GB` and the date format is `DD/MM/YYYY`.

---

### OP-07 — Browse the integration registry

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/tenant-admin/integrations

> The operator needs to confirm all external system integrations are registered and enabled.

**Steps:**

1. Navigate to **Tenant Admin → Integrations** (`/tenant-admin/integrations`).
2. The page shows a table of registered integration endpoints.
3. Review each registration. Confirm the display name, transport type, and endpoint URL are populated.
4. Check the **Enabled** column — all active integrations should be enabled.
5. Scroll down to the **Contracts** section and review the list of published integration contracts.
6. Select **Check health** for one registration to trigger a live health check. The status should update to `ok`.

---

### OP-08 — View environment runtime information

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/operations/environment

> The operator needs to check the running software versions and environment information to confirm this is a demo environment.

**Steps:**

1. In the sidebar, navigate to **Operations** and then select **Environment**, or go to `/operations/environment`.
2. The page displays the API version, Node.js version, environment code, and connected service statuses.
3. Confirm the **SRS_ENVIRONMENT_CODE** shows `demo`.
4. Review the connected services panel — PostgreSQL, NATS, and Temporal should all show as connected.

---

### OP-09 — Review integration operations

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173/operations/integrations

> The operator needs to see the live operational status of all registered integration connectors and review recent exchange records.

**Steps:**

1. Navigate to **Operations → Integration Operations** (`/operations/integrations`).
2. The page shows a health summary panel for all registered connectors.
3. Review the health status of each connector. Green indicators mean the last health check passed.
4. Use the **Check all** button to trigger a fresh health check on all connectors simultaneously.
5. Review the exchange log at the bottom of the page. Filter by status `delivered` to see successfully processed exchanges.
6. Change the filter to `failed` — in the demo environment this should be empty.

---

### X-02 — Admin sidebar navigation

**Persona:** `registry` · **Role:** Registry Administrator · **App:** Admin console · **URL:** http://localhost:5173/dashboard

> A registry administrator needs to confirm all sidebar sections are reachable and load without error.

**Steps:**

1. Log in to the admin console as `registry`.
2. Starting from the **Dashboard**, work through each sidebar section in order: Students, Exam Boards, Tasks, Regulatory, Reporting, Operations, Tenant Admin.
3. Open each top-level section. Hub pages (Regulatory, Reporting, Operations, Tenant Admin) show navigation cards — **[PLACEHOLDER]** — select one sub-page from each hub to confirm it loads.
4. Confirm no page shows an error message or blank content (empty lists are expected, 404 and 500 errors are not).
5. Return to the Dashboard. Confirm the sidebar collapses correctly on narrow viewports.
