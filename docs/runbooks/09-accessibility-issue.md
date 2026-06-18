# Runbook 09 — Accessibility Issue Response

---

## Receiving an accessibility complaint

Accessibility complaints may arrive via:
- The feedback form in the portal or admin accessibility statement page
- Email to `accessibility@example.com` (configure in the accessibility statement)
- GitHub issue (for open-source deployments)

---

## Step 1 — Triage

| Severity | Description | Target response |
|---|---|---|
| Critical | A user cannot complete a core journey at all (e.g., cannot log in, cannot view results) | Same business day |
| Major | A core journey is significantly impaired (e.g., keyboard navigation broken on key page) | 3 business days |
| Minor | An individual element has a WCAG failure but workarounds exist | Next sprint |

---

## Step 2 — Reproduce

1. Follow the steps reported by the user.
2. Test with:
   - Keyboard-only navigation (Tab, Enter, Escape, arrow keys)
   - NVDA + Firefox on Windows (primary screen reader target)
   - VoiceOver + Safari on macOS (secondary)
   - axe DevTools browser extension for automated checks
3. Note the specific WCAG 2.1 AA criterion that is violated (e.g., 1.4.3 Contrast, 4.1.2 Name Role Value).

---

## Step 3 — Fix or accept

For a code fix:
1. Create a branch from `main`.
2. Fix the specific component or pattern.
3. Run `pnpm test:e2e:playwright` to verify axe scans remain clean.
4. Update `docs/release/phase-11/accessibility-audit.md` with the fix record.

For a formal exception (R-A11Y-001 pattern):
1. Write a description of the issue and why it cannot be fixed immediately.
2. Include: severity, mitigation, workaround for affected users, planned remediation date.
3. Record in `docs/release/phase-11/release-checklist.md` under "Accepted exceptions".
4. Update the accessibility statement for the affected app.

---

## Step 4 — Respond to the reporter

Acknowledge within 2 business days. Provide:
- What was found
- Whether it has been fixed or accepted as exception
- If exception: the workaround available to the user
- The planned remediation date if applicable

---

## Accessibility statement update

Both apps have an accessibility statement at `/accessibility`. Update via:

- `apps/portal/src/pages/AccessibilityStatementPage.tsx`
- `apps/admin/src/pages/AccessibilityStatementPage.tsx`

The statements must include any new known exceptions and the last review date.
