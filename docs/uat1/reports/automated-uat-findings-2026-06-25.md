# Automated UAT Findings — 2026-06-25

**11 issue(s) found** across 10 stories.

---

## OP-09 — View integration operations

- **Scenario:** enrolment-induction
- **Persona:** ops
- **URL:** http://localhost:5173/operations/integrations
- **Severity:** Medium
- **Expected:** No console errors
- **Actual:** The above error occurred in the <ConnectorHealthTab> component:

    at ConnectorHealthTab (http://localhost:5173/src/pages/IntegrationOpsPage.tsx?t=1782384191494:82:29)
    at div
    at IntegrationOpsPage (http://localhost:5173/src/pages/IntegrationOpsPage.tsx?t=1782384191494:30:25)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:4122:5)
    at Routes (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:4592:5)
    at main
    at div
    at div
    at Layout (http://localhost:5173/src/components/Layout.tsx?t=1782384191494:313:26)
    at RequireAuth (http://localhost:5173/src/App.tsx?t=1782387103076:57:24)
    at RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:4122:5)
    at Routes (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:4592:5)
    at App
    at AuthProvider (http://localhost:5173/src/auth/AuthContext.tsx?t=1782384191494:53:32)
    at Router (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:4535:15)
    at BrowserRouter (http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=897933a9:5273:5)

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.

---

## X-01 — Demo banner is visible

- **Scenario:** enrolment-induction
- **Persona:** ops
- **URL:** http://localhost:5173/dashboard
- **Severity:** Medium
- **Expected:** Check: text (Demo)
- **Actual:** Expected text matching /Demo/i but it was not found

---

## X-02 — Navigation sidebar renders all expected links

- **Scenario:** enrolment-induction
- **Persona:** registry
- **URL:** http://localhost:5173/dashboard
- **Severity:** Medium
- **Expected:** Check: text (Students)
- **Actual:** Expected text matching /Students/i but it was not found

---

## RE-07 — View FOI/SAR request register

- **Scenario:** assessment-marks
- **Persona:** dpo
- **URL:** http://localhost:5173/reporting/foi
- **Severity:** Medium
- **Expected:** Check: heading (FOI)
- **Actual:** Expected heading matching /FOI/i but it was not found

---

## RE-07 — View FOI/SAR request register

- **Scenario:** assessment-marks
- **Persona:** dpo
- **URL:** http://localhost:5173/reporting/foi
- **Severity:** Medium
- **Expected:** Check: table-rows
- **Actual:** Expected at least 1 table row(s) but found 0

---

## AU-01 — View audit log

- **Scenario:** assessment-marks
- **Persona:** dpo
- **URL:** http://localhost:5173/tenant-admin/audit
- **Severity:** Medium
- **Expected:** Check: table-rows
- **Actual:** Expected at least 1 table row(s) but found 0

---

## RP-01 — View enrolment report

- **Scenario:** institution-year
- **Persona:** registry
- **URL:** http://localhost:5173/reporting/enrolments
- **Severity:** Medium
- **Expected:** Check: heading (Enrolment)
- **Actual:** Expected heading matching /Enrolment/i but it was not found

---

## AR-01 — Search for a student by name

- **Scenario:** assessment-marks
- **Persona:** registry
- **URL:** http://localhost:5173/students
- **Severity:** Low
- **Expected:** Check: axe
- **Actual:** 2 axe violation(s): empty-table-header, select-name

---

## AR-05 — View task inbox

- **Scenario:** assessment-marks
- **Persona:** registry
- **URL:** http://localhost:5173/tasks
- **Severity:** Low
- **Expected:** Check: axe
- **Actual:** 1 axe violation(s): select-name

---

## WB-01 — View student disability declarations

- **Scenario:** assessment-marks
- **Persona:** wellbeing
- **URL:** http://localhost:5173/students
- **Severity:** Low
- **Expected:** Check: axe
- **Actual:** 2 axe violation(s): empty-table-header, select-name

---

## EB-01 — View exam board list

- **Scenario:** exam-board
- **Persona:** chair
- **URL:** http://localhost:5173/exam-boards
- **Severity:** Low
- **Expected:** Check: axe
- **Actual:** 1 axe violation(s): empty-table-header

---
