# Accessibility Improvement Plan

> Status: **Implemented** — all phases (A, B, C, D) complete; see per-phase notes below
>
> Created: 2026-08-15
>
> Planning horizon: Dependency-ordered phases, advanced by exit-gate readiness rather than fixed calendar weeks (see [testing-and-appraisal-accessibility-plan.md](testing-and-appraisal-accessibility-plan.md#delivery-cadence) for why this repo plans this way)
>
> Scope: Static tooling, a shared accessible Tabs primitive and its rollout, keyboard/focus fundamentals, automated-scan coverage, and the accuracy of both applications' accessibility statements

## Rationale

The previous testing-and-appraisal remediation pass found and fixed five real, previously undiscovered accessibility/correctness bugs purely as a side effect of writing component tests (a Dialog focus-return regression, two unlabelled `<select>` filters, an insufficient-contrast sidebar label, and a second insufficient-contrast stat label) and fixed all 42 pre-existing mocked-UI failures. That was reactive — bugs surfaced because tests happened to reach them. This plan is a deliberate, systematic pass instead.

An audit for this plan found:

- **No static accessibility linting.** `eslint-plugin-jsx-a11y` isn't installed. Every issue currently found has been found by a browser-based axe scan or manual read — nothing catches a missing `alt`, an interactive `<div>`, or a bad `aria-*` value at commit time.
- **Both accessibility statements overclaim.** Both `AccessibilityStatementPage` components assert WCAG **2.1** AA conformance, but the axe scans they cite only run the `wcag2a`/`wcag2aa` (WCAG **2.0**) rule sets. They cite exact route counts ("all 14 authenticated routes" for portal, "all 26" for admin) that don't match the real route counts (23 and 39) or what's actually scanned (see below). They claim "Screen reader testing with NVDA on Windows and VoiceOver on macOS" — there is no artifact, transcript, or CI evidence of this anywhere in the repository, and no screen reader is available in this environment to have produced one. Portal's statement claims "no known material exceptions"; admin's lists exactly one. Both statements were contradicted by real, undiscovered WCAG failures until the previous session's incidental fixes. For a UK HE product, institutions may rely on this statement for Public Sector Bodies Accessibility Regulations 2018 compliance — an inaccurate statement is a materially worse position than an honest, narrower one.
- **Automated scan coverage has real gaps.** Comparing the axe-scanned route lists against `App.tsx`'s actual routes: **16 of 39 admin routes** (the entire Governance section — audit review, identity resolution, moderation, all four PGR stages, regulatory collections, rights requests — plus engagement, both case-management routes, module-selection/registration-request queues, the exam-board detail page, and the registration-windows admin page) and **4 of 23 portal routes** (`/enrolments/:id`, `/modules/select`, `/profile/addresses/:id/edit`, and the accessibility statement page itself) have never been scanned by anything.
- **Eleven of twelve tabbed-interface pages have no tab semantics.** `packages/ui` already has a correct, Radix-backed `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` primitive (proper `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, roving-tabindex arrow-key navigation, and a visible focus ring) — but only two pages use it. The other eleven (including `StudentDetailPage`, the single most complex page in the app, and `ExamBoardDetailPage`) reimplement tabs as a row of plain `<button>` elements with manual `tab === x` state and no ARIA role at all. A screen reader user on those pages has no way to know these buttons form a tab group or which one is selected. Two of the eleven (`OfsPage`, `ExamBoardDetailPage`) additionally set `focus:outline-none` on those buttons with no replacement focus style, so keyboard users tabbing through them see no focus indicator at all.
- **No skip-to-content link on either application.** Both apps have a persistent sidebar nav rendered before `<main>` in DOM order. A keyboard user must tab through the entire nav (10–20 links) on every single page before reaching page content.
- **No `prefers-reduced-motion` handling anywhere** — spinners and dialog transitions animate unconditionally.

None of this is hypothetical or inferred from general WCAG checklists — every item above was confirmed by reading the actual route tables, the actual `Tabs.tsx` component and its two real call sites, the actual axe tag arguments, and the actual statement text.

## Delivery principles

Same principles this repo already uses for its other plans, restated for this one:

- Fix root causes once, in shared components, rather than patching each page's copy of the same bug.
- A statement that can't be backed by a reproducible check doesn't go in the accessibility statement. "We don't know yet" is an honest answer; an invented screen-reader test isn't.
- Extending automated coverage must surface real failures, not just add green checkmarks — every newly-scanned route gets fixed if it fails, not skipped or excluded.
- No existing passing test is weakened to make a new one pass.

## Phase A: Honest foundation — done

**Sequencing:** No dependencies; can start immediately and runs in parallel with everything else.

| ID | Task | Acceptance criteria |
|---|---|---|
| A1 | Add `eslint-plugin-jsx-a11y` to the root ESLint config, scoped to `apps/*/src` and `packages/ui/src` | Recommended rule set active; a deliberately introduced `<div onClick>` or missing `alt` fails `pnpm lint` |
| A2 | Rewrite both `AccessibilityStatementPage` components to state only what's true and checkable today: Alpha product maturity, the real automated-scan scope (which routes, which WCAG version/level), that no independent or assistive-technology audit has been performed yet, and real known gaps rather than "none known" | `pnpm check:current-capabilities`-style rigor: every factual claim in the page traces to a real, currently-passing check; no route count or testing-method claim exceeds what's demonstrably true |

**Outcome:** `eslint-plugin-jsx-a11y` (plus `react-hooks/rules-of-hooks` and `exhaustive-deps`) is now active on all `.tsx` files — which were previously not linted at all (`eslint.config.js` had no `**/*.tsx` block; ESLint silently skipped every React component in the repo). Enabling it surfaced 8 real accessibility issues (unassociated form labels, `<div onClick>` used as an interactive control, a legitimate-but-unflagged `autoFocus`) and one genuine React "rules of hooks" violation (a `useState` declared after an early return in portal `LoginPage`) — all fixed. Full strict TypeScript rules were deliberately **not** extended to `.tsx` files in the same pass (would have added ~789 unrelated pre-existing errors to `pnpm lint`'s failure surface); that's tracked as separate, later, out-of-scope cleanup. Both statements were rewritten to drop the false NVDA/VoiceOver claim and the "no known material exceptions" claim, state the real current route counts and WCAG tag scope, and list "no assistive-technology user testing" and "no independent audit" as open gaps rather than implying either happened.

## Phase B: Shared accessible Tabs primitive — rollout — done

**Sequencing:** Independent of Phase A. The primitive itself already exists (`packages/ui/src/components/Tabs.tsx`, exported, in use on 2 of 13 tabbed pages) — this phase is rollout and verification, not new-component design.

| ID | Task | Acceptance criteria |
|---|---|---|
| B1 | Convert the eleven remaining ad hoc tab implementations to `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`: `OfsPage`, `WorkflowDefsPage`, `ExamBoardDetailPage`, `GlobalisationPage`, `UkviPage`, `FeatureFlagsPage`, `IntegrationsPage`, `IntegrationOpsPage`, `HesaPage`, `TenantAdminPage`, `StudentDetailPage` | Each page's tab row has `role="tablist"`, each tab has `role="tab"`/`aria-selected`, each panel has `role="tabpanel"`, arrow-key navigation moves focus between tabs, and every tab has a visible focus indicator; no existing test regresses |
| B2 | Where a page's tab state must stay controlled (e.g. read elsewhere in the component, or synced to something external), use `Tabs value={}/onValueChange={}`; otherwise use uncontrolled `defaultValue` | Behavioural parity with the pre-conversion page — same default tab, same content per tab — confirmed by re-running that page's existing e2e/component coverage |

**Outcome:** 13 pages converted, not 11 — a post-conversion grep found two ad hoc tab implementations this plan's original audit missed (`EnvironmentRuntimePage`, `EngagementPage`). Two pages originally listed (`HesaPage`, `TenantAdminPage`) turned out not to have tabs at all and needed no change. `role="button"` → `role="tab"` broke two pre-existing e2e assertions and one component test that queried the old role; all three were updated to query `role="tab"` (and, for `StudentDetailPage`, to also assert `aria-selected` and arrow-key navigation).

## Phase C: Keyboard and focus fundamentals — done

**Sequencing:** Independent of Phases A/B.

| ID | Task | Acceptance criteria |
|---|---|---|
| C1 | Add a "Skip to main content" link as the first focusable element in both `Layout` components, visually hidden until focused, targeting the existing `<main>` landmark | Pressing Tab once on page load focuses a visible "Skip to main content" link; activating it moves focus into `<main>` |
| C2 | Audit every `focus:outline-none`/`outline-none` occurrence app-wide (not just the two found in this audit) and either remove it or pair it with a real focus-visible style | No interactive element loses its focus indicator; a grep for `outline-none` without a paired `focus-visible`/`focus:ring` in the same class list returns nothing outside `Dialog.tsx`'s content wrapper (which is intentional — focus lands on an interactive child) |
| C3 | Add `prefers-reduced-motion` handling to the shared `Spinner` and `Dialog` open/close transition | Animations are removed or substantially reduced under `prefers-reduced-motion: reduce`, verified in a component test using `window.matchMedia` mocking |

**Outcome:** `SkipLink` added to `packages/ui` and wired into both `Layout` components with `id="main-content"` on each `<main>`. The `outline-none` audit found every occurrence already paired with a `ring`/`outline` replacement except two: `Tabs.tsx`'s `TabsContent` (reachable via Tab when a panel has no focusable child) and `Dialog.tsx`'s content wrapper — both fixed with a `focus-visible:outline` pair. `Spinner` and the one other bare `animate-spin` (admin `LoginPage`) now use `motion-safe:animate-spin`; `Dialog` has no animation classes, so C3's `Dialog` transition work was a non-issue in this codebase (native — Tailwind's built-in `motion-safe:`/`motion-reduce:` variants were used in place of a `matchMedia`-based component test, since no CSS-in-JS or JS-driven animation exists to mock).

## Phase D: Close automated-coverage gaps — done

**Sequencing:** Best run after Phase B, since several of the newly-scanned routes are exactly the tab-heavy pages B1 fixes — scanning them before B1 would surface the same tab-semantics finding 11 times instead of once.

| ID | Task | Acceptance criteria |
|---|---|---|
| D1 | Add the 16 missing admin routes and 4 missing portal routes to their respective axe-scan route tables | Every route in `App.tsx` (excluding pure redirects and the OAuth callback) has an entry in the corresponding scan table |
| D2 | Add `wcag21aa` to both scan tables' `withTags([...])` call, matching the conformance level both statements claim | Scans run against `wcag2a`, `wcag2aa` and `wcag21aa`; any newly-caught violation is fixed, not excluded |
| D3 | Fix whatever D1/D2 surface | Full mocked-UI suite passes; Phase A2's statement rewrite reflects the now-true, wider scan scope |

**Outcome:** Admin scan table grew from 26 to 42 routes, portal from 14 to 17 (both now cover every real route, including the accessibility statement page itself, which previously had a visibility check but no axe scan on admin and no coverage at all on portal). Extending the admin table's coverage surfaced one real bug: `StudentDetailPage`'s identity `<dl>` had a stray `<p>` (an "Updated ‹date›" caption) as a direct child, which is not valid `<dl>` content (`only-dlitems`, serious impact) — fixed by moving the caption outside the `<dl>`. Both scan tables now request `wcag2a`, `wcag2aa`, and `wcag21aa`; no other route failed under the wider scope.

## Explicitly deferred

- **Manual assistive-technology testing** (NVDA, JAWS, VoiceOver, TalkBack) — genuinely requires a human with real AT hardware/software; not possible from this environment. The rewritten statement (A2) says this plainly instead of claiming it happened.
- **An independent/professional accessibility audit** — same reason; A2 states none has occurred rather than implying one has.
- **WCAG 2.2** — the statements target 2.1 AA; moving the target itself is a separate, later decision, not a silent scope change inside this remediation.
- **Full keyboard-only manual walkthroughs of every page** — axe's automated rules don't catch everything (e.g. logical tab order across a whole page, or whether an interaction *makes sense* via keyboard, not just whether it's reachable); this plan closes the automated gap and the most systemic structural issue (tabs), not a full manual audit.

These are candidates for a later cycle once this pass has actually shipped and the statements' honesty can be trusted as a baseline.
