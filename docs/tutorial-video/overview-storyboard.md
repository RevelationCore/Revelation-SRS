# Overview video storyboard

Phase 2 deliverable. Ten scenes, target total runtime ~3:45 (within the
required 3-5 minute window). Scene IDs match `overview-narration.json`
1:1 (`scene-01` ... `scene-10`).

All scenes take place in `apps/portal` at 1920x1080, signed in as the
fictional demo persona `alice.demo` (`module-selection` / S3 demo scenario).
No real institution, student, or credential data is used anywhere.

---

### scene-01 — Opening title

- **Duration**: ~10s
- **Starting state**: blank/branded title card (rendered by the video
  assembly step, not the app itself).
- **On-screen actions**: static title card: "Revelation SRS — Student
  Portal — Overview".
- **Narration**: "Welcome to Revelation SRS — an open source student
  records system for higher education. This is a quick tour of the student
  portal."
- **Required demo data**: none.
- **Expected result**: title card displayed for the full scene duration.
- **Callout/zoom/highlight**: none — static full-frame title.
- **Reset before next scene**: none.

### scene-02 — What the app is for

- **Duration**: ~20s
- **Starting state**: browser at the portal login page (`/login`), signed
  out.
- **On-screen actions**: show the login page: institution branding, a
  short explanatory line, and the "Sign in with institutional account"
  button. No click yet.
- **Narration**: "The student portal is where you manage everything to do
  with your studies — your profile, your module choices, your results, and
  more. You sign in with the same account your institution gives you for
  everything else."
- **Required demo data**: none (unauthenticated page).
- **Expected result**: login page fully rendered, button visible.
- **Callout/zoom/highlight**: gentle highlight box around the sign-in
  button.
- **Reset before next scene**: none — next scene continues from here.

### scene-03 — Interface orientation (dashboard)

- **Duration**: ~25s
- **Starting state**: login page, signed out.
- **On-screen actions**: click "Sign in with institutional account" →
  Keycloak hosted login form → fill username/password for `alice.demo` →
  submit → land on `/dashboard`. Let the dashboard sit on screen; slowly
  scroll to reveal stat cards and the current-enrolment summary.
- **Narration**: "Once you're signed in, the dashboard gives you an
  at-a-glance summary — your current enrolment, key dates, and anything
  that needs your attention."
- **Required demo data**: persona `alice.demo`, scenario `module-selection`
  reset to a clean state beforehand.
- **Expected result**: `/dashboard` loaded with real seeded stat cards and
  enrolment summary for Alice.
- **Callout/zoom/highlight**: soft highlight sweeping across the stat cards
  as they're mentioned.
- **Reset before next scene**: none.

### scene-04 — Starting the main workflow

- **Duration**: ~20s
- **Starting state**: `/dashboard`, signed in as `alice.demo`.
- **On-screen actions**: use the main navigation to open "My modules"
  (`/modules`). Pause on the page showing Alice's current registrations
  (CS103, CS104).
- **Narration**: "One of the most time-sensitive tasks for a student is
  choosing optional modules. Let's look at 'My modules' — here's what
  Alice is currently registered for."
- **Required demo data**: existing CS103/CS104 registrations from the
  `module-selection` scenario seed.
- **Expected result**: `/modules` table showing the two existing
  registrations.
- **Callout/zoom/highlight**: highlight the registrations table.
- **Reset before next scene**: none.

### scene-05 — Completing the principal form (browse and select)

- **Duration**: ~35s
- **Starting state**: `/modules`, signed in as `alice.demo`.
- **On-screen actions**: click through to "Add module" (`/modules/add`).
  Let the full list of optional modules render. Scroll partway down the
  list at a readable pace. Stop on the MA101 Calculus row.
- **Narration**: "From here Alice can browse every optional module
  available for this period, see how many credits each one carries, and
  add the ones she wants."
- **Required demo data**: the ~16-22 fictional optional module offerings
  seeded for the AUTUMN period, including MA101 Calculus.
