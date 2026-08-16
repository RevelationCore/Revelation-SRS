# Testing and Appraisal Accessibility — Remediation Plan

> Status: Proposed remediation plan
>
> Created: 2026-08-14
>
> Authority: Findings from an independent review of the uncommitted implementation attempt against the [testing and appraisal accessibility plan](testing-and-appraisal-accessibility-plan.md) and its own [implementation status record](testing-appraisal-implementation-status.md)
>
> Scope: Gaps and inconsistencies found in the Phase 1–4 implementation attempt, sequenced for remediation

## How this review was conducted

Every claim below was checked against the working tree, not inferred from the implementation's own status document. Typecheck, lint and `pnpm test:component` were run directly. The mocked-UI suite (42 of 149 tests failing) was re-run against unmodified `main` via `git stash` to establish whether the failures were introduced by this work or pre-existing; they reproduce identically on `main`, so they are correctly *surfaced*, not caused, by this implementation attempt. Requirement and capability identifiers cited in `e2e/journey-metadata.json` were checked against `docs/requirements/functional-requirements.md` and `docs/product/current-capabilities.md` directly.

## What is solid and should not be touched

- The test taxonomy commands (`test:quick`, `test:unit`, `test:component`, `test:service`, `test:journey`, `test:all`) are implemented cleanly via `scripts/run-test-class.mjs` and match the plan's target vocabulary exactly.
- The real-journey CI job (`golden-e2e`) had its `if: github.ref == 'refs/heads/main'` gate removed — it now runs on every pull request, matching the plan's non-skippable requirement. Confirmed by reading `.github/workflows/ci.yml` directly.
- The evaluator lifecycle (`scripts/evaluate.mjs`) correctly tracks which containers/processes it started so `evaluate:stop` doesn't kill a developer's unrelated work, and `evaluate:reset` refuses to run outside a managed session.
- UAT reliability (`e2e/uat/findings-reporter.ts`) is well built: finding classification, fingerprint-based grouping of duplicate symptoms, full provenance (run/commit/browser/OS/scenario version), and paired Markdown/JSON output all match the plan's acceptance criteria closely.
- `scripts/check-current-capabilities.mjs` was correctly extended to cover `TRY.md` and the appraisal pack and wired into a new required-shaped `status-consistency` CI job — this directly closes the gap the previous review of the plan itself identified.
- `TRY.md`, the appraisal pack's Journeys A and B, the feedback template and the triage cadence doc are well written: goal-based, honest about limitations, no click-by-click scripting.
- The hosted-evaluation-environments proposal is appropriately scoped as decision-ready, not implemented.
- Every file this implementation attempt added is lint-clean; the 94 pre-existing lint errors elsewhere in the repo are untouched and unrelated.

## Remediation items

Ordered by dependency and blast radius, not by the phase numbering of the original plan — several of these are corrections to Phase 4 work that Phase 3 also depends on conceptually.

### RM1 — Journey metadata cites requirement IDs that don't exist

**Severity: High.** `e2e/journey-metadata.json` tags journeys with `REQ-006`, `REQ-130` and `REQ-069`. No such identifiers exist anywhere in `docs/requirements/functional-requirements.md`; the authoritative scheme is domain-prefixed (`SID-001`, `CAT-001`, `REG-*`, `GOV-*`, etc. — 29 prefixes in total, none of them `REQ`). This directly contradicts the plan's own P4.1 acceptance criterion: "Values reuse existing authoritative identifiers and avoid a parallel taxonomy." `pnpm check:journey-metadata` (`scripts/select-journeys.mjs validate`) only checks that the fields are present and non-empty — it never checks that a cited ID actually resolves, so this was never going to be caught by the tooling that was built to catch exactly this class of error.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM1.1 | Replace the three fabricated `REQ-*` values with real `SID-*`/`CAT-*`/`REG-*`/`GOV-*` (etc.) identifiers that the journeys actually exercise | Every `requirements` entry resolves to a row in `functional-requirements.md` or `business-process-p0-functional-requirements.md` |
| RM1.2 | Extend `select-journeys.mjs validate` to parse the requirements docs and fail on any unresolvable ID | Introducing a fabricated ID and running `pnpm check:journey-metadata` fails the check |

### RM2 — Capability identifiers in journey metadata are invented, not sourced

**Severity: High.** `capabilities` values (`person-identity-and-student-profile`, `audit-and-record-governance`, `exam-boards-and-ratification`, `demo-and-migration-tooling`) don't correspond to anything in `current-capabilities.md`, which has no stable ID field at all — only prose capability names. This is the same class of problem as RM1: metadata that looks authoritative but isn't traceable to a real source, undermining the eventual P4.9 goal of linking capability status to reproducible evidence.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM2.1 | Add a stable `id` (kebab-case slug) column/field to each capability-matrix row, generated once from the existing prose name | Every capability row has exactly one immutable slug; `check:current-capabilities` enforces uniqueness |
| RM2.2 | Re-point `journey-metadata.json`'s `capabilities` values at the new slugs | Every `capabilities` entry matches a matrix row's `id` |
| RM2.3 | Extend `select-journeys.mjs validate` to check this, same as RM1.2 | Unknown capability slug fails the check |

