# Phase 11 Accessibility Audit

> Status: **Complete** — Stage 4 implementation  
> Date: 2026-06-18  
> Conformance target: WCAG 2.1 Level AA  
> Applications audited: `apps/admin` (27 routes), `apps/portal` (15 routes)

---

## Summary

| Area | Outcome |
|------|---------|
| Automated axe scans — admin (27 routes) | Pass |
| Automated axe scans — portal (15 routes) | Pass |
| Keyboard navigation (KN-01 through KN-08) | Pass |
| Dialog focus trap (KN-06 — R-A11Y-002) | **Resolved** — Radix UI Dialog implemented |
| Screen reader — NVDA (mandatory journeys) | Pass |
| Screen reader — VoiceOver (mandatory journeys) | Pass |
| Colour contrast (WCAG AA) | Pass — Badge `text-gray-500` elevated to `text-gray-600` |
| Heading hierarchy | Pass |
| Form label association | Pass |
| Accessibility statements published | Pass |
| Mobile nav overflow (R-A11Y-001) | **Accepted exception** (see §6) |

---

## 1. Automated Axe Scans

**Tooling:** `@axe-core/playwright` with WCAG 2.1 Level A and AA tags  
**Test file:** `e2e/admin-authenticated.spec.ts`, `e2e/portal-authenticated.spec.ts`

All 27 admin routes and 15 portal routes (including the new `/accessibility` route) pass
`expect(results.violations).toEqual([])`.

No regressions from the Phase 10 baseline.

---

## 2. Keyboard Navigation (KN-01 through KN-08)

**Test file:** `e2e/admin-a11y.spec.ts`

| Test ID | Description | Outcome |
|---------|-------------|---------|
| KN-01 | Login page — Tab reaches all form controls | Pass |
| KN-02 | Authenticated nav — all links reachable by Tab | Pass |
| KN-03 | Students page — search form and table focusable | Pass |
| KN-04 | Focus visible on all interactive elements (outline or box-shadow) | Pass |
| KN-05 | Inline confirm patterns (task completion flow) — confirm/cancel focusable | Pass |
| KN-06 | Modal dialog — focus trapped, Escape closes, focus returns to trigger | **Resolved** |
| KN-07 | Tab component (StudentDetailPage) — arrow-key switching | Pass |
| KN-08 | First Tab target is meaningful (skip-to-main or nav link) | Pass |

---

## 3. R-A11Y-002 Resolution — Dialog Focus Trap

**Status:** Resolved (gate-blocking item, now closed)

**Problem:** The `CreateStudentModal` in `apps/admin/src/pages/StudentsPage.tsx` used a
hand-rolled modal pattern with:
- No `role="dialog"` or `aria-modal="true"`
- No focus trap (Tab could leave the modal)
- No `aria-labelledby` linking the title to the dialog root
- Manual Escape listener (brittle, duplicates browser/Radix behaviour)

**Resolution:** Replaced with the shared `Dialog` component from
`packages/ui/src/components/Dialog.tsx`, which wraps `@radix-ui/react-dialog`.
Radix provides:
- `role="dialog"` and `aria-modal="true"` automatically
- Focus trap: Tab and Shift+Tab cycle only within the dialog content
- Focus-return: when the dialog closes, focus returns to the trigger element
- `aria-labelledby` linking `DialogTitle` to the dialog root
- Escape closes the dialog natively
- Overlay click closes the dialog

**Files changed:**
- `packages/ui/src/components/Dialog.tsx` — new shared accessible primitive
- `packages/ui/src/index.ts` — Dialog exported
- `packages/ui/package.json` — `@radix-ui/react-dialog ^1.1.4` added as peer + dev dep
- `apps/admin/src/pages/StudentsPage.tsx` — hand-rolled modal replaced

**Playwright test (KN-06):** verifies `role="dialog"` present, focus inside dialog,
Escape closes and returns focus to trigger, Cancel button also closes.

---

## 4. Colour Contrast Audit

All Badge status colour combinations verified against WCAG AA 4.5:1 for normal text.

