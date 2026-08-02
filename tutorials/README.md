# Tutorial video pipeline

An automated pipeline that produces a ~3-5 minute narrated overview video
of the **Revelation SRS Student Portal**, demonstrating the module
registration workflow to a new-student audience. Nothing in this
directory affects production behaviour — it is a separate, standalone
tooling project that drives the real application from the outside.

See also: [`docs/tutorial-video/`](../docs/tutorial-video/) for the
application analysis, storyboard, and narration script that this pipeline
implements.

## What the overview video demonstrates

1. Signing in to the student portal with a real Keycloak account.
2. The dashboard: enrolment summary and key stats.
3. "My modules": current registrations.
4. Browsing and adding an optional module (Add module → Confirm).
5. Seeing the new registration reflected on "My modules".
6. A brief look at Notifications and Timetable.

All data is fictional demo data from the project's own `module-selection`
(S3) demo scenario, persona `alice.demo`. No real institution, student, or
credential data is used anywhere in this pipeline.

## Prerequisites

- This repository, with dependencies installed (`pnpm install` at the
  repo root).
- Docker Compose backing services running (Postgres, Keycloak, NATS,
  Temporal) — see the repo root README for `docker compose up`.
- `ffmpeg` / `ffprobe` are **not** required as system installs — this
  pipeline uses the `ffmpeg-static` / `ffprobe-static` npm packages
  (root devDependencies), which bundle portable binaries.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `TUTORIAL_DEMO_SCENARIO` | demo-data scenario to reset before recording | `module-selection` |
| `TUTORIAL_DEMO_USERNAME` | Keycloak username used for login | `alice.demo` |
| `TUTORIAL_DEMO_PASSWORD` | Keycloak password used for login | `Demo-2026!` |
| `TUTORIAL_FAST` | `1` runs the automation at compressed pacing (verification only) | unset |
| `TUTORIAL_TTS_PROVIDER` | `openai` or `elevenlabs` — enables real voiceover | unset (silent placeholder) |
| `TUTORIAL_TTS_API_KEY` | API key for the chosen TTS provider | — |
| `TUTORIAL_TTS_VOICE` | provider-specific voice id/name | provider default |
| `TUTORIAL_TTS_MODEL` | provider-specific model name | provider default |
| `TUTORIAL_TITLE_FONT` | path to a `.ttf` used for title-card text | auto-detected (Arial on macOS) |

No credentials are ever hard-coded — the TTS variables above are the only
way to enable real narration.

## Running the app in tutorial mode

"Tutorial mode" is just the real application, pointed at a freshly reset,
fictional demo scenario:

```bash
pnpm demo:reset module-selection   # or: node tutorials/setup/prepare-tutorial-data.mjs
pnpm setup:keycloak                # provisions the alice.demo persona (done automatically above)
pnpm --filter @revelation-srs/api dev
pnpm --filter @revelation-srs/portal dev
```

`tutorials/setup/prepare-tutorial-data.mjs` wraps the first two steps.
`tutorials/setup/ensure-app-running.mjs` starts the API and portal dev
servers if they aren't already up (and leaves them running, for iterative
use). Both are thin wrappers around the project's existing demo-data and
dev-server tooling — no separate fixture system was built.

## Quick workflow verification (fast mode)

Runs the same automation script structure at compressed pacing, to check
the workflow still works without sitting through full tutorial timing:

```bash
pnpm tutorial:test
```

## Recording the full-speed tutorial

Produces the real, correctly-paced screen recording used by the final
video, at 1920x1080, with cursor/click/focus visual polish:

```bash
pnpm tutorial:record
```

Output: a `.webm` recording under `tutorials/generated/test-results/`, and
checkpoint screenshots under `tutorials/generated/checkpoints/`.

## Generating the voiceover

```bash
pnpm tutorial:narrate
```

Without `TUTORIAL_TTS_PROVIDER` / `TUTORIAL_TTS_API_KEY` set, this
generates correctly-timed **silent placeholder audio** for every scene
(so captions and video timing can still be built and verified) and prints
the exact command to run once you have TTS credentials, e.g.:

```bash
TUTORIAL_TTS_PROVIDER=openai TUTORIAL_TTS_API_KEY=sk-... TUTORIAL_TTS_VOICE=alloy pnpm tutorial:narrate
```

Supported providers: `openai`, `elevenlabs`. Outputs land under
`tutorials/generated/audio/` (per-scene files, `combined.mp3`,
`manifest.json`) and `tutorials/generated/captions/` (`overview.vtt`,
`overview.srt`, timed to the *narration* durations).

## Building the final MP4

```bash
pnpm tutorial:build
```

