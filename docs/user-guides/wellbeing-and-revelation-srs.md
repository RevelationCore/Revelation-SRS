# A Guide to Wellbeing and Revelation SRS

> Audience: institutional wellbeing/disability service leads, product owners, and
> developers evaluating or extending the `modules/wellbeing` capability.
>
> Structure: Part 1 introduces wellbeing as a UK higher-education institutional
> capability, independent of any particular system. Part 2 describes, precisely
> and without overclaiming, how Revelation SRS implements it today.

## Part 1 — Wellbeing as an institutional capability

### What "wellbeing" means in a student records context

In a UK higher education institution, "wellbeing" is an umbrella term for a
cluster of student-support functions that are related but legally and
operationally distinct:

- **Disability support** — assessing a declared or evidenced disability,
  agreeing a support plan, and administering the Disabled Students' Allowance
  (DSA) or an institution's own equivalent funding.
- **Reasonable adjustments** — the specific, actionable changes to teaching,
  assessment, or the physical/digital environment that flow from a disability
  support plan: extra time in exams, a separate room, rest breaks, a reader or
  scribe, extended coursework deadlines, accessible formats.
- **Extenuating (or "exceptional") circumstances** — a claim that a specific,
  time-bounded event (illness, bereavement, a family crisis) affected a
  student's ability to complete or perform in a specific assessment, considered
  by exam boards alongside — but kept administratively separate from — the raw
  mark.
- **Mental health and counselling** — clinical or quasi-clinical support:
  triage, risk assessment, counselling sessions, referral to external NHS or
  third-sector services, and crisis response.
- **Early intervention and safeguarding referral** — spotting a student at risk
  before they ask for help, typically via engagement/attendance monitoring,
  tutor concern, or a partner system (e.g. a UKVI compliance alert), and
  triaging it into the right specialist service.

These functions share a common shape — a *case* opens, evidence accumulates, a
qualified person makes a determination, and an outcome is applied — but they
differ sharply in **sensitivity** and in **who is allowed to know what**. A
personal tutor may legitimately need to know that a student has an active
reasonable-adjustment for extra time; they have no legitimate need to know the
clinical content of a counselling session that led to it. Designing wellbeing
support well is as much about drawing those boundaries correctly as it is about
the casework itself.

### The regulatory and legal framework

A UK HE wellbeing capability sits inside a specific legal frame, and the
shape of any credible system follows from it:

- **Equality Act 2010** creates an *anticipatory* duty to make reasonable
  adjustments for disabled students — not just a reactive one triggered by a
  complaint. Institutions must be able to show they identified likely barriers
  and acted, and must be able to reconstruct, retrospectively, what adjustment
  was in force on a given date (e.g. when defending an appeal or a tribunal
  claim).
- **UK GDPR Article 9** classifies health data — including disability and
  mental-health information — as "special category" data, requiring an
  explicit lawful basis and materially stricter access control than ordinary
  student records.
