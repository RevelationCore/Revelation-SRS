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

**Yes, for two workflow families, once a deployment turns it on.** Every
governed decision in the codebase gets the full *data model* of a workflow
engine: a versioned definition, a running instance, a task with a deadline
and an assignee, and an immutable decision audit. Since November 2026
([ADR-024](../decisions/ADR-024-live-temporal-execution.md)), two families can
also run on **live Temporal execution**, with durable waiting, deadline
timers that survive restarts, and retries that are safe to repeat:

- reviews authored in the admin workflow builder, and
- module registration change requests (`module-registration-change-approval`).

Live execution is **off by default**. A deployment enables it with
`TEMPORAL_EXECUTION_ENABLED=true` and a running worker, then the
`workflow.temporal-execution` feature flag chooses which tenants and workflow
versions use it for *new* reviews. Every other workflow family — module
selection, legal identity change, admissions and the five regulatory
submissions — still runs on the original in-process path, where the API calls
the workflow lifecycle methods directly and synchronously. "Two execution
paths" below explains both, and "Try it yourself" near the end walks through
the app.

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

Locally, `infra/compose/docker-compose.yml` runs the official Temporal dev
server (`temporalio/temporal:1.10.0`, which bundles Server 1.32.2 and the Web UI
at `http://localhost:8233`), with its data on a named volume so waiting
workflows survive a restart. Production uses `temporalio/server:1.32.2`
backed by PostgreSQL (`infra/k8s/base/temporal.yaml`). The SDK is pinned at
1.25.0. The API's `/ready` reports Temporal but does not fail because of it,
so staff can keep using records during a workflow outage.

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

`packages/workflow/src/workflows/index.ts` contains two workflow functions:

- **`recordAuditWorkflow`** — a minimal wrapper that durably records a single
  audit event via a retried activity.
- **`reviewWorkflow`** — the review workflow (execution contract version 1,
  defined in `packages/workflow/src/contracts/review.ts`):
  1. Starts with the IDs of a `workflow_instance` and `workflow_task` that the
     API has already saved, the task's persisted deadline (`dueAt`), and the
     escalation role, if any.
  2. Registers a `submitReviewCommand` **update**, a `reviewCommandSubmitted`
     **signal** and a `reviewState` **query**. Updates and signals carry only
     a command ID; the decision itself is loaded from the database.
  3. Waits for a command, or for the deadline. If the deadline has already
     passed when it starts or resumes, it escalates straight away.
  4. **At the deadline**: reassigns the task to the escalation role, or, if
     there is none, flags it **Needs attention**. Either way it **keeps
     waiting** for a decision; nothing is approved automatically. A decision
     accepted on or before the deadline wins over the timer.
  5. **For each command**, one at a time: applies it through the
     `applyReviewCommand` activity, which records the *actual* outcome
     (approved, rejected, or any configured code), closes the task and
     instance, and runs any business change (see the registration pilot).
     If a business rule blocks the change, the decision is kept, the task
     reopens, and the workflow waits for a new decision.

Activities retry with backoff until they succeed. That is safe because each
one commits its change together with an operation receipt, so a retry after a
crash returns the first result instead of repeating it. Business-rule failures
are returned as outcomes rather than thrown, so they never retry forever.

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

### Two execution paths

Each `workflow_instance` records which path it runs on, in
`execution_backend`. The choice is made when the review starts and never
changes.

**Temporal path** (`execution_backend = 'temporal'`):

1. *Start.* The API saves the instance and its task in one transaction, with
   the deadline resolved once from the database clock. It then starts the
   Temporal execution under a stable ID (`srs:<environment>:<tenant>:<instance>`).
   If Temporal is unreachable, the review is saved with status **Starting**,
   and the reconciler starts it later.
2. *Decide.* The API saves the decision as a `workflow_command` row (one per
   task revision, so a second or conflicting decision is refused), then
   delivers it by Temporal Update and waits briefly for the outcome. The user
   normally gets the applied result (`200`). If the worker is down, the user
   gets `202 Accepted`; the decision is saved, and the reconciler delivers it
   when the worker is back.