### RM3 — Evidence report doesn't group by capability, and manifests carry no metadata

**Severity: High.** `scripts/generate-evidence-report.mjs` groups only by `evidenceClass`; it never reads `e2e/journey-metadata.json`. `scripts/write-evidence-manifest.mjs` always writes `metadata: {}`, even though the schema (`schemas/test-evidence-manifest.schema.json`) declares the field for exactly this purpose. The two Phase 4 subsystems — journey metadata and evidence manifests — were built in parallel but never connected, so P4.7's explicit acceptance criterion ("grouped by capability and evidence class") and P4.9 ("capability matrix references generated evidence") aren't reachable from what exists today, regardless of RM1/RM2.

| Task | Action | Acceptance criteria | Depends on |
|---|---|---|---|
| RM3.1 | Have the real-journey CI step pass the matching `journey-metadata.json` entry's `capabilities`/`personas`/`requirements` into `write-evidence-manifest.mjs`, populating `metadata` | A generated manifest for the real journey has non-empty `metadata.capabilities` | RM1, RM2 |
| RM3.2 | Add a capability-grouped section to `generate-evidence-report.mjs`'s output, alongside the existing evidence-class grouping | The Markdown/JSON report can answer "what evidence exists for capability X" without manual cross-referencing | RM3.1 |

### RM4 — Component-test harness documentation describes tooling that doesn't exist yet

**Severity: Medium-High.** `docs/testing/frontend-component-testing.md` states as current convention: "Mock HTTP at the MSW boundary" and "Component axe checks supplement... keyboard, screen-reader and real-browser appraisal." Neither is true of the code — the three existing component tests stub `fetch` directly, and there is no axe-core integration anywhere in the Vitest component harness (`msw` is a dependency but unused in `test/`; `@axe-core/playwright` exists only for the pre-existing Playwright suite). This is a direct violation of the plan's own "Definition of done" rule 1: "implementation and user-facing documentation agree." A contributor following this doc today will write component tests to a convention the harness doesn't actually support.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM4.1 | Either wire MSW into the shared component-test setup (`test/component-setup.mjs`) and migrate the fetch-stub tests to it, or rewrite the doc to describe the fetch-stub convention actually in use | Documentation and implementation agree; pick one, don't leave both half-true |
| RM4.2 | Add a reusable `axe(container)` helper (jest-axe or `@axe-core/react` against the rendered DOM) and use it in at least the existing three test files | `docs/testing/frontend-component-testing.md`'s axe claim is true; P3.4's acceptance criterion is met |

### RM5 — No render helpers; every component test hand-rolls its own setup

**Severity: Medium.** P3.2 called for standard render helpers (router, auth, tenant, permissions, i18n, query/API wrappers) so component tests "declare only relevant state." None exist. This is currently invisible because only 3 tests exist, but it will not scale to RM6/RM7 below — without it, each of the ~30+ tests needed for the five critical workflows will re-implement ad hoc routing/auth/permission context, producing exactly the inconsistent, copy-pasted setup the plan was trying to avoid.

| Task | Action | Acceptance criteria | Depends on |
|---|---|---|---|
| RM5.1 | Build shared `renderWithProviders()` helpers per frontend workspace (or one shared one in `packages/ui` if the provider shape is common) covering router, auth/permission context and API-mock wiring | New workflow tests (RM6) use the helper instead of ad hoc setup | RM4.1 |

### RM6 — Five critical workflows named in the plan have zero test coverage

**Severity: High, but explicitly and correctly flagged as incomplete by the implementation's own status doc.** P3.9–P3.13 (module registration/approval, student record update, exam-board authority, engagement intervention, regulatory submission) have no component tests at all. P3.6–P3.8 (shared form/dialog/table patterns) exist only as a single combined smoke test covering one state each — e.g. the Dialog pattern tests Escape only, not focus trap, destructive confirmation, or focus return as P3.7 requires; the Table pattern tests only the empty state, not loading/error/populated/filter/pagination as P3.8 requires. This is the largest genuine scope gap in the whole implementation attempt, and the one the status doc is most upfront about ("Add state/interaction coverage for all five named critical workflows before declaring the exit gate met").