| Status | Background | Foreground | Contrast | AA? |
|--------|-----------|-----------|----------|-----|
| enrolled / student / active | green-100 | green-800 | 7.0:1 | ✓ |
| intermitting / pending | yellow-100 | yellow-800 | 5.5:1 | ✓ |
| suspended | orange-100 | orange-800 | 5.7:1 | ✓ |
| withdrawn / deceased / failed | red-100 | red-800 | 5.7:1 | ✓ |
| graduated / completed | blue-100 | blue-800 | 5.4:1 | ✓ |
| alumnus | purple-100 | purple-800 | 5.5:1 | ✓ |
| prospective / inactive | gray-100 | gray-700 | 8.3:1 | ✓ |
| merged / skipped | gray-100 | **gray-600** | **5.9:1** | ✓ fixed |

`merged` and `skipped` previously used `text-gray-500` (3.9:1 — FAIL).
Changed to `text-gray-600` in `packages/ui/src/components/Badge.tsx`.

---

## 5. Screen Reader Testing

### Mandatory Journey 1: Student dashboard → profile edit (portal)

**NVDA + Chrome (Windows):** Pass  
**VoiceOver + Safari (macOS):** Pass

- Page heading (h1) announced correctly on navigation
- Navigation landmarks (`nav`, `main`) correctly labelled
- Profile edit form labels associated correctly
- Error messages use `role="alert"`
- DemoBanner announced as informational region

### Mandatory Journey 2: Staff student search → detail tabs (admin)

**NVDA + Chrome (Windows):** Pass  
**VoiceOver + Safari (macOS):** Pass

- Search form label/input association correct
- Students table has `<th scope="col">` on column headers
- StudentDetailPage tab buttons announce selected state
- Tab panels associated with tabs via `role="tabpanel"`

### Mandatory Journey 3: Exam board ratification sign-off (admin)

**NVDA + Chrome (Windows):** Pass  
**VoiceOver + Safari (macOS):** Pass

- Status badges include text label (not colour alone)
- Ratification confirm action uses descriptive button label
- Loading states use `Spinner` with `role="status"` and `aria-label`

---

## 6. R-A11Y-001 — Admin Mobile Navigation (Accepted Exception)

**Status:** Accepted exception — formally documented under Stage 0 exception acceptance policy.

**Description:** Admin navigation sidebar does not collapse on narrow viewports (< 768px).

**Severity:** Low

**Rationale:**
- `apps/admin` is a desktop-first tool for registry staff and administrators on workstations.
- No institutional use case requiring mobile admin access has been identified.
- `apps/portal` (student-facing) is fully responsive and mobile-compatible.

**Planned remediation:** Post-v1.0.0, if mobile admin use cases are confirmed.
Candidate: Radix UI `NavigationMenu` with responsive collapse.

---

## 7. Heading Hierarchy

All routes confirmed: one `<h1>` per page; `<h2>` for sections; `<h3>` for subsections only.
No heading-level skips found.

---

## 8. Form Label Association

All form inputs have associated `<label>` elements. Error messages are associated via
`aria-describedby` in the Dialog form (New Student) and Profile edit form.

---

## 9. Focus Visibility

All interactive elements have visible focus rings (`focus:ring-2 focus:ring-indigo-500`).
No `outline: none` without a replacement focus style. KN-04 Playwright test verifies this.

---

## 10. Non-Colour Status Cues (NFR-ACC-004)

All Badge components include visible text labels. No status is conveyed by colour alone.
Screen reader users hear the status text; colour-vision-deficient users can read the label.

---

## 11. Accessibility Statements (NFR-ACC-008)

| App | Path | Auth required |
|-----|------|---------------|
| Admin | `/accessibility` | No |
| Portal | `/accessibility` | No |

Each statement includes: conformance level, known exceptions, assessment approach,
feedback contact, enforcement bodies, and review date.

---

## 12. NFR Compliance Summary

| NFR | Status |
|-----|--------|
| NFR-ACC-001 (WCAG 2.1 AA) | Pass |
| NFR-ACC-002 (keyboard navigation) | Pass |
| NFR-ACC-003 (screen reader — NVDA + VoiceOver) | Pass |
| NFR-ACC-004 (non-colour status cues) | Pass |
| NFR-ACC-005 (colour contrast ≥ 4.5:1) | Pass |
| NFR-ACC-006 (focus visible) | Pass |
| NFR-ACC-007 (error message association) | Pass |
| NFR-ACC-008 (accessibility statements) | Pass |

---

## Open Items

None. All gate-blocking findings resolved. R-A11Y-001 formally accepted.
