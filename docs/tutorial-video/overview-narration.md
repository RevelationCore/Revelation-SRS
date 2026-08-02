# Overview video narration script

Phase 3 deliverable. Human-readable narration script, matching
`overview-narration.json` scene-for-scene (the JSON is the machine-readable
source used by the TTS generation script — keep both in sync if either is
edited).

Style notes: short conversational sentences, no unnecessary jargon,
explains *why* an action matters rather than reading screen labels aloud,
and leaves natural pauses for a viewer to follow along on screen (see
per-scene durations in the storyboard).

---

**scene-01 — Introduction** (~10s)

> Welcome to Revelation SRS, an open source student records system for
> higher education. This is a quick tour of the student portal.

**scene-02 — What the app is for** (~20s)

> The student portal is where you manage everything to do with your
> studies: your profile, your module choices, your results, and more. You
> sign in with the same account your institution gives you for everything
> else.

**scene-03 — Interface orientation** (~25s)

> Once you're signed in, the dashboard gives you an at-a-glance summary:
> your current enrolment, key dates, and anything that needs your
> attention.

**scene-04 — Starting the main workflow** (~20s)

> One of the most time-sensitive tasks for a student is choosing optional
> modules. Let's look at My Modules. Here's what Alice is currently
> registered for.

**scene-05 — Browsing and selecting a module** (~35s)

> From here, Alice can browse every optional module available for this
> period, see how many credits each one carries, and add the ones she
> wants.

**scene-06 — Confirming before saving** (~25s)

> Before anything is saved, the portal always asks you to confirm, so you
> can't register for a module by accident.

**scene-07 — Submitting the registration** (~15s)

> Confirming sends the registration straight to Alice's record.

**scene-08 — Seeing the result** (~25s)

> And back on My Modules, the new registration is right there: confirmed,
> dated, and ready for the module leader to see.

**scene-09 — A quick look at more of the portal** (~30s)

> The portal covers a lot more than module choices. Notifications keep you
> posted on anything that needs attention, and your timetable is always up
> to date once your modules are confirmed.

**scene-10 — Summary** (~20s)

> That's a quick look at the student portal: sign in, check your
> dashboard, manage your modules, and stay on top of everything else in
> one place.

---

## Disclosure

Every claim above was verified against the running application (see
`application-analysis.md`, "Verification performed") — nothing here
describes a feature that wasn't actually demonstrated.

If this narration is synthesised with text-to-speech, the closing screen of
the final video **must** carry a visible disclosure that the voice is
AI-generated (handled by `tutorials/scripts/build-overview-video.ts`, which
burns a fixed disclosure line into the closing card whenever TTS audio —
rather than the silent placeholder fallback — was used).