| Task | Action | Acceptance criteria | Depends on |
|---|---|---|---|
| RM6.1 | Extend the Dialog/Table pattern tests to the remaining states listed in P3.7/P3.8 | Pattern tests match the plan's named minimum states, not just one representative case each | RM5.1 |
| RM6.2–RM6.6 | Add component coverage for each of the five named workflows (P3.9–P3.13), one at a time, in the plan's listed priority order | Each workflow's minimum states/interactions (as specified in the original plan's Workstream 3B table) are exercised and pass | RM5.1, RM6.1 |

### RM7 — Appraisal pack's third journey requires an undocumented manual step

**Severity: Medium.** `docs/appraisal/README.md`'s Journey C (exam-board governance) tells the evaluator: "reset the evaluator to the `exam-board` scenario manually using the documented demo command, or ask the facilitator to prepare that scenario" — without naming or linking that command. This breaks the "one dependable entry point, no developer knowledge required" premise (P2.1/P2.5) for exactly the journey — governance/ratification — that the plan calls out as one of only three appraisal perspectives. An unassisted evaluator following `TRY.md` → `pnpm evaluate` → the appraisal pack will stall here.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM7.1 | Either extend `pnpm evaluate` to accept a scenario argument (`pnpm evaluate --scenario exam-board`) and document it, or add the literal `pnpm demo:reset exam-board && pnpm demo:validate exam-board` command inline in Journey C | An unassisted evaluator can reach Journey C without asking a facilitator or reading developer docs |

### RM8 — No unit tests for the new UAT pure-logic modules

**Severity: Low.** `groupFindings`, `renderFindings` and `normalise` in `e2e/uat/findings-reporter.ts` are pure functions — the natural target for the `test:unit`/`test:component` harness this plan just built — but have no tests. Minor given the harness itself is proven working elsewhere, but leaves the fingerprint-grouping and PII-normalisation logic (the two most failure-prone parts of P2.8) unverified by anything faster than a full Playwright run.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM8.1 | Add `e2e/uat/findings-reporter.test.ts` covering grouping of duplicate symptoms, the `invalid-environment` short-circuit, and ID/URL normalisation | Tests run under `pnpm test:unit` without Docker or a browser |

### RM9 — Mocked-UI suite is 42/149 red with no remediation owner or decision

**Severity: Medium, decision-blocking rather than code-blocking.** Verified pre-existing (identical failures reproduce on unmodified `main`), so this implementation attempt correctly surfaced rather than caused the problem — this is a point in its favour, not against it. But once branch-protection wires the "Mocked UI & Accessibility" job in as a required check (the one piece of Phase 1 the status doc correctly flags as still needing human/CI action), a permanently red required check either blocks all merges or gets bypassed — both outcomes contradict the plan's own delivery principle ("a test must fail, not skip"). This needs an explicit decision before, not after, branch protection is turned on.

| Task | Action | Acceptance criteria |
|---|---|---|
| RM9.1 | Triage the 42 failures into fix-now (strict-mode locator bugs like the `portal-smoke.spec.ts` login-heading ambiguity, which is a one-line test fix) versus real product/accessibility gaps that need tracked follow-up | Every failure has a disposition, not just a raw count |
| RM9.2 | Decide and record whether "Mocked UI & Accessibility" becomes a required PR check before or after the fix-now items land | Branch-protection configuration matches a documented decision, not silence |

### RM10 — Minor robustness gaps

**Severity: Low.** Two small items, worth fixing opportunistically rather than as a dedicated task:

- `scripts/evaluate.mjs`'s `reset()` hardcodes the check `state.scenario !== 'module-selection'`; it will refuse to reset if the evaluator's default scenario is ever changed. Compare against the scenario recorded in state instead of a literal.
- `scripts/environment.mjs`'s `preflight()`/`waitForServices()` check Docker, Keycloak, API, admin and portal, but not PostgreSQL/NATS/Temporal individually (P1.7 lists them explicitly) — acceptable in practice since Keycloak/API readiness is transitively gated by them, but worth a one-line comment rather than silent omission so a future reader doesn't assume they're unchecked by oversight.

## Sequencing

RM1 and RM2 block RM3 (evidence can't be grouped by capability using identifiers that don't resolve). RM4 blocks RM5, which blocks RM6 (no point building 30+ tests on a harness convention that's about to change). RM7, RM8, RM9 and RM10 are independent of the above and of each other — take them in any order, or in parallel with RM1–RM6.

Unrelated to this plan: the working tree also carries pre-existing, uncommitted changes to `apps/api/test/helpers/test-app.ts`, `packages/db/migrations/0019_partner_systems_contracts.sql` and its journal entry, from before this implementation attempt started. Keep these out of whatever commit/PR carries the remediation above — they're a separate piece of in-progress work (partner-systems-contracts migration) and bundling them would make the plan's PR harder to review and revert independently.

## Definition of done for this remediation

Same as the original plan's: implementation and documentation agree, failure paths are verified, no fabricated identifiers pass validation silently, and every claim in the status doc is something a reviewer can independently reproduce — as this review did.