3. *Apply.* The worker applies the command, its audit trail and its events in
   one transaction. Events go to `workflow_event_outbox` and are published
   to NATS from there, so a NATS outage no longer loses them.

The worker is `apps/api/src/worker.ts`. It builds the same service graph as
the API, runs the review workflows and their activities, and every 15 seconds
runs the reconciler (`workflow-reconciler.ts`), which starts saved reviews,
re-delivers saved decisions and publishes saved events. It is safe to run
on several replicas.

**Legacy path** (`execution_backend = 'legacy'`: any instance started without
the rollout flag): the platform services below call `WorkflowBridgeService`
synchronously inside their HTTP handlers. Starting a "workflow" means calling
`startWorkflowInstance` + `assignWorkflowTask`. Deciding applies the business
change first, then calls `recordWorkflowDecision` + `completeWorkflowTask` +
`completeWorkflowInstance`, so a change that fails leaves the request open.
Since Stage 6a (16 November 2026) every family below goes through
`GovernedReview` (`platform-controls/governed-review.ts`), which picks the
backend per instance. On Temporal, the same change runs as a worker effect.
Deadlines on this path are enforced only when something calls
`POST /workflow-tasks/sweep-overdue`. Legacy workflow events now also go
through the outbox.

Test coverage for the Temporal path runs against real Temporal servers, not
mocks: `packages/workflow/test/review-workflow.test.ts` uses the SDK's
time-skipping server (deadlines, escalation, replay determinism), and
`apps/api/test/temporal-execution.int.test.ts` runs the API, a real worker and
the pinned dev server image together (worker restarts, Temporal unreachable at
start, decisions during a worker outage, concurrent decisions, deadline races,
forged commands, and the registration pilot), and
`apps/api/test/temporal-stage6a.int.test.ts` covers the Stage 6a families.

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
migration — `packages/db/migrations/0000_baseline.sql` (section `0005_curriculum_regulatory_and_pgr` / `0007_module_registration_change_workflow`).**
`apps/admin/src/pages/WorkflowDefsPage.tsx` (**Workflows** under Tenant Admin,
`workflow:read`/`workflow:write`) lets an admin browse every definition, view
a version's steps, create a new definition *shell* (code, name, description),
enable/disable one, and manage assignment rules. For a bespoke definition
like this one — `ownerModuleCode: 'registration'`, with real hand-written
code reacting to its step key — that's as far as the UI (correctly) goes:
authoring its steps, transitions, or decision gateway is only possible
through a migration, the same way a value set or an academic rule is
governed reference data. ("Configuring a generic workflow instead," below,
covers the one category of workflow this restriction doesn't apply to.)
This migration:

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
`packages/db/migrations/0000_baseline.sql` (section `0001_platform_hardening_and_refinements`), which
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
   `0000_baseline.sql` (section `0001_platform_hardening_and_refinements`) for the shape to copy).
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

### Configuring a *generic* workflow instead — no migration required

The restriction above is real for the nine bespoke workflows, but it does
not apply to a narrower, genuinely useful case: a single-decision,
role-routed review with no bespoke side effect beyond recording the
decision — "flag this record for someone to look at, escalate if they
don't within N days, keep an audited record of what they decided." That
shape needs nothing a developer has to hand-write, and `WorkflowDefsPage`
can now author one end to end, no migration involved.

From **Workflows**, selecting a definition with `ownerModuleCode: 'custom'`
(the default for anything created through **New definition**) reveals a
**Configure step** action: step name, description, an assignee role, a
choice of outcome options (Approve/Reject, or a single "Mark complete"), an
optional due-after duration, and an optional escalate-to role. Saving calls
`POST /workflow-definitions/:id/versions`
(`apps/api/src/platform/platform-controls/workflow-builder-service.ts`),
which inserts exactly the same shape of rows the migration above does by
hand — a `start`/`human-task`/`end` `workflow_step` triple, a
`workflow_decision_gateway`, and (unlike `module-registration-change-approval`)
a real `workflow_assignment_rule` — then publishes it.

