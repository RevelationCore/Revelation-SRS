# UAT Round 1 — Remaining Story Automation

This note describes a practical way to automate the untested half of UAT Round 1
while still preserving the story-based evidence trail expected by
[`docs/uat-approach.md`](../uat-approach.md).

The goal is not to replace human UAT judgement. The goal is to use automation to
find the repeatable blockers first: failed scenario resets, login failures, 403s,
500s, missing seeded data, broken navigation, obvious form submission failures,
accessibility regressions, and browser console errors.

## Recommended Approach

Add an "assisted UAT" Playwright suite backed by a story manifest.

Each manifest row should contain:

| Field | Purpose |
|---|---|
| `storyId` | UAT story id, for example `WB-01` |
| `title` | Story title from the GitHub UAT issue |
| `scenario` | Demo scenario slug to reset before the story block |
| `app` | `admin` or `portal` |
| `persona` | Demo username, for example `wellbeing` or `dpo` |
| `startUrl` | First page to visit |
| `checks` | Story-specific route, heading, table, card, form, or button checks |
| `knownPlaceholders` | Steps that should be recorded but not treated as bugs |

The runner should group stories by scenario so resets are not repeated more than
necessary:

1. Reset `enrolment-induction`, run all remaining S2 stories.
2. Reset `module-selection`, run all remaining S3 stories.
3. Reset `assessment-marks`, run all remaining S4 stories.
4. Reset `exam-board`, run all remaining S5 stories.
5. Reset `institution-year`, run all remaining S6 stories.

For each story, Playwright should:

1. Log in as the specified demo persona.
2. Navigate through the story's critical pages.
3. Fail on unexpected `403`, `404`, `5xx`, uncaught page errors, and severe console
   errors.
4. Assert that the expected heading or landmark appears.
5. Assert that key data-bearing views are not empty where the scenario promises data.
6. Run an axe scan on the final page, or on each page for cross-cutting stories.
7. Save screenshot, trace, and network evidence for any failure.

## What To Automate First

Start with the remaining stories called out in
[`proactive-fix-plan.md`](./proactive-fix-plan.md), because they have the highest
chance of finding systemic issues.

| Block | Stories | Scenario | Persona | High-value automated checks |
|---|---|---|---|---|
| Wellbeing | `WB-01` to `WB-03` | S4 | `wellbeing` | No 403s; lists load; referral/disability/EC detail pages show seeded records |
| Exam boards | `EB-01` to `EB-04` | S5 | `chair` | Board list non-empty; agenda/data pack/candidate/award pages render |
| Task inbox | `TI-01` | S4 | `registry` | Inbox has seeded tasks; completing a task gives success or expected state change |
| Regulatory | `RE-06`, `RE-07` | S6/S4 | `dpo` | UKVI and FOI/SAR pages load with data; DPO has required permissions |
| Reporting | `RP-01`, `RP-02` | S6 | `registry`/`ops` | Enrolment report loads and has non-zero totals |
| Operations | `OP-01` to `OP-09` | S2 | `ops` | Every operations/configuration page loads without 403 and displays expected controls |
| Audit | `AU-01` | S4 | `dpo` | Audit log loads and shows at least one entry |
| Cross-cutting | `X-01` to `X-03` | varies | any | Demo banner, navigation, accessibility and error-page checks |

## Recording Problems Found

Use a two-step process so automation does not spam GitHub with duplicate or noisy
bugs.

1. Generate a local findings file, for example
   `docs/uat1/reports/automated-uat-findings-YYYY-MM-DD.md`.
2. Review the findings, combine duplicates, then create GitHub issues using the
   existing UAT bug template fields.

Each automated finding should include:

| Field | Example |
|---|---|
| Story | `RE-06 - Review UKVI compliance and CAS records` |
| Step | `Automated pre-flight: open /regulatory/ukvi` |
| Scenario | `S6 - institution-year` |
| Persona | `dpo` |
| Severity | `High` for a 403/500 on a core story page, `Medium` for empty promised data, `Low` for copy/layout/accessibility issues |
| Expected | Page loads with seeded UKVI records |
| Actual | API returned 403 for `/api/v1/regulatory/ukvi/...` |
| Evidence | Playwright trace, screenshot path, console output, failing request URL/status |

Suggested local report shape:

```markdown
## RE-06 - Review UKVI compliance and CAS records

- Scenario: S6 - institution-year
- Persona: dpo
- URL: http://localhost:5173/regulatory/ukvi
- Severity: High
- Expected: UKVI dashboard loads with seeded visa/CAS records.
- Actual: Page showed permission error. GET /api/v1/regulatory/ukvi/status returned 403.
- Evidence:
  - playwright-report/data/trace-re-06.zip
  - test-results/re-06-ukvi/screenshot.png
```

After review, create the GitHub issue with:

```bash
gh issue create \
  --label uat/bug \
  --title "UAT RE-06: DPO cannot open UKVI compliance page" \
  --body-file docs/uat1/reports/re-06-ukvi.md
```

## Implementation Sketch

Reuse the existing Playwright setup rather than adding a second browser stack.

Suggested files:

| File | Role |
|---|---|
| `e2e/uat/remaining-stories.manifest.ts` | Story metadata and assertions |
| `e2e/uat/remaining-stories.spec.ts` | Playwright runner |
| `e2e/uat/personas.ts` | Demo credentials and app URLs |
| `e2e/uat/findings-reporter.ts` | Converts Playwright failures into markdown findings |
| `docs/uat1/reports/` | Generated evidence summaries, ignored unless intentionally committed |

Useful Playwright settings for this suite:

```typescript
use: {
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
  video: 'retain-on-failure',
}
```

The existing mocked suites should stay in place. They are good fast checks for
rendering and accessibility. The assisted UAT suite should run against the live API,
live demo database, and demo accounts.

## Minimum Viable Pass

The first useful version can be deliberately simple:

1. Add the manifest for the remaining untested story blocks.
2. Implement route, heading, response-status, console-error, and axe checks.
3. Generate one markdown findings file per run.
4. Manually review the findings and raise GitHub issues for real bugs.

That will quickly answer "can the remaining story pages be opened by the right
persona against the right seeded scenario?" and will catch the same classes of
problem already seen in UAT Round 1.

