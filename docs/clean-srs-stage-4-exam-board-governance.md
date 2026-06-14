# Stage 4 — Exam Board and Record Governance Refactor

**Exit criterion:** "Board variation is workflow/flag configured; ratification and lock integrity remain service enforced."

**Status:** Complete — 271 integration tests pass (265 prior + 19 new = 271 total).

---

## What changed

### Feature flags (3 new, 1 wired)

| Flag key | Default | Purpose |
|---|---|---|
| `exam-board.virtual-board.enabled` | off | Enables async/virtual board workflow (no physical meeting required) |
| `exam-board.deferral.enabled` | off | Permits boards to be deferred to the next governance cycle |
| `exam-board.quorum.required` | off | Requires a quorum count to be recorded before ratification |
| `exam-board.external-examiner.required` | on | **Now wired** — was seeded in Stage 2 but the service guard in `ratifyBoard()` was hard-coded. Stage 4 makes it flag-controlled (fallback = true preserves existing UK statutory behaviour). |

All flags are boolean with `on`/`off` variants, seeded at system level with `default_variant_key = 'off'` (except `external-examiner.required` which defaults to `on`).

---

### Workflow definition

`exam-board-virtual` — asynchronous board workflow for distributed governance:

| Step | Type | Role |
|---|---|---|
| `board-constituted` | start | — |
| `data-pack-distributed` | human-task | registry-administrator |
| `async-member-review` | human-task | exam-board-member |
| `async-chair-review` | human-task | exam-board-chair |
| `external-examiner-async` | human-task | external-examiner |
| `gateway-concerns` (G01) | decision | — |
| `concerns-resolved` | human-task | exam-board-chair |
| `record-locked` | integration | — → `BoardService.ratifyBoard` |
| `end` | end | — |

`external-examiner-async` carries `flagGuard: exam-board.external-examiner.required` — when the flag is off, the step is skipped in async board operation.

---

### Schema additions — `exam_board` table

Four nullable columns added via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`:

| Column | Type | Semantics |
|---|---|---|
| `deferred_at` | `timestamptz` | Set when a board is deferred; NULL = not deferred |
| `deferral_reason` | `text` | Free-text reason for deferral |
| `quorum_count` | `integer` | Number of members recorded as attending/reviewing |
| `quorum_recorded_at` | `timestamptz` | When the quorum count was recorded |

Also: `CREATE INDEX exam_board_deferred_idx` on `(tenant_id, deferred_at) WHERE deferred_at IS NOT NULL`.

---

### Service changes — `BoardService`

**Three new public methods:**

- `deferBoard(examBoardId, tenantId, actorId, { reason? })` — checks `exam-board.deferral.enabled` flag (throws 422 if off); validates not already ratified/deferred; sets `deferred_at` and `deferral_reason`.
- `reopenBoard(examBoardId, tenantId, actorId)` — validates board is deferred and not ratified; clears `deferred_at` and `deferral_reason`.
- `recordQuorum(examBoardId, tenantId, memberCount, actorId)` — validates not ratified; sets `quorum_count` and `quorum_recorded_at`.

**`ratifyBoard()` guard additions (before existing lock logic):**

1. **Deferred guard** — throws 422 if `board.deferredAt` is set ("reopen it first").
2. **External-examiner guard** — now flag-controlled via `#evaluateBooleanFlag('exam-board.external-examiner.required', true)`. Fallback = true preserves UK statutory default.
3. **Quorum guard** — only active when `exam-board.quorum.required` flag is `on`; throws 422 if `quorum_count` is null.

**`ExamBoardDto`** extended with `deferredAt`, `deferralReason`, `quorumCount`, `quorumRecordedAt`.

**Constructor** takes optional `featureFlags?: FeatureFlagService` (5th argument); wired in `app.ts`.

**`#evaluateBooleanFlag(tenantId, flagKey, fallback)`** — shared private pattern; returns `fallback` if `featureFlags` is absent or flag not found; catches all errors.

---

### API routes (3 new)

All under `/api/v1/exam-boards/:boardId`:

| Method | Path | Permission | Action |
|---|---|---|---|
| `POST` | `/deferral` | `exam-board:write` | Defer a board |
| `DELETE` | `/deferral` | `exam-board:write` | Re-open a deferred board |
| `POST` | `/quorum` | `exam-board:ratify` | Record quorum count |

**`GET /exam-boards/:boardId`** now returns `deferredAt`, `deferralReason`, `quorumCount`, `quorumRecordedAt` in the response.

---

## Integration tests (`stage4-exam-board-governance.int.test.ts`)

19 tests across 5 describe blocks:

**Stage 4 feature flags (3 tests)**
- All three new flags exist and default to `off`.

**`exam-board-virtual` workflow definition (1 test)**
- Workflow is active; steps `data-pack-distributed`, `async-member-review`, `async-chair-review`, `external-examiner-async` exist; `async-chair-review` is owned by `exam-board-chair`.

**`exam-board.external-examiner.required` flag gate (2 tests)**
- Flag on (default): ratification blocked without signoff → 422.
- Flag off: ratification succeeds without signoff → 204.

**`exam-board.quorum.required` flag gate (4 tests)**
- Flag on, no quorum recorded → ratification blocked (422).
- Flag on, quorum recorded via `POST /quorum` → ratification succeeds (204); DTO shows `quorumCount = 5`.
- Flag off (default) → no quorum needed (204).
- Non-chair calling `POST /quorum` → 403.

**Board deferral (5 tests)**
- Flag off → `POST /deferral` returns 422.
- Flag on → deferral accepted (204); DTO shows `deferredAt` and `deferralReason`.
- Deferred board cannot be ratified → 422.
- Re-open via `DELETE /deferral` clears `deferredAt`; board can then be ratified.
- Non-deferred board cannot be re-opened → 422.

**Record lock integrity (4 tests)**
- Ratified board cannot be ratified again → 422.
- Ratified board cannot be deferred → 422.
- Quorum cannot be recorded on a ratified board → 422.
- Non-chair cannot ratify → 403.

---

## Exit criterion assessment

| Criterion | Evidence |
|---|---|
| Board variation is workflow/flag configured | `exam-board-virtual` workflow + 3 new flags for deferral, quorum, and virtual operation |
| Board operating model flag (`exam-board.operating-model`) configured | Done in Stage 3; `exam-board-school-led` and `exam-board-departmental-staged` workflows active |
| External examiner flag gate now controls the service guard | `ratifyBoard()` now checks `#evaluateBooleanFlag('exam-board.external-examiner.required', true)` |
| Ratification authority unchanged | `exam-board:ratify` permission required; 403 tested |
| Record lock integrity service-enforced | Lock writes in `ratifyBoard()` are inside a DB transaction; re-ratification, post-ratification deferral, and post-ratification quorum all rejected at service layer |

**Exit criterion met.**
