# Testing and Appraisal Implementation Baseline

> Status: Phase 0 decision record
>
> Date: 2026-08-14
>
> Implements: P0.1–P0.4 of the [testing and appraisal accessibility plan](testing-and-appraisal-accessibility-plan.md)

## Existing evidence map

| Existing entry point | Target evidence class | Infrastructure | Baseline observation |
|---|---|---|---|
| `pnpm test` / package Vitest unit configurations | Unit | Node only | Fast default check; several integration-only workspaces legitimately report no unit files |
| Package `test:int` scripts and root `pnpm test:int` | Service integration | Docker/Testcontainers | API, database, module, adapter, migration and demo-data persistence evidence |
| Root `pnpm test:e2e` and `playwright.config.ts` | Mocked UI | Vite admin/portal only | Authentication and API responses are injected or mocked; not full-stack evidence |
| Demo-data `test:golden` | Service integration | Docker/Testcontainers | Deterministic scenario and persistence verification, but no browser |
| `playwright.golden.config.ts` | Real journey | Pre-started full stack | Real API/browser path; the previous reachability skip weakened CI evidence |
| Tutorial Playwright automation | Real journey/media | Full local stack | Student-portal tutorial verification, not general release coverage |
| Assisted UAT suite | Appraisal/UAT | Full local stack | Live-system observations; previous report format duplicated infrastructure symptoms |
| Typecheck, lint, contract, bundle, Lighthouse, audit, DAST and performance CI jobs | Static/non-functional | Varies by job | Supporting evidence; retained outside the functional-test hierarchy |

Baseline repository inventory at the decision date: 118 test/spec files, including 13 browser files and 65 API test files. The admin, portal and shared UI workspaces had no colocated component test files. A baseline `pnpm test` run completed in approximately four seconds on the review workstation; integration and real-journey timings are environment-dependent and are emitted separately by the new runners.

## Ownership

The project currently assigns accountable repository roles rather than named individuals:

| Concern | Accountable role | Required reviewer |
|---|---|---|
| Root test commands and metadata | Test/platform maintainer | Contributor not authoring the change |
| CI readiness, diagnostics and required checks | CI/operations maintainer | Test/platform maintainer |
| Demo/evaluator lifecycle | Demo-data maintainer | CI/operations maintainer |
| Frontend component harness and mutation feedback | Frontend maintainer | Accessibility reviewer |
| Appraisal journeys and known limitations | Product/domain maintainer | UX/accessibility reviewer |
| Status and evidence documentation | Documentation maintainer | Product/domain maintainer |

Pull requests implementing this plan must name the people filling these roles in the PR description. This avoids encoding personal assignments in a long-lived repository document.

## First required real journey decision

The first required journey is the deterministic CI-golden admin student-record mutation:

1. load the `ci-golden` scenario;
2. open the enrolled student through the real admin frontend and API;
3. submit a supported contact/address mutation through the UI;
4. verify the visible success state; and
5. query the real API to verify persistence and audit evidence.

The module-registration student-to-staff workflow remains the next principal journey. The smaller record mutation is selected first because it provides a dependable pull-request gate while retaining the plan's required read, mutation, persistence and visible-result evidence.

## Performance budgets

| Activity | Local target | CI target | Measurement rule |
|---|---:|---:|---|
| `test:quick` | 3 minutes | 5 minutes | Report wall-clock total; no Docker |
| Evaluator preparation after images are cached | 5 minutes | 8 minutes | Separate services, migration/seed and app-readiness durations |
| Required real journey after dependency installation | 8 minutes | 12 minutes | Setup and browser-test durations reported separately |

Budgets are service objectives, not reasons to hide failures, skip tests or add broad retries. Two consecutive CI overruns require a recorded investigation or an explicitly approved budget change.

## Known baseline risks

- The full integration suite is necessarily sensitive to Docker availability and first-pull latency.
- The assisted UAT runner historically mixed environment symptoms with product findings.
- Real browser journey authentication uses the project's supported demo/test mechanism and is not evidence of production identity-provider configuration.
- Browser retries can conceal flakiness; required real journeys use no assertion retries beyond Playwright's bounded web-first assertions.

## Phase 0 exit decision

Every discovered suite maps to an evidence class, accountable roles are defined, the first real mutation journey is selected, budgets are recorded and known risks are explicit. Phase 0 is complete.
