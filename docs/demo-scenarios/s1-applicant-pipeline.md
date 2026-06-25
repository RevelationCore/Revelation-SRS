# S1 — Applicant Pipeline

**Slug:** `applicant-pipeline` · **Reference date:** pre-enrolment · **Applicants:** ~600

```bash
pnpm demo:reset applicant-pipeline
```

---

## What this scenario contains

A snapshot of the admissions pipeline before enrolment opens. It contains approximately 600 applicants across four entry routes — UCAS, direct, international, and clearing — each at different stages of the admissions process. Programme offers, conditions, and application statuses are set. No students are yet enrolled; no marks, registrations, or boards exist.

This scenario is intended to demonstrate the state of the registry and integration layer at peak admissions time.

---

## Note on dedicated admissions UI

A dedicated admissions management UI (applicant search, offer management, UCAS pipeline view) is on the roadmap but is not included in v1.0.0. The applicant data in this scenario is fully present in the database and accessible via the API (`GET /api/v1/students?status=applicant`), but the admin console does not yet expose an applicant-specific workflow screen.

The most relevant walkthrough for this scenario at v1.0.0 is the **integration and operations view**, which shows the UCAS and SLC exchange log — the external feeds that populate the applicant data.

---

## Stories

### S1-OP-01 — Review the UCAS integration exchange log

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173

> The operator needs to verify that UCAS application data has been received and processed correctly before the registry begins reviewing offers.

**Steps:**

1. Log in to the admin console at http://localhost:5173 with username `ops` and password `Demo-2026!`.
2. In the left sidebar, select **Operations** to open the operations hub. This is a **[PLACEHOLDER]** navigation page — select **Integration Operations** from the cards.
3. You are now on the Integration Operations page (`/operations/integrations`). The page lists all registered integration connectors and their current health status.
4. Locate the **UCAS** connector in the list. Check its health status indicator — it should show `ok` with a recent health check timestamp.
5. Use the **VLE reconcile** or exchange log section to review recent exchange records. You should see inbound `applicant-data-received` exchanges from the UCAS contract.
6. Check the **Status** column — all exchanges should show `delivered`. Any showing `failed` or `pending` would require investigation.
7. Note the **Last successful exchange** timestamp on the UCAS connector card to confirm data is current.

---

### S1-OP-02 — Review the integration registry for admissions contracts

**Persona:** `ops` · **Role:** Platform Operator · **App:** Admin console · **URL:** http://localhost:5173

> The operator wants to confirm that all admissions-related integration contracts are registered and enabled before the registry begins working with applicant data.

**Steps:**

1. From the admin console sidebar, navigate to **Tenant Admin**, then select **Integrations**.
2. You are now on the Integration Registry page (`/tenant-admin/integrations`). This page lists all registered integration endpoints.
3. Review the table of integrations. Look for registrations whose display name includes **UCAS** or **SLC**.
4. Check the **Enabled** column for each admissions-related registration — all should show as enabled.
5. For any registration, select the **Check health** button to trigger a live health probe. The status should update to `ok`.
6. Review the **Contracts** section at the bottom of the page, which lists all published integration contracts. Confirm that contracts for `ucas-application-inbound` and `slc-notification-outbound` are present and not deprecated.