- **DSA (Disabled Students' Allowance)**, administered by Student Finance
  England/Wales/Scotland/NI, funds equipment, specialist mentoring, and
  non-medical helper support against a needs assessment; institutions must be
  able to evidence what was awarded and administer it correctly.
- **Office for Students (OfS) condition B3** (and equivalent bodies in the
  devolved nations) holds institutions accountable for consistent, fair
  extenuating-circumstances outcomes — an EC claim that never gets a documented
  determination, or one applied inconsistently across cohorts, is a
  regulatory as well as a student-experience problem.
- **Safeguarding duties** occasionally require information to flow *against*
  the general confidentiality default — a disclosed risk to life overrides a
  student's wish for confidentiality — but that exception must be narrow,
  documented, and auditable, not a general licence for wellbeing data to leak
  into other systems.

### The "minimum necessary" principle

The single most important design principle threaded through all of this is
**minimum necessary disclosure**: every other system in the institution —
the core student record, an exam board, a personal tutor's dashboard — should
see only the *administrative fact* that follows from a wellbeing case (an
adjustment code, an EC determination, a disability declaration flag), never
the clinical or personal narrative that produced it. A well-designed wellbeing
capability is judged as much by what it *doesn't* expose outside its own
boundary as by what it does.

---

## Part 2 — How Revelation SRS supports wellbeing delivery

### Architecture: a separately-deployed module, not a feature of the core

Revelation SRS implements wellbeing as `modules/wellbeing` — a **separately
deployable Fastify service with its own PostgreSQL database**, distinct from
`apps/api`'s core student-records database. This is a direct, structural
answer to the minimum-necessary principle above: special-category wellbeing
data physically cannot leak into the core record through a query bug or an
over-broad join, because it isn't in the same database. The module has its
own JWT-issued auth (Keycloak-backed, same as core SRS) and its own
role/permission checks, and talks to core SRS only over an explicit HTTP
handoff contract or NATS JetStream domain events — never a shared connection.

Every wellbeing sub-capability hangs off a shared `wellbeing_case` shell
record (`modules/wellbeing/src/db/schema/wellbeing-case.ts`) — one row per
student engagement with the service, carrying a case reference, an assigned
advisor, a lawful-basis code, a data-classification code, and a retention due
date. Disability, adjustment, EC, and mental-health records each reference a
`wellbeingCaseId`, giving a single point from which a student's whole
wellbeing engagement history can be assembled, retained, or exported —
without merging the underlying specialist tables into one undifferentiated
blob.

The module also maintains an `srs_context_projection` — a mutable, replayed
read-model, one row per student, built from consuming core-SRS domain events
(enrolment status, active modules, latest marks). This lets the module answer
"is this still an active enrolment" without ever calling back into core SRS
synchronously, and — just as importantly — this projection is explicitly
documented as "never published in SRS events," so it can't accidentally
become a backdoor channel for wellbeing-derived data to leak outward.

### Reasonable adjustments — the production-hardened capability

Reasonable adjustments is the most fully built-out sub-capability, and is
worth describing in depth as the reference pattern for the others.

**Case lifecycle.** An `adjustment_case` moves through an explicitly enforced
state machine (`modules/wellbeing/src/repositories/adjustment-case-repository.ts`):
`referral_received` → `assessment_pending`/`under_assessment` →
`determination_made` → (optionally) `under_review` (panel escalation) →
`approved`/`rejected` → `closed`. Illegal transitions are rejected outright
(`IllegalStatusTransitionError`); a same-status "self-loop" is always
permitted (harmless re-saves shouldn't be treated as a workflow violation).
Named action endpoints (`/start-assessment`, `/request-review`, `/close`)
replace what was originally a free-form status field, so a case can no longer
be pushed into an invalid state by a malformed request.

**Approval requires a real determination.** `/approve` is gated by a
precondition check — it returns `409 Conflict` unless a recommending
assessment or an upheld/modified panel decision actually exists for the case.
This closes what would otherwise be a significant governance gap: an approval
recorded with nothing behind it.

**Evidence and document management.** Medical letters, educational
psychologist reports, and other supporting evidence are stored via
`packages/documents` — a shared library (not a separate service) providing a
`DocumentStorageAdapter` interface with a default PostgreSQL-bytea
implementation. Every stored document is SHA-256 checksummed on write, every
read/write is recorded in an access log, and deletion is soft (the row and
its audit trail survive; the content does not). The wellbeing module installs
this library's tables into its **own** database — evidence never touches
core SRS's storage. Evidence attaches to a case through a dedicated
`adjustment_case_evidence` table and upload/download/delete endpoints
(multipart upload via `@fastify/multipart`).

**Own-record authorisation.** A student's JWT can only create a case, add
evidence to, or read the status of a case that is actually theirs — enforced
by matching the case's `personId` against `request.user.srsPersonId` (never
against the Keycloak `sub`, which identifies the account, not the student
record). Staff roles are granted broader access explicitly through
permissions rather than by the absence of a check.

**Self-service without opaque IDs.** A student requesting an adjustment for
the first time has no reason to know their own wellbeing case ID — the portal
resolves or auto-creates the underlying disability-support case for them
(`resolveDisabilityCaseForPerson`), so the request flow reads as "tell us what
you need," not "supply a case reference."

**Staff-side triage and case management.** A dedicated admin page
(`apps/admin/src/pages/AdjustmentCasesPage.tsx` and
`AdjustmentCaseDetailPage.tsx`, under **Governance → Adjustment cases**) gives
wellbeing advisors, specialist assessors, and panel chairs a cross-student
queue — filterable by status — plus a full case detail view: assessment
recording, panel-decision recording, evidence upload/download, and the
approve/reject actions, with the 409 precondition surfaced as a plain-language
message rather than a raw error. This is a deliberate departure from how most
of Revelation SRS's other approval flows work: rather than routing through the
generic, core-hosted Task Inbox (the pattern used by module-registration and
identity-change approvals — see *A Guide to the Workflow Engine and Revelation
SRS*), the admin app talks to the wellbeing module's API **directly**. Case
work belongs structurally to the module that owns it; core SRS should keep
seeing only the minimum-necessary outcome once a decision is made, exactly as
it does for every other consumer of wellbeing data.

**Distribution to core SRS.** On approval, the wellbeing module hands off to
core SRS's own bitemporal `reasonable_adjustment` record via an HTTP contract
(`srs/srs-adjustment-client.ts`), backed by a transactional outbox
(`srs_handoff_outbox`) with an idempotency key — the approve action can be
retried without ever creating a duplicate submission. Core SRS's
`reasonable_adjustment` record carries a `source_case_id` field: a genuine,
traceable (if opaque — the two services keep separate databases, so this is
not a foreign key) link back to the wellbeing case that produced it,
distinguishing a module-originated adjustment from one a registry
administrator recorded directly and manually. An **outcome document** can
also be attached to the core-SRS record itself (a distilled explanation of
what the adjustment code means for a specific student — e.g. "extra time: 25%,
due to X" — deliberately duplicated into core SRS's own `packages/documents`
installation rather than proxied cross-service, so the two systems' document
stores stay operationally independent). The one thing that never crosses this
boundary is clinical narrative: core SRS receives an adjustment type, a scope,
a validity period, and an optional outcome document — never a diagnosis, a
session note, or the underlying assessment report.

### Disability support and DSA

`disability_support_case` (bitemporal — every change to status or support-plan
state is preserved as a new version, never overwritten) tracks a student's
disability-support engagement: assessment status, support-plan status, and,
where relevant, a DSA award reference. A linked `dsa_entitlement` table
records the specific items awarded under DSA (equipment, a support worker, a
non-medical helper, specialist mentoring), each independently effective-dated,
since entitlements are added, reassessed, and expired at different times over
a student's course. Supporting evidence is tracked as metadata only
(`evidence_reference` — type, status, and an EDRMS reference) on the design
assumption that the binary content lives in an institution's existing
records-management system; the reasonable-adjustments capability above shows
the alternative, in-house storage path (`packages/documents`) for
institutions that don't have — or don't want to depend on — an external
EDRMS.

### Extenuating (exceptional) circumstances

An `ec_claim` (bitemporal) captures a single circumstances claim against a
specific assessment period and the module codes it affects, moving through
`submitted` → `evidence_pending`/`under_review` → `upheld`/`not_upheld` →
`closed`. Evidence review (`ec_evidence_review`) and the final determination
(`ec_determination` — outcome, authorising officer, per-module outcomes) are
kept as separate, append-only records, so an appeal or a second determination
round doesn't overwrite the first: the full decision history survives, which
is exactly what OfS condition B3 accountability and an internal appeal both
require. Two domain events — `exceptional-circumstances-flagged.v1` and
`exceptional-circumstances-updated.v1` — carry only the administrative fact
(a flag exists, its status changed) outward to core SRS and any exam-board
tooling, never the underlying narrative the student submitted.

### Mental health and early intervention

`mental_health_case` is explicitly documented in code as "highly sensitive
special-category health data," access-restricted to the
`wellbeing-mental-health-advisor` role and never exposed to general wellbeing
advisors. It tracks a presenting-concern code, a risk-level code (`low` /
`medium` / `high` / `crisis`), and an embedded consent record. A linked
`intervention_plan` tracks the practical support agreed — counselling,
crisis support, signposting, peer support — including whether the referral is
external (outside the institution). Session notes are stored in a dedicated,
append-only table with a code comment stating plainly that their content
"must never appear in NATS events, SRS APIs, or aggregate reporting
responses" — the clearest statement in the codebase of the
minimum-necessary principle in Part 1.

**Early warning alerts** (`early_warning_alert`) provide the triage entry
point for early intervention: an append-only record of an inbound signal —
from UKVI compliance monitoring, a tutor concern, or a staff referral —
carrying a triage status (`pending` → `reviewed`/`assigned`/`resolved`/
`dismissed`) and, once triaged, a link to the mental-health case it was
assigned to. Deliberately, the alert record itself carries no clinical
content — only the fact that something happened and where it was routed.

### Governance: access, subject access requests, retention, and audit

**Roles.** Five wellbeing-specific roles exist in
`packages/domain/src/permissions.ts`: `wellbeing-advisor` (general casework),
`wellbeing-specialist-assessor` (formal disability/adjustment assessment),
`wellbeing-panel-chair` (panel-escalated decisions), `wellbeing-mental-health-advisor`
(the only role permitted to read session notes), and `wellbeing-auditor`
(SAR export, retention, and audit access without clinical case-management
rights). Each wellbeing sub-capability grants access along these lines
explicitly — there is no default-open fallback.

**Subject access requests.** `GET /api/v1/sar/export/:personId`
(`modules/wellbeing/src/routes/sar.ts`), restricted to `wellbeing-auditor` and
`dpo`, assembles every wellbeing-owned record for a person — wellbeing cases,
disability cases, DSA entitlements, evidence references, adjustment cases, EC
claims, mental-health cases, session notes, intervention plans, and early
warning alerts — satisfying UK GDPR Article 15. Every export is itself logged
(`sar_export_log` plus the module's own audit log), so "who has exported this
student's data, and when" is answerable.

**Retention.** `PATCH /api/v1/admin/retention/wellbeing-cases/:caseId`
schedules a retention due date (and, where needed, updates the lawful-basis
or data-classification code) on the `wellbeing_case` shell, restricted to
`wellbeing-auditor` and `registry-administrator` — the mechanism by which a
case becomes eligible for closure once its retention period has passed.

**Audit.** A dedicated `audit-log-repository` records wellbeing-specific
audit events (case creation, evidence access, decisions, retention changes)
independently of core SRS's own hash-chained audit trail, readable via the
`audit:read` permission (`dpo`, `system-administrator`, `wellbeing-auditor`).

### What isn't built yet

In the interest of not overstating the capability: real virus/malware
scanning for uploaded evidence is a documented placeholder
(`packages/documents`' `NoopScanner` always returns "clean" — a real
ClamAV-style integration is a deployment-time seam, not yet wired in). The
older `evidence_reference`/EDRMS-reference pattern used by disability support
and the newer in-house `packages/documents` pattern used by reasonable
adjustments coexist deliberately rather than having been consolidated onto
one approach — institutions with an existing EDRMS can use the former;
those without one get the latter. And a second, parallel outcome-distribution
path (`support_outcome`/`distribution_item`, used by other case-managed
capabilities such as PGR and identity-resolution) exists alongside
`reasonable_adjustment`/`adjustment_distribution` for historical reasons —
a known, explicitly tracked duality, not an oversight.
