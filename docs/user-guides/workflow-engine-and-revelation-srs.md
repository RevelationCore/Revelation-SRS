# A Guide to the Workflow Engine and Revelation SRS

> Audience: architects and developers evaluating or extending Revelation SRS's
> approval and case-routing capabilities.
>
> Structure: Part 1 introduces workflow/orchestration engines as a general
> software concept. Part 2 describes, precisely and with explicit caveats
> about what's built versus designed, how Revelation SRS uses Temporal, walks
> one real workflow through every file involved, and closes with a
> hands-on walkthrough you can follow in the running application.

### In short: does Revelation SRS run a full production workflow?

**Partially, and by design — not by omission.** Every governed decision in
the codebase gets the full *data model* of a real workflow engine: a
versioned definition, a running instance, a task with a deadline and an
assignee, and an immutable decision audit. That model is real, enforced by
the database, and covered by tests. What it does **not** yet get is *live
Temporal execution* — no code path in the application today starts, signals,
or queries an actual running Temporal workflow process. The platform
services described in this guide call the same lifecycle methods a Temporal
activity would call, directly and synchronously from a REST handler, rather
than through Temporal's runtime.

So: the workflow **shape** — definition, instance, task, decision audit,
escalation policy, permission-gated human decisions — is production-grade
and used throughout the app today, right now, by nine different platform
services. The workflow **engine** underneath it — Temporal-managed durable
execution, crash-survival, and live timers — is deployed, configured, and
ready, but not yet wired into any of them. "The honest, important nuance"
below explains the exact mechanism, why it's a deliberate staged position
rather than a gap, and which ADRs govern it. If you'd rather see this than
read about it, "Try it yourself" near the end of this guide is a walkthrough
in the running app, and "Configuring a workflow" traces one real workflow
through every file behind it.

## Part 1 — Workflow engines as a concept

### What a workflow engine actually does

A workflow (or orchestration) engine exists to solve a problem that plain
application code handles badly: coordinating a **long-running process** that
has to survive the passage of real time, the restart of the server it's
running on, and a human being slow to respond.