A new **Start a workflow** page (`apps/admin/src/pages/StartWorkflowPage.tsx`,
under Tenant Admin) lists every published generic workflow and lets any
`workflow:write` holder start an instance against any record by type and ID
— calling the pre-existing, already-generic `POST /workflow-instances`
endpoint (`platform-controls.ts:521`), which resolves the assignee from the
rule just created rather than needing one hard-coded anywhere. The resulting
task appears in the Task Inbox with real **Approve**/**Reject** buttons (or
whatever outcome labels were configured) instead of the plain "Complete"
confirmation — the completion endpoint now accepts an optional
`decisionCode`, validates it against the step's configured options, and
records a proper `workflow_decision_audit` entry, exactly like the bespoke
services already do.

**Deadlines.** On the Temporal path, the review's own durable timer enforces
the due date (from the step's `dueAfterHours`, resolved once at start) and
escalates to the configured role, or flags the task **Needs attention**. On
the legacy path, `POST /workflow-tasks/sweep-overdue`
(`workflow-escalation-service.ts`), meant to be called by an external
scheduler, reassigns overdue tasks once each. The sweep ignores Temporal-run
tasks, so a task never has two deadline owners.

**What this still doesn't do**, deliberately: a generic workflow is
single-step (no sequential chains — every real bespoke workflow in the app
is single-step too, so this matches, rather than falls short of, existing
practice), can't be triggered automatically by a domain event (a genuine
`workflow_trigger_rule` consumer would need a new safe condition-language
subsystem — real risk, not yet built), and can't perform a bespoke side
effect on approval — only record the decision. Reach for it when a process
is "route this to someone, on a deadline, with an audit trail"; reach for a
migration and real service code, as the six steps above show, when a
decision needs to actually *do* something beyond being recorded.

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
records the actual decision code (`approved`/`rejected`) and, if approved,
re-runs the same validated registration logic staff use directly, because
the underlying state may have drifted since the request was submitted. The
change is applied *before* the request is closed, so if it fails (window
closed, capacity gone, a duplicate) the request stays open and can be decided
again. On the Temporal path the worker applies the change, with a
registration ID derived from the decision so a retry cannot register twice,
and a failure reports "Decision recorded, but the registration change was not
applied". The Task Inbox, in this design, functions as a cross-cutting
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

`docker compose -f infra/compose/docker-compose.yml up -d` starts Temporal
(UI at `http://localhost:8233`, namespace `srs-local`) with the rest of the
stack. To use live execution:

```bash
# in .env
TEMPORAL_EXECUTION_ENABLED=true
TEMPORAL_NAMESPACE=srs-local
TEMPORAL_TASK_QUEUE=srs-workflows

pnpm --filter @revelation-srs/api dev       # API
pnpm --filter @revelation-srs/api worker    # worker (separate terminal)
pnpm --filter @revelation-srs/api workflow:smoke   # checks the worker is polling
```

Then turn on the `workflow.temporal-execution` flag for your tenant in
**Feature flags**. Reviews started after that run on Temporal; earlier ones
stay on the legacy path.

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

**What you just exercised**: real rows in `workflow_instance`,
`workflow_task` and `workflow_decision_audit`, written on the legacy path
unless you enabled live execution as described in "Running it locally". With
it enabled, the same flow runs on Temporal: open the Temporal UI, find the
workflow `srs:<environment>:<tenant>:<instance>`, and you can watch the
review wait, receive the decision as an Update, and complete. If you're curious,
the same task also appears in the generic **Task inbox** in the admin
sidebar — but, as "The Task Inbox" section explains, its own Complete action
can't drive this particular decision; the dedicated Registration requests
page is what actually resolves it.

**A second, shorter thing worth trying**: as `tenant-administrator`, go to
**Workflows**, click **New definition**, then **Configure step** to author
a single-step review (an assignee role, Approve/Reject outcomes, a due-after
duration, an escalation role) and save — this publishes immediately. Go to
**Start a workflow**, pick it, and start an instance against any subject
type/ID you like. It now behaves exactly like the module-registration flow
above — same Task Inbox, same typed decision, same audit trail — except you
configured it yourself, from the UI, in under a minute, with no migration
and no code. See "Configuring a generic workflow instead" earlier in this
guide for exactly what's happening underneath.