- **Expected result**: `/modules/add` list fully rendered and scrollable.
- **Callout/zoom/highlight**: highlight the MA101 Calculus row before
  interacting with it.
- **Reset before next scene**: none.

### scene-06 — Demonstrating validation/guidance (confirm step)

- **Duration**: ~25s
- **Starting state**: `/modules/add`, MA101 Calculus row visible.
- **On-screen actions**: click "Add module" on the MA101 Calculus row. The
  row switches to an inline confirmation state: "Register for this module?
  Confirm / Cancel". Hold on this state long enough to read.
- **Narration**: "Before anything is saved, the portal always asks you to
  confirm — so you can't register for a module by accident."
- **Required demo data**: same MA101 Calculus offering.
- **Expected result**: inline confirm/cancel controls visible on the row.
- **Callout/zoom/highlight**: highlight box around the Confirm/Cancel
  controls.
- **Reset before next scene**: none.

### scene-07 — Submitting/saving/processing

- **Duration**: ~15s
- **Starting state**: MA101 Calculus row in confirm state.
- **On-screen actions**: click "Confirm". Brief pause to let the request
  complete (no visible page change here — this is expected app behaviour,
  not a recording error, see `application-analysis.md`).
- **Narration**: "Confirming sends the registration straight to Alice's
  record."
- **Required demo data**: same.
- **Expected result**: API call completes successfully (verified
  server-side; no on-screen change at this exact moment).
- **Callout/zoom/highlight**: none — deliberately quiet beat.
- **Reset before next scene**: none.

### scene-08 — Showing the result

- **Duration**: ~25s
- **Starting state**: `/modules/add`, just after confirming MA101.
- **On-screen actions**: navigate back to "My modules" (`/modules`). Point
  out the new row for MA101 Calculus, status "Registered", dated today.
- **Narration**: "And back on 'My modules', the new registration is right
  there — confirmed, dated, and ready for the module leader to see."
- **Required demo data**: the just-created registration row.
- **Expected result**: `/modules` table now shows three rows: CS103, CS104,
  and MA101 (status "Registered").
- **Callout/zoom/highlight**: highlight the new MA101 row.
- **Reset before next scene**: none.

### scene-09 — Brief tour of a secondary feature

- **Duration**: ~30s
- **Starting state**: `/modules`, signed in as `alice.demo`.
- **On-screen actions**: navigate to "Notifications" (`/notifications`);
  show the list briefly. Then navigate to "Timetable" (`/timetable`); show
  it briefly.
- **Narration**: "The portal covers a lot more than module choices —
  notifications keep you posted on anything that needs attention, and your
  timetable is always up to date once your modules are confirmed."
- **Required demo data**: seeded notifications and timetable entries for
  `alice.demo`.
- **Expected result**: both pages render without error.
- **Callout/zoom/highlight**: none — light-touch pass-through.
- **Reset before next scene**: none.

### scene-10 — Summary / closing

- **Duration**: ~20s
- **Starting state**: closing title card (rendered by the video assembly
  step).
- **On-screen actions**: static closing card: "Revelation SRS — Student
  Portal" plus a one-line summary and (if TTS narration was used) a
  disclosure that the voiceover is AI-generated.
- **Narration**: "That's a quick look at the student portal — sign in,
  check your dashboard, manage your modules, and stay on top of
  everything else in one place."
- **Required demo data**: none.
- **Expected result**: closing card displayed for the full scene duration.
- **Callout/zoom/highlight**: none.
- **Reset before next scene**: n/a (final scene). Demo data should be
  reset to a clean state after the full recording completes, ready for the
  next run.

---

## Notes carried over from Phase 1 verification

- Scene 7 is deliberately narrated as a quiet beat with no on-screen
  change, because that is what the application actually does — there is no
  redirect or success toast after confirming a registration. This was
  confirmed by direct testing against the live app, not assumed.
- Total estimated runtime: 10+20+25+20+35+25+15+25+30+20 = **225 seconds
  (3:45)**, within the required 3-5 minute range.