Consider a simple approval: "assign this task to a manager; if they haven't
responded in five working days, escalate it." Written as ordinary code, this
either means holding a thread or a timer in memory for up to five days (which
dies the moment the process restarts), or building a bespoke poller that
scans a database table for overdue rows on a schedule (which works, but has
to be reinvented for every new process, and has no natural place to put the
process's *current step* other than another database column). A workflow
engine gives you that "wait, possibly for days, and resume exactly where you
left off even after a crash" primitive as a first-class, reusable building
block — called **durable execution**.

### Core vocabulary

Workflow engines in this family (Temporal, and similarly-shaped tools like
Camunda or AWS Step Functions) share a common vocabulary worth fixing before
looking at any specific system:

- **Workflow definition** — a reusable template for a process: its steps, who
  can do what at each step, and what happens if nobody does. Usually
  versioned, so an in-flight process started under an old definition doesn't
  get silently reinterpreted when the definition changes.
- **Workflow instance** — one specific running (or completed) execution of a
  definition, tied to a specific subject (an application, an enrolment, a
  submission).
- **Activity** — a single unreliable, real-world step a workflow performs:
  calling an external API, writing to a database, sending an email. Engines
  typically wrap activities with automatic retry-with-backoff, because the
  things activities talk to fail transiently far more often than the
  orchestration logic itself does.
- **Human task** — a step that waits for a person to make a decision. Modelled
  as the workflow pausing (often indefinitely, or until a deadline) for an
  external **signal** telling it to resume.
- **Signal** — an external message that resumes a paused workflow (e.g. "the
  manager approved this").
- **Query** — a way to read a running workflow's current state from outside,
  without disturbing or resuming it (e.g. "which step is this application
  currently on?").
- **Decision audit** — an immutable record of what was decided, by whom, and
  why, at a specific point in a process — the artefact that lets an
  institution reconstruct, months later, exactly how and why a governed
  decision was reached.
- **Escalation** — the defined fallback when a human task's deadline passes
  without a response: reassign it, notify someone else, or flag it for
  attention, rather than letting it silently vanish.

### Why regulated, multi-actor processes benefit from this shape

Universities run a lot of processes that are exactly this shape: a
statutory return that a regulatory officer must approve before submission, a
change to a student's registration that a personal tutor must sign off, an
application handoff between one system of record and another. Each involves
more than one actor, a real possibility of nobody responding in time, and a
genuine institutional need — often a regulatory one — to be able to show
*who decided what, when, and on what basis* long after the fact. Modelling
these as durable, auditable workflows rather than as ad hoc application code
buys three things at once: the process survives a deployment or a crash
mid-flight; a late responder gets escalated rather than silently ignored;
and the decision trail is a first-class, queryable record rather than
something reconstructed after the fact from scattered log lines.

### The equally important counterpoint: not everything needs one

It's just as important, and much less commonly said, that **not every
governed, auditable decision needs a general-purpose workflow engine**. A
process that is really a single evolving academic or administrative fact —
one case, with evidence accumulating and one qualified person eventually
making a determination — is often better served by a purpose-built case
model with its own decision and evidence tables than by a generic multi-actor
routing engine. The workflow-engine shape earns its complexity when a process
is fundamentally about *routing work between actors with deadlines and
escalation*; a well-designed system should use it there and deliberately not
force-fit it everywhere else. Part 2 shows Revelation SRS drawing exactly
this line.

---

## Part 2 — How Revelation SRS uses Temporal

### The chosen engine, and why

Revelation SRS selected **Temporal** (`packages/workflow` depends on
`@temporalio/client`, `@temporalio/worker`, and `@temporalio/workflow`) as
its designated durable-execution engine, recorded in
`docs/decisions/ADR-005-workflow-engine.md`. Temporal was chosen over
BPMN/XML-centric engines (Flowable, Activiti), a SaaS-licensed alternative
(Camunda 8), and a non-self-hostable option (AWS Step Functions), on the
strength of: workflows and activities written as ordinary, testable
TypeScript rather than XML; deterministic replay for crash recovery; built-in
activity retry with backoff; native signal/query support for human tasks;
durable, crash-proof timers for deadline enforcement; an operational UI; and
an MIT-licensed, self-hostable server.

Temporal's own infrastructure is fully deployed: `infra/compose/docker-compose.yml`
runs a `temporalio/auto-setup` server container backed by the same
PostgreSQL cluster the application uses (in its own schema) and a
`temporalio/ui` container exposed locally at `http://localhost:8233`.
`docs/architecture/deployment-architecture.md` positions Temporal Server
(backed by PostgreSQL) as a platform service in both the single-institution
and Kubernetes/multi-institution production topologies, and the API's
`/ready` health check includes a Temporal-worker readiness condition.

### The relational workflow model — `packages/db/src/schema/platform-workflow.ts`

Before looking at the Temporal-specific code, it's worth understanding the
relational schema underneath it, because — as the next section explains —
this is the part of the model application code actually talks to today.

**Definition (the reusable template):**

- `workflow_definition` — a named, owned process (`definitionCode`,
  `ownerModuleCode`, current version). A `null` tenant ID marks a
  platform-shipped definition available to every tenant.
- `workflow_definition_version` — the versioned body: process steps,
  transitions, an escalation policy, all captured as structured JSON.
- `workflow_step` / `workflow_transition` / `workflow_decision_gateway` — the
  individual steps, the edges between them, and named decision points within
  a version.
- `workflow_assignment_rule` — *who* gets a given human-task step, resolved by
  matching role, organisational unit, programme, or source-system criteria
  against a priority-ordered rule set, rather than being hard-coded into
  workflow logic.
- `workflow_trigger_rule` — maps a domain event type to a workflow it should
  start, per tenant/environment.

**Instance (one running case):**

- `workflow_instance` — one execution: what it's about (`subjectEntityType`/
  `subjectEntityId`), who started it, its status, and a free-form context
  snapshot.
- `workflow_task` — one unit of human work within an instance: step, type,
  status, assignee (actor or role), due date, and completion payload.
- `workflow_decision_audit` — an immutable record of a decision made at a
  named gateway: who, what was decided, and why.

This definition/instance/task/decision-audit separation is the same
vocabulary introduced in Part 1, made concrete: it is possible to inspect,
independently of any Temporal process being alive, exactly what a workflow
was configured to do and exactly what actually happened for a given case.

### The Temporal workflow definition itself

`packages/workflow/src/workflows/index.ts` contains exactly two workflow
functions — the entire set in the codebase:

- **`recordAuditWorkflow`** — a minimal wrapper that durably records a single
  audit event via a retried activity; described in code as a Phase 3
  scaffold.
- **`genericHumanTaskWorkflow`** — the substantive one, implementing exactly
  the human-task-with-escalation pattern from Part 1:
  1. Registers a `completeTask` **signal** and a `state` **query** before
     doing anything else, so external callers can always resume or inspect
     the workflow.
  2. Creates a `workflow_instance` row and writes a `workflow-started` audit
     event.
  3. Creates and assigns a `workflow_task` for the given step, computing a
     due date from an explicit deadline or a relative offset.
  4. Waits on `condition(() => completed, dueAfterMs)` — Temporal's durable,
     crash-proof wait-with-timeout. If no deadline is given, it waits
     indefinitely.
  5. **If the deadline passes first**: escalates the task
     (`reasonCode: 'deadline-expired'`) and ends — the workflow never reaches
     completion.
  6. **If the signal arrives in time**: completes the task, records a
     decision at a `"<stepKey>:completion"` gateway (note: the generic
     workflow always records this as `decisionCode: 'approved'` — it has no
     concept of "reject," only "completed in time or not"; a real
     approve/reject decision is recorded separately by the calling platform
     service), and completes the instance.

Both activity groups the workflow calls (`recordWorkflowEvent`, and the six
workflow-lifecycle activities) are configured with a 30-second
start-to-close timeout and up to 3 retry attempts — the concrete expression
of "activities are unreliable and get retried automatically."

### The activities implementation — `WorkflowBridgeService`

`apps/api/src/platform/platform-controls/workflow-bridge-service.ts`
implements the six workflow-lifecycle activities Temporal would call
(`startWorkflowInstance`, `assignWorkflowTask`, `completeWorkflowTask`,
`escalateWorkflowTask`, `recordWorkflowDecision`, `completeWorkflowInstance`).
For each one, the pattern is the same: a tenant-scoped write to the
`workflow_instance`/`workflow_task`/`workflow_decision_audit` tables, a NATS
domain event published if the event bus is connected
(`srs.workflow.task-assigned`, `.task-completed`, `.task-escalated`,
`.decision-recorded`, `.completed`), and a durable audit-trail entry.

### The honest, important nuance: how this actually runs today

This is the fact most worth stating plainly, because the infrastructure
above could easily be read as implying more than is currently true.

**No code path in `apps/api` currently starts, signals, or queries a live
Temporal workflow.** Instead, the nine platform services below are
constructed with a `WorkflowBridgeService` instance and call its methods
**directly, synchronously, inside their own HTTP request handlers** — the
same calls `genericHumanTaskWorkflow`'s activities would make, but with no
Temporal orchestration actually running in between. Starting a "workflow"
means calling `startWorkflowInstance` + `assignWorkflowTask` directly;
completing one means calling `completeWorkflowTask` + `recordWorkflowDecision`
+ `completeWorkflowInstance` directly, from an authenticated REST endpoint —
not sending a signal to a paused Temporal process.

This is a **deliberate, documented, staged position**, not an oversight.
`docs/decisions/ADR-015-workflow-feature-flags-and-environment-promotion.md`
states it directly: "Temporal remains the durable execution engine, but
SRS-owned relational workflow records provide the inspectable configuration,
task, decision, and audit surface." `docs/architecture/module-selection-rules.md`
is equally explicit about one specific workflow: "not a bespoke Temporal
workflow (no Temporal worker/client actually runs in this codebase today —
see `WorkflowBridgeService`)." The practical effect is that Revelation SRS
gets the *data model and auditability* of a workflow engine everywhere,
today, while the live Temporal execution — and the crash-survival and
durable-timer guarantees that come with actually running through it — is
designed for and will be progressively wired in per ADR-016, not yet
exercised end-to-end. No test in the repository (as of this guide) starts a
real or simulated Temporal workflow, kills a worker mid-flight, or fires a
due-date timer to observe an escalation; the existing test coverage verifies
the relational model's shape and the Task Inbox's permission behaviour, not
Temporal's runtime guarantees in this codebase specifically. Those
guarantees are real properties of Temporal as a platform — just not yet
properties this codebase's own tests demonstrate, because nothing here runs
through it live yet.

### Who calls the workflow bridge today

Nine platform services in `apps/api/src/platform/` construct and call
`WorkflowBridgeService` directly:

| Service | What the human task gates | Assignee role |
|---|---|---|
| Module registration | A tutor approving/rejecting a portal-initiated module registration or withdrawal request | `personal-tutor` |
| Student identity | A tutor approving a change to legally significant identity data (gender, nationality) | `personal-tutor` |
| Module selection | A programme approver handling a selection proposal that failed automatic validation (e.g. capacity) | `programme-approver` |
| Admissions | A registry administrator handling the handoff from a confirmed application to enrolment, across all five admission routes (UCAS, direct, international, agent, clearing) | `registry-administrator` |
| UKVI | Approving a batch CAS request submission | `regulatory-officer` |
| HESA | Approving the statutory student return | `regulatory-officer` |
| OfS | Approving the participation extract | `regulatory-officer` |
| SLC | Approving Student Loans Company confirmations | `regulatory-officer` |
| UCAS | Approving UCAS confirmations | `regulatory-officer` |

### Configuring a workflow: a worked example

Take the first row of that table — `module-registration-change-approval` —
and trace it through every file involved, from its declared configuration to
the code that runs it to the screens a student and a decision-maker actually
use. Nothing here is illustrative; every path and identifier below is real.

**1. The definition, its steps, and its decision gateway are declared in a
migration — `packages/db/migrations/0007_module_registration_change_workflow.sql`.**
Revelation SRS has no admin UI for authoring workflow definitions yet — they're
declared as governed reference data, the same way a value set or an academic
rule is. This one migration:

- inserts into `workflow_definition` — registers the code
  `module-registration-change-approval`, owned by the `registration` module;
- inserts into `workflow_definition_version` — version 1, with a
  `definition_json` blob naming the decision step key and its audit table;
- inserts into `workflow_step` — four steps in order: `request-submitted`
  (`start`) → `approve-or-reject-registration-change` (`human-task`, owner
  role `personal-tutor`) → `decision-gateway` (`decision`) →
  `request-closed` (`end`);
- inserts into `workflow_decision_gateway` — gateway `G01`, "Approve or
  reject the registration change?", with its own `source_reference` pointing
  back at this migration file, so the catalogue is self-documenting about
  where a gateway was defined.

One honest gap worth naming here: this migration does **not** insert a row
into `workflow_assignment_rule`. The `personal-tutor` assignee is instead
hard-coded directly in the calling TypeScript (next step) rather than
resolved from the rules table at runtime. Contrast this with the older,
catalogue-only "Stage 2" workflow definitions seeded in
`packages/db/migrations/0001_platform_hardening_and_refinements.sql`, which
*do* populate `workflow_assignment_rule` fully (role, priority, per-step) —
those are more completely configured as data, but (per the honest nuance
below) have no live caller at all. `module-registration-change-approval` is
the reverse: it's the one nine real services actually call, but its own
assignment logic is simpler than the data model supports. Both facts are
worth knowing before assuming either "the catalogue" or "what's wired up"
alone tells the whole story.

**2. An instance actually starts in application code —
`apps/api/src/platform/registration/service.ts`.** `ModuleRegistrationService`
holds a `CHANGE_WORKFLOW_CODE = 'module-registration-change-approval'`
constant. When a student calls `requestRegistration` or `requestWithdrawal`,
the service calls `this.workflowBridge.startWorkflowInstance(...)` followed
by `this.workflowBridge.assignWorkflowTask({ stepKey:
'approve-or-reject-registration-change', assigneeRoleCode: 'personal-tutor',
... })` — directly, synchronously, inside the request handler.

**3. The decision is recorded through a dedicated endpoint —
`apps/api/src/routes/module-registrations.ts`.** `POST
/module-registrations/:workflowInstanceId/decision`, gated by
`requirePermission('module-registration:decide')`, calls
`ModuleRegistrationService#decideChangeRequest`, which records the *actual*
decision code (`approved`/`rejected`), completes the task and instance, and —
only if approved — re-runs the same validated registration/withdrawal logic
staff use directly.

**4. The permission is declared once, centrally —
`packages/domain/src/permissions.ts`.**
`'module-registration:decide': ['registry-administrator', 'personal-tutor']`
— both roles can decide; there's no separate permission for "my own
students" versus "any student."

**5. The decision-maker's screen —
`apps/admin/src/pages/ModuleRegistrationRequestsPage.tsx`,** registered at
`/module-registration-requests` in `apps/admin/src/App.tsx` and surfaced as
the **Registration requests** sidebar entry in
`apps/admin/src/components/Layout.tsx` (visible only to roles holding
`module-registration:decide`). It lists pending requests and offers
**Decide → Approve / Reject** with an optional free-text reason.

**6. The screen that starts it all —
`apps/portal/src/pages/ModulesPage.tsx`,** calling `requestWithdrawal` /
`requestRegistration` in `apps/portal/src/api/me.ts`. A student sees a
**Withdraw** button on an active registration; confirming it is what fires
step 2 above.

#### If you were adding a new workflow, the same six steps apply

1. Pick a `definitionCode` and write a migration inserting
   `workflow_definition` / `workflow_definition_version` / `workflow_step` /
   `workflow_decision_gateway` — and, if you want assignee resolution to be
   genuinely data-driven rather than hard-coded, `workflow_assignment_rule`
   rows too (see the fully-populated Stage 2 pattern in
   `0001_platform_hardening_and_refinements.sql` for the shape to copy).
2. Construct a `WorkflowBridgeService` in the owning platform service's
   constructor (follow `registration/service.ts` as the template).
3. Call `startWorkflowInstance` + `assignWorkflowTask` with your
   `workflowCode` at the point the process begins.
4. Add a decision endpoint — or, if the decision genuinely is just "done or
   not done" with no approve/reject distinction, let the generic Task Inbox
   handle it instead — that calls `completeWorkflowTask` +
   `recordWorkflowDecision` + `completeWorkflowInstance` with the real
   decision code, then performs the resulting domain mutation.
5. Grant the deciding role a permission in
   `packages/domain/src/permissions.ts` and gate the route with it.
6. Add a purpose-built admin page if the decision needs more than "done"
   (recommended whenever there's a real approve/reject distinction);
   otherwise the generic Task Inbox already lists it for free.
7. Add the new definition code to the expected catalogue in
   `apps/api/test/workflow-coverage.int.test.ts`, so CI keeps verifying its
   shape — start/end step, an assignment rule per human-task step, an
   escalation policy — stays complete.

### The Task Inbox, and why most decisions bypass it

`apps/admin/src/pages/TaskInboxPage.tsx` gives staff a cross-process view of
outstanding work: a filterable list of `workflow_task` rows (by status), each
showing its step, assignee role, and due date, with a two-step confirm
"Complete" action. Access is permission-scoped server-side — a caller with
only their own role's assignment sees just their queue; `workflow:read`
sees everything. Completing a task there additionally checks that the caller
*is* the task's assignee (actor or role), via
`WorkflowResponsibilityService.assertCanCompleteTask`.

But the generic "Complete" action only closes a task with an opaque payload
— it has no concept of *approve versus reject*, or of what domain
consequence should follow. Any decision that needs to trigger a typed
business outcome is instead surfaced through a **purpose-built admin page**.
The module-registration flow is the clearest worked example: a student
requests a change → `ModuleRegistrationService` starts a `workflow_instance`
and assigns a task to the `personal-tutor` role → the task is visible both in
the generic Task Inbox and in a dedicated **Registration requests** page →
the tutor approves or rejects there, with a reason → `decideChangeRequest`
records the *actual* decision code (`approved`/`rejected`, not the generic
workflow's hardcoded `'approved'`), completes the task and instance, and —
only if approved — re-runs the same validated registration logic staff use
directly, because the underlying state may have drifted since the request
was submitted. The Task Inbox, in this design, functions as a cross-cutting
"what's outstanding and assigned to me" surface, not as the primary way
business-critical decisions actually get made.

### When Revelation SRS deliberately does *not* use this pattern

This is the Part 1 counterpoint made concrete, and it is just as
deliberately documented as the workflow-bridge pattern itself.
`docs/decisions/ADR-016-authoritative-business-state-and-workflow-separation.md`
draws the boundary: authoritative academic and regulatory facts (and their
full bitemporal history) live in domain tables; Temporal-shaped workflow
records hold *case state* — tasks, evidence references, gates, deadlines,
decisions — but are never the system of record for the underlying facts.

Where a process is really a single evolving case rather than multi-actor
routing, Revelation SRS uses a shared **`business_case`** primitive instead
(`packages/db/src/schema/business-case.ts`) — a bitemporal case shell plus
append-only `case_evidence_reference`, `case_decision`,
`source_version_reference`, and `distribution_item` tables. Confirmed users
of this pattern include identity resolution, individual-rights (DSAR)
requests, post-ratification corrections, wellbeing support-outcome
distribution, audit review, and the PGR supervision/examination/completion
capability. `docs/decisions/ADR-023-pgr-supervision-and-examination-authority.md`
states the rationale as clearly as it appears anywhere in the codebase: PGR
governance is modelled on `business_case`/`case_decision`, "the same
primitive already used by identity resolution, rights requests, corrections,
support outcomes and audit review — **not as a new bespoke workflow engine
or a standalone module**" — reusing a proven shape instead of building a
fourth parallel case model. A third, even narrower pattern exists too:
assessment moderation uses its own small dedicated tables, using neither the
workflow bridge nor `business_case`, because it's a well-understood,
deterministic academic process that doesn't need generic case/evidence/
decision machinery at all.

The practical rule of thumb this leaves a developer with: reach for the
workflow-task model when a process is fundamentally about routing work
between multiple actors with deadlines and escalation; reach for
`business_case` when it's fundamentally one governed case accumulating
evidence toward a determination; and don't reach for either when a process
is narrow and deterministic enough to warrant its own small, purpose-built
schema.

### Running it locally

`docker compose up -d` (from `infra/compose/`, or with `-f
infra/compose/docker-compose.yml` from the repo root) starts the Temporal
server and UI alongside the rest of the stack; the UI is reachable at
`http://localhost:8233`. `packages/workflow/src/worker.ts` exposes a
`startWorker()` bootstrap and a directly-runnable entrypoint (`pnpm
--filter @revelation-srs/workflow worker`), configured via `TEMPORAL_ADDRESS`,
`TEMPORAL_NAMESPACE` (intended to be per-tenant: `srs-{tenantId}`), and
`TEMPORAL_TASK_QUEUE` environment variables — ready for a domain service to
supply its own activity implementations and register a worker when its
workflows are progressively wired onto live Temporal execution.

### Try it yourself: walk the same workflow through the running app

This is `module-registration-change-approval` — the exact workflow traced
file-by-file above — end to end, in the standard demo environment, using two
of the project's existing demo personas. No special setup beyond the
project's normal local run is needed.

**Start the environment**

```bash
pnpm evaluate
```

This provisions the default `module-selection` scenario and prints both
application URLs — the student portal and the admin console.

**1. As the student — submit a withdrawal request**

1. Open the student portal at `http://localhost:5174` and sign in as
   `alice.demo` / `Demo-2026!`.
2. Go to **My modules**.
3. Find a module registered with status "Registered" and click **Withdraw**.
4. Confirm: "Withdraw from this module?" → click **Confirm**.
5. A **Pending requests** card appears at the top of the page: "Withdrawal
   request — Submitted [today]." That's a new `workflow_instance`, sitting
   at the `approve-or-reject-registration-change` step, with a
   `workflow_task` assigned and waiting.

**2. As the decision-maker — approve or reject it**

1. Open the admin console at `http://localhost:5173` and sign in as
   `registry` / `Demo-2026!` — the `registry-administrator` role holds
   `module-registration:decide`, the same permission a `personal-tutor`
   persona would hold.
2. Go to **Registration requests** in the sidebar.
3. You'll see the withdrawal request: its type, the enrolment it belongs to,
   and when it was submitted.
4. Click **Decide**, optionally type a reason, then click **Approve** (or
   **Reject**, to see the other branch — nothing is destructive; the demo
   environment resets).

**3. Back as the student — see the outcome**

1. Return to the portal and refresh **My modules**.
2. The Pending requests card is gone. If you approved it, the module
   registration itself now shows as withdrawn; if you rejected it, the
   registration is unchanged, and the reason you entered is preserved on the
   decision-audit record described earlier in this guide.

**What you just exercised**: `startWorkflowInstance` + `assignWorkflowTask`
on submission, then `completeWorkflowTask` + `recordWorkflowDecision` +
`completeWorkflowInstance` on the admin decision — real `WorkflowBridgeService`
calls, writing real rows to `workflow_instance`, `workflow_task`, and
`workflow_decision_audit`, exactly as described earlier in this guide. What
you did *not* just exercise is a live Temporal process: as "the honest,
important nuance" explained, this flow runs entirely through direct,
synchronous calls today, not through Temporal's runtime. If you're curious,
the same task also appears in the generic **Task inbox** in the admin
sidebar — but, as "The Task Inbox" section explains, its own Complete action
can't drive this particular decision; the dedicated Registration requests
page is what actually resolves it.