Assembles: a branded opening title card, the screen recording, the
narration audio (padded/trimmed to match the actual recording length),
and a branded closing card (with an AI-narration disclosure line if TTS
was used) — via ffmpeg (`ffmpeg-static`, no system install needed).

Outputs, under `tutorials/output/`:

- `application-overview.mp4` — final video
- `application-overview-captioned.mp4` — same, with burned-in captions
- `application-overview.vtt`, `application-overview.srt` — final,
  duration-synced caption files (separate from the burned-in version)

The build script verifies both `.mp4` files have real video **and** audio
streams (via `ffprobe`) before reporting success.

## Running everything in one command

```bash
pnpm tutorial:all
```

Resets demo data → starts the API/portal if not already running → records
→ narrates → builds the video → runs quality checks → **stops only the
app processes it started itself** (an already-running dev server is left
alone). Fails loudly (non-zero exit) if any step fails.

## Quality checks

```bash
pnpm tutorial:check
```

Checks (also run automatically as the last step of `tutorial:all`):
narration scenes are well-formed; every scene has an audio file; caption
cues are well-formed and non-overlapping; the raw recording exists with a
valid duration; all expected checkpoint screenshots were captured (a
missing one usually means a storyboard step failed silently); the app
logged no uncaught JavaScript errors during recording; final output files
exist, are non-empty, and (for the MP4s) contain real video and audio
streams; the two MP4s' durations agree; and a lightweight scan for
accidentally hard-coded API keys/tokens in the tutorial scripts.

## Updating the tutorial after application changes

1. Re-read `docs/tutorial-video/application-analysis.md` and update it if
   the workflow, routes, or risks have changed.
2. Update `docs/tutorial-video/overview-storyboard.md` and
   `overview-narration.{md,json}` if the scene content needs to change.
3. Update `tutorials/automation/overview-video.spec.ts` if selectors,
   routes, or button labels changed — run `pnpm tutorial:test` (fast mode)
   first to check it still passes before recording at full pacing.
4. Run `pnpm tutorial:all` to rebuild everything.

## Known limitations

- **No on-screen confirmation after registering a module** is an actual
  application behaviour, not a recording bug — see
  `application-analysis.md`. The storyboard and narration are written
  around it deliberately.
- **Silent placeholder narration** is used until TTS credentials are
  supplied; the shipped `application-overview.mp4` in a fresh checkout
  will have no spoken narration, only the recorded screen audio track
  (silent) padded to length.
- **Caption timing inside the middle (screen-recording) section is
  proportionally scaled**, not per-scene frame-accurate: the browser
  recording is one continuous capture with no internal cut points, so the
  build script scales each scene's estimated narration duration by
  `actual recording length / estimated total` rather than measuring each
  scene's true on-screen duration individually.
- **`TIMING` pacing in the automation spec was tuned for a comfortable
  live recording, not to sum to the narration's estimated durations** —
  the real recording currently runs much shorter (~20s) than the
  narration's ~195s estimate for the same scenes. This is fine with
  silent placeholder audio (padding is just silence), but once real TTS
  narration is generated, the `TIMING` constants in
  `tutorials/automation/timing.ts` should be increased so the recording's
  pacing more closely matches the spoken narration length, for a more
  natural result.
- An intermittent single `500` browser console error was observed once
  during a full pipeline run and was not reproducible on a follow-up
  manual check; `tutorial:check` surfaces any such console errors as a
  non-fatal warning (see `tutorials/generated/checkpoints/console-errors.json`)
  rather than failing the build, since a transient network blip
  immediately after a demo-data reset is not the same as a broken
  workflow.
- This pipeline covers the **Student Portal** only. The Admin/Staff
  application (`apps/admin`) is a much larger surface (33 pages) and would
  need its own separate tutorial.

## Troubleshooting

- **`prepare-tutorial-data.mjs` fails with a Keycloak connection error**:
  make sure the Docker Compose stack is running and Keycloak is reachable
  at `http://localhost:8081`.
- **The Playwright spec times out on the Keycloak login form**: Keycloak's
  default theme has no `aria-label`s on its inputs, so the spec uses
  `#username`/`#password`/`#kc-login`. If a custom theme is in use, update
  those locators.
- **`tutorial:build` fails with "No recorded video found"**: run
  `pnpm tutorial:record` (or `tutorial:test`) first — the build step
  never records itself, it only assembles what's already on disk.
- **Title cards fail to render / drawtext errors**: set
  `TUTORIAL_TITLE_FONT` to a valid `.ttf` path on your system.
- **`tutorial:all` seems to hang waiting for the app**: check
  `pnpm --filter @revelation-srs/api dev` and
  `pnpm --filter @revelation-srs/portal dev` run cleanly on their own —
  `ensureStarted()` gives up after 90 seconds per app with a clear error.
