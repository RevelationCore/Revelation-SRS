# Testing and Appraisal Implementation Status

> Status date: 2026-08-14
>
> Authority: Progress record for the [dependency-gated implementation plan](testing-and-appraisal-accessibility-plan.md)

## Exit-gate position

| Phase | Position | Evidence | Remaining gate items |
|---|---|---|---|
| 0 — Baseline | Complete | [Phase 0 baseline](testing-appraisal-implementation-baseline.md) | Named people are assigned in each implementation PR rather than this repository document |
| 1 — Tests/readiness | Implemented; CI execution pending | Root evidence commands, shared readiness (now checking `/ready`, not just process-liveness `/health`), non-skipping golden setup, deterministic mutation, PR CI job and diagnostics | Observe two CI runs against the recorded duration budget |
| 2 — Evaluator/appraisal | Implemented; facilitated acceptance pending | Evaluator lifecycle (including `pnpm evaluate --scenario <slug>` for journeys that need a non-default scenario), `TRY.md`, appraisal pack, UAT grouping/provenance/JSON, required consistency check and live mutation status | Conduct the three facilitated dry runs with independent evaluators |
| 3 — Component layer | Complete | Harness (MSW + axe, both wired and verified, not just documented) works in admin, portal and UI; shared form/dialog/table/status patterns and all five named critical workflows (module registration/approval, student record update, exam-board authority, engagement intervention, regulatory submission) have component coverage — 46 tests across 9 files | None outstanding against the plan's stated exit criteria |
| 4 — Evidence/appraisal maturity | In progress | Journey metadata (validated against real requirement/capability/persona IDs, not invented ones), evidence manifests carrying real capability/persona/requirement metadata, a capability-grouped evidence report, visible Demo/Alpha context, triage cadence and hosted-environment proposal | Link capability claims to *observed* CI reports (the mechanism exists; it needs real CI runs to populate); produce and quality-check the admin recording; pilot three appraisal sessions |

## Remediation pass (2026-08-14, same day)

An independent review of the first implementation pass found and fixed the following before this status was written:

- **Fabricated traceability metadata.** `e2e/journey-metadata.json` cited `REQ-006`/`REQ-130`/`REQ-069`, which don't exist anywhere — the real requirement scheme is domain-prefixed (`SID-*`, `CAT-*`, `GOV-*`, ...). Capability values were also unverifiable — the capability matrix had no ID field at all. Fixed: the matrix now has a stable `ID` column per row, `e2e/journey-metadata.json` cites real IDs, and `select-journeys.mjs validate` now resolves every capability/requirement/persona against the actual source documents rather than only checking the fields are non-empty.
- **Evidence manifests carried no metadata.** `write-evidence-manifest.mjs` always wrote `metadata: {}`, and the evidence report only grouped by evidence class, never by capability, despite the plan requiring both. Fixed: manifests now look up the matching journey's capabilities/personas/requirements, and the report has a by-capability section alongside by-evidence-class.
- **Harness docs described tooling that didn't exist.** `docs/testing/frontend-component-testing.md` claimed MSW and axe-core support; neither was wired in. Fixed: both are now real (`test/msw-server.mjs`, `test/axe.mjs`), used by every component test, not just documented.
- **Phase 3 was 3 tests deep, not 5 workflows.** Only a demo-banner smoke test per app and one combined pattern test existed; none of the five named critical workflows had coverage. Fixed: added `apps/admin/test/render.tsx` / `apps/portal/test/render.tsx` shared render helpers and full coverage for all five workflows (46 component tests total across 9 files).
- **Writing those tests surfaced five real, previously undiscovered product bugs**, all fixed in `packages/ui`/`apps/admin`/`apps/portal` source, not worked around in tests: a Dialog focus-return regression (Radix's default `onCloseAutoFocus` silently drops focus to `<body>` on close when no `DialogTrigger` is used, which is every real usage in this codebase); `Select`/`Input`/`Textarea` not forwarding refs, which silently broke `react-hook-form` value tracking on any field using them; `useFormSubmit` showing the generic RFC 7807 `title` instead of the specific `detail`; and two instances of reading `event.currentTarget` after an `await` in a React handler (a stale-`SyntheticEvent` footgun), which silently discarded successful saves as false "Action failed" errors.
- **Appraisal pack's third journey required an undocumented manual step.** Fixed by adding `--scenario` support to `pnpm evaluate` instead of telling evaluators to run an unspecified "documented demo command."
- **The 42 pre-existing mocked-UI failures were triaged, not just surfaced.** Root causes, in order of how many failures they explained: (1) a route-registration-order bug affecting essentially every test using `mockStudentList`/`mockTaskList` or an inline page-specific mock alongside `mockApiRoutes` — Playwright resolves the *most recently registered* matching route first, so registering the specific fixture before the generic catch-all meant the catch-all always won and the specific data was never actually served, anywhere it was used this way; (2) several mock fixtures shaped to match neither the admin nor portal API contracts (missing `identity` nesting, wrong field names for workflow tasks/integrations/HESA returns/locale-config, a wrong URL for tenant configuration); (3) genuine strict-mode-ambiguous or stale-text Playwright assertions (including one `page.getByDisplayValue` call — a Testing Library method that doesn't exist on Playwright's `Page`); (4) two real, now-fixed accessibility bugs (unlabelled admin filter `<select>` elements; an insufficient-contrast sidebar label). All 149 mocked-UI tests now pass, confirmed stable across repeated full runs.

## Important verification findings

- Unit suites pass, including a new `e2e/uat/findings-reporter.test.ts` (9 tests) covering the fingerprint-grouping and environment-invalidation logic that previously had no test below full-Playwright level.
- Component suites pass: 46 tests across 9 files in all three frontend workspaces (up from 5 tests in 3 files).
- Typecheck and build pass across all workspace projects, including `apps/admin` and `apps/portal` production builds.
- Metadata, capability-consistency and documentation-link checks pass, and journey metadata now resolves against real source documents rather than only checking shape.
- The mocked UI suite (149 tests, 11 files) passes in full and repeatably — not just "no longer hidden," genuinely fixed.
- Repository-wide lint is unchanged from the pre-existing baseline (94 errors, 79 warnings, all in files this plan never touched); every file this plan added or changed is lint-clean.

## Acceptance work requiring people or CI

The following items cannot be honestly self-certified from a local implementation session:

1. required-check configuration in GitHub branch protection;
2. two consecutive CI duration observations;
3. three independent evaluator dry runs and appraisal pilots; and
4. review of the finished staff recording by an accessibility/product reviewer.

They remain exit-gate evidence, not silently completed tasks.
