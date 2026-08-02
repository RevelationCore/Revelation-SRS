# Application analysis — tutorial overview video

This document is Phase 1 of the tutorial-video pipeline. It records what was
verified about the application before any storyboard, narration, or
automation was written, per the working principle "inspect the repo first;
never assume when source code can answer."

## Application summary

**Revelation SRS** is an open-source (AGPL v3) Student Records System for UK
Higher Education. It is a multi-app TypeScript/Node monorepo: a Fastify API,
a React **Student Portal** (`apps/portal`), and a React **Admin/Staff**
application (`apps/admin`), backed by PostgreSQL, Keycloak (OIDC identity),
NATS JetStream, and Temporal workflows. The project is in active development
(status: Alpha) and is intended to be a modern, auditable, workflow-driven
alternative to legacy SITS/Banner-style SRS platforms.

Two applications ship with a UI. This tutorial covers the **Student Portal**
only — it is the smaller, self-contained, student-facing surface, and it has
a single clear end-to-end workflow (module registration) with real form
validation and a persisted, checkable outcome. The Admin application is a
much larger, staff-facing surface (33 pages) better suited to a separate,
future tutorial.

## Proposed audience

**New students** encountering the Student Portal for the first time during
module registration — i.e. someone who has received a login from their
institution and needs to know: where to log in, what the portal shows them,
and how to complete the one task that has a hard deadline (choosing optional
modules).

## Key features (verified from `apps/portal/src/App.tsx`)

Route map, confirmed by reading the file directly:

- Public: `/login`, `/callback` (OIDC redirect), `/403`, `/accessibility-statement`
- Authenticated (behind `RequireAuth` + `Layout`):
  `/dashboard`, `/profile`, `/profile/edit`, `/profile/addresses/new`,
  `/enrolments`, `/modules`, `/modules/add`, `/results`, `/timetable`,
  `/exams`, `/adjustments`, `/disability`, `/circumstances`, `/notifications`
- `/` redirects to `/dashboard`; unmatched routes hit a 404 page.

Login is real Keycloak OIDC (realm `srs`), not a mock — the portal's login
page has a single "Sign in with institutional account" button that redirects
to Keycloak's own hosted login form.

## Recommended demonstration journey

Selected from `docs/demo-scenarios/s3-module-selection.md`, story **P-07
"Add an optional module"** — a pre-existing, documented, forms-heavy,
end-to-end journey that was manually driven against the live application
(see "Verification performed" below) rather than assumed from the docs alone:

1. Sign in as demo persona `alice.demo` via the real Keycloak login flow.
2. Land on `/dashboard` — orientation: stat cards, current enrolment summary.
3. Visit `/modules` — see Alice's current module registrations (CS103,
   CS104) as the "before" state.
4. Visit `/modules/add` — browse the list of optional modules available for
   the current period (~16-22 fictional demo modules, e.g. MA101 Calculus).
5. Select a module, trigger the inline confirm step ("Register for this
   module? Confirm / Cancel"), confirm it.
6. Return to `/modules` and show the new registration now listed with
   today's date and status "Registered" — this is the verifiable, persisted
   outcome of the workflow.
7. Brief secondary-feature glance (`/notifications` or `/timetable`) to show
   the portal has more to it than the one workflow.
8. Summary / closing.

## Recording risks and dependencies

- **Backing services required**: Docker Compose stack (Postgres, Keycloak,
  NATS, Temporal) plus `apps/api` and `apps/portal` dev servers must be
  running locally before recording. None of this is optional — the app has
  no fully-mocked "offline" mode.
- **Demo data dependency**: the workflow depends on the `module-selection`
  (S3) demo scenario being freshly reset (`pnpm demo:reset module-selection`)
  and the `alice.demo` Keycloak persona being provisioned
  (`pnpm setup:keycloak`) — confirmed necessary because a scenario reset
  alone logs `KEYCLOAK_ADMIN_URL not set — skipping persona provisioning`
  and leaves the Keycloak-side user unpatched if `setup:keycloak` is skipped.
- **No automatic on-screen confirmation after registering** — verified by
  direct testing (Playwright script against the live app): after clicking
  "Confirm" on a module row, the UI does **not** navigate away or show a
  success toast; the row's inline "Register for this module? Confirm/Cancel"
  state remains visible even though the registration has already succeeded
  server-side. The only way to visibly confirm success on screen is to
  navigate back to `/modules` and show the new row. The storyboard and
  automation must account for this explicitly — narration must not claim an
  on-screen confirmation message appears at `/modules/add`, since none does.
- **No `ffmpeg`/`brew` available locally** — confirmed via `which ffmpeg` /
  `which brew` (both absent). Mitigation: use the `ffmpeg-static` npm
  package (bundled portable binary) so Phase 7 doesn't need a system
  install.
- **No TTS provider credentials available** in this environment. Mitigation
  (per task spec): generate silent placeholder audio of correct duration and
  document the exact command to run once real credentials are supplied.

## Assumptions made

- The task's `[APPLICATION NAME]` / `[TARGET AUDIENCE OR "new users"]`
  placeholders were left unfilled by the user, so **Revelation SRS Student
  Portal** and **new students** were chosen directly from the repository's
  own authoritative demo-scenario documentation rather than invented.
- The Student Portal (not the Admin app) was chosen as the subject of this
  first tutorial video because it has one clean, short, verifiable workflow
  suited to a 3-5 minute overview; a separate tutorial would be needed to
  cover the Admin application's 33 pages.
- All data shown in the recording is the project's own fictional demo data
  (`module-selection` scenario, persona `alice.demo`) — no real institution,
  student, or credential data exists in this project.

## Verification performed

The full journey above (steps 1-6) was manually driven end-to-end against
the live, running application using throwaway Playwright scripts (deleted
after use) before any tutorial asset was written:

- Real Keycloak OIDC login as `alice.demo` succeeded and landed on
  `/dashboard` with real seeded data.
- `/modules` showed Alice's existing CS103/CS104 registrations.
- `/modules/add` showed a real list of ~16-22 fictional optional modules for
  the AUTUMN period, including MA101 Calculus.
- Clicking "Add module" then "Confirm" on the MA101 Calculus row triggered a
  real API write (confirmed via the follow-up step below), but did not
  navigate away or show an on-screen success message.
- Re-navigating to `/modules` showed a new row: `MA101 DEMO - Calculus |
  AUTUMN | 20 | Registered | <today's date> | Withdraw` — proving the
  workflow's outcome is real and persisted, not merely a UI illusion.
- Demo data was reset (`pnpm demo:reset module-selection`) immediately after
  this test to restore a clean starting state before building any permanent
  tutorial fixture.
