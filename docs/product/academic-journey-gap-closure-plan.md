# Academic Journey Gap-Closure Plan

> Status: Proposed
> Date: 2026-11-16
> Baseline: [current capabilities](current-capabilities.md) and the coverage review of 2026-11-16
> Scope: the 49 academic-journey processes in business-process areas 01–06

[Product documentation](README.md) · [Business process inventory](../business-processes/process-inventory.md) · [Data-model delta](../architecture/business-process-data-model-delta.md)

## Where we start

Of the 49 processes from application to graduation:

| Coverage | Processes | Which |
|---|---|---|
| Usable on screen | 30 | Most of admissions, module selection, engagement and support, assessment and exam boards, awards, PGR |
| Partly built | 5 | CAS (BP-01-005), preparing initial registration (BP-02-001), financial registration (BP-02-004), access and entitlements (BP-02-005), route and rule assignment (BP-03-002) |
| API only, no screen | 11 | Identity and right-to-study checks (BP-02-002); transfer, interruption, return and withdrawal cases (BP-02-006 to 009); leaver closure (BP-02-012); curriculum publication (BP-03-001); misconduct (BP-05-006); progression (BP-06-001); award documents and HEAR (BP-06-004); graduation (BP-06-005) |
| Not built | 3 | Clearing (BP-01-006), annual re-registration (BP-02-010), failure to register (BP-02-011) |

Four of these ratings were inferred rather than checked screen by screen (BP-01-007, BP-02-001, BP-03-002, BP-05-001). Phase 0 confirms them.

## How the phases are ordered

1. **Screens over APIs that already work come first.** Eleven processes are complete in the API and need only a screen. This is the cheapest coverage available, and it makes the governed paths usable: today, for example, staff can change an enrolment's status directly on screen, which bypasses the governed status case.
2. **Then the processes that do not exist.** These need new services, rules and policy decisions, so they follow once the screen work has settled the patterns.
3. **Then integrations**, which depend on external systems and agreements as well as code.
4. **Rule depth and hardening last.** These improve processes that already work end to end.

Every item is finished only when it has a service and API (where new), a screen, automated tests, golden demo data that can drive it, a run in the real app, and an updated row in [current capabilities](current-capabilities.md). The [migration squash rule](../architecture/business-process-data-migration-plan.md#re-squashing) applies: the core set is at its 10-file limit, so the first new migration in any phase starts with a squash.

## Phase 0 — Confirm the baseline (small) — done 2026-11-16

**Status: delivered.** Every process now has a checked rating in the [implementation coverage table](../business-processes/traceability-matrix.md#implementation-coverage), with the screen, portal and gap behind it; `npm run check:process-coverage` (run in CI) keeps the table complete and its totals true. Checking corrected the baseline: after Phase 1, **37** processes are usable on screen, not the 41 Phase 1 claimed.

| Inferred rating | Checked rating | Why |
|---|---|---|
| BP-01-007 convert an accepted applicant: on screen | Partly built | Completing the admissions hand-off task changes nothing; staff create the enrolment by hand |
| BP-02-001 prepare initial registration: partly built | Partly built | Confirmed: hand-off task and manual enrolment creation, no registration case |
| BP-03-002 route and rule assignment: partly built | API only | The curriculum binding is automatic or set through the API; routes, rule sets and diet groups have no screen |
| BP-05-001 assessment structures: on screen | API only | Components are listed and their durations edited, but patterns and components are created through the API |

Two ratings not in doubt also changed on inspection: BP-02-002 is partly built (right to study is not recorded as a separate outcome), and BP-03-006 is partly built (registrations reach the VLE, but nothing provisions timetabling). The phases below now cover each.

| Item | Outcome |
|---|---|
| Check the four inferred ratings in the running app | Each is confirmed or corrected in current capabilities |
| Add a per-process coverage column to the [traceability matrix](../business-processes/traceability-matrix.md) | Coverage is tracked per process, not only per capability, so each later phase can show its effect |

**Exit:** all 49 processes have a checked rating.

## Phase 1 — Screens for the API-only journeys (medium) — done 2026-11-16

**Status: delivered.** Decisions are recorded in [Phase 1 gap-closure decisions](../decisions/phase-1-gap-closure-decisions.md). All eleven processes are usable on screen, verified in the real app for the status-case journey (portal request, assessor advice from the worklist, approval by a second registry administrator). Beyond the plan, Phase 1 also:

- retired the direct staff status-change routes (D-1), so the Enrolments tab no longer bypasses the governed case;
- added the guards a decision needs: a transfer to another programme needs the destination programme's support, and a sponsored student's case needs UKVI compliance advice;
- gave misconduct outcomes and identity-verification results their own permissions (D-5, D-6) and required a second person to apply a manually entered curriculum publication (D-7).

Still open from Phase 1's scope: right to study is not yet a separate identity outcome (moved to Phase 3), misconduct effects on individual marks are API-only, and documents have no download until rendering (Phase 3).


All eleven processes already pass integration tests through the API.

| Process | Screen | Notes |
|---|---|---|
| BP-02-006 to 009 status cases | Admin: a status-case worklist and case page (assessments, conditions, decision, withdrawal). Portal: a student requests an interruption, return, withdrawal or transfer, using the four case types the API already lets students request | Retire or gate the direct status change on the Enrolments tab, so status changes go through a case |
| BP-02-012 leaver closure | A leaver-closure case type on the same screens | |
| BP-02-002 identity and right to study | A verification section on the student record's Identity tab | |
| BP-06-001 progression | A progression tab, or a section on the Awards tab: run a decision, see the credits counted, recognised credit and rule exceptions applied, and the history | The calculation evidence already records this |
| BP-06-004 award documents and HEAR | Issue, list and revoke documents from the Awards tab; a verification lookup | Rendering and signing come in Phase 3 |
| BP-06-005 graduation | Graduation cycles: create, invite, allocate to ceremonies, freeze, record attendance. Portal: respond to an invitation | |
| BP-05-006 misconduct | A misconduct-outcomes section on the student record | |
| BP-03-001 curriculum publication | Review a received publication item by item, then apply it | |

**Exit:** 41 of 49 processes usable on screen. Golden data extended so each new screen has something to show.

**Decisions needed:**
- Should the direct enrolment status change remain for registry administrators as an override, or go entirely?
- Which status-case types may students request themselves?

## Phase 2 — Build the missing processes (large)

**Status: in progress.** Decisions are recorded in [Phase 2 gap-closure decisions](../decisions/phase-2-gap-closure-decisions.md) (D-8 to D-13). Delivered so far: assessment structures and programme rules screens, reassessment plans at ratification (D-12), governed curriculum binding changes (D-11), annual re-registration (D-8) and failure to register (D-9). Remaining: initial registration and applicant conversion (D-10) and Clearing (D-13).

| Process | Work |
|---|---|
| BP-02-010 annual re-registration | Service, API and screens over the existing `reenrolment_period` and `reenrolment_confirmation` tables: open a period, students confirm in the portal, outstanding confirmations show on a worklist, and confirmations feed the enrolment status |
| BP-02-011 failure to register | Model the non-registration decision: after a re-registration period closes, unconfirmed students go to a worklist. Each is chased, then resolved by a late confirmation or an institution-initiated withdrawal through a status case |
| BP-02-001 preparing initial registration | Registration invitations from a confirmed admissions hand-off; finish the partial path |
| BP-03-002 route and rule assignment | A screen for the curriculum binding (route, rule set, diet groups), which today is automatic or API only |
| BP-05-001 assessment structures | Screens to create assessment patterns and components, which today are created only through the API |
| BP-01-007 applicant conversion | Completing the admissions hand-off creates the enrolment from the confirmed offer's programme, intake and mode, instead of by hand |
| BP-06-002 reassessment at ratification | Create reassessment plans automatically when a resit or repeat decision is ratified; staff then adjust them, instead of creating every plan by hand |
| BP-01-006 Clearing | A Clearing permission model and route through the channel-neutral application, reusing the applications screens |

**Exit:** all 49 processes exist, and at least 44 are usable on screen.

**Decisions needed:**
- Re-registration policy: does an outstanding fee debt block confirmation, and who can confirm on a student's behalf?
- Who may make Clearing decisions, and under what time limits?

## Phase 3 — Integrations and outputs (large; depends on external parties)

| Area | Work |
|---|---|
| UCAS outbound (BP-01-003/004) | Publish offer decisions and changes to UCAS. Map results received from UCAS to offer conditions as evidence, which staff then confirm |
| CAS (BP-01-005) | Bridge the CAS case to the UKVI page's `ukvi_cas_request`, so there is one CAS record |
| Right to study (BP-02-002) | Record right to study as its own outcome (who checked, how, and when it expires), separate from identity verification |
| Financial registration (BP-02-004) | Fee status and liabilities as a registration step, using the SLC data already held |
| Access and entitlements (BP-02-005) | Connect status-case and registration outcomes to the delivery flows, so a leaver closure itself ends access |
| Award documents (BP-06-004) | Render certificates, transcripts and the HEAR; sign them; offer verification to third parties without an account |
| Curriculum publication (BP-03-001) | Extend publications from programmes and modules to routes, rule sets, learning outcomes and offerings |

**Exit:** no academic process depends on a manual step in another system that the SRS should own.

**Decisions needed:**
- Access to the UCAS outbound interface, and a test environment for it.
- The document-signing approach: an institution-held key or a signing provider, and who manages the keys.
- Whether third-party verification is public, or by request with the student's consent.

## Phase 4 — Rule depth in module selection and status (medium)

| Gap | Work |
|---|---|
| Timetable clashes and provisioning (BP-03-006) | A timetable-slot entity, fed from the timetabling system, and the existing clash policy enforced against it; send confirmed registrations to timetabling as they already go to the VLE |
| Joint-honours balance and repeat-module requirements | Consume the existing rule types in selection validation |
| Oversubscribed modules | Ranked preference allocation across students, replacing all-or-nothing capacity per module |
| Selection windows | Enforce open and close dates at proposal submission |
| Reduced-intensity study and transfer credit mapping | Model both as status-case outcomes |

**Exit:** module-selection validation enforces every rule type the rules engine defines.

**Decision needed:** which timetabling system is the source, and how often slots are refreshed.

## Phase 5 — Audiences and evidence (medium)

| Gap | Work |
|---|---|
| Applicants | A portal view: application status, offer, conditions, response |
| PGR supervisors and examiners | Portal views for their own cases, instead of admin workspace views |
| Exam-board evidence | Populate the data pack hash and rule manifest; populate before and after version references on corrections; complete the explanation of which rule version produced each calculation |
| Reasonable adjustments | The independent professional review of the case workflow (BP-04-004) |
| Process review | Subject-matter-expert review of the processes changed in Phases 1–4, recorded in the [SME review register](../business-processes/sme-review-register.md) |

**Exit:** every capability in the journey areas meets the "implemented baseline" definition in current capabilities.

## Summary

| Phase | Size | Processes usable on screen at exit | Main dependency |
|---|---|---|---|
| 0 Confirm the baseline — **done** | Small | 37 (checked, after Phase 1) | None |
| 1 Screens over existing APIs — **done** | Medium | 37 (41 claimed before checking) | Decided (D-1 to D-7) |
| 2 Missing processes | Large | 44+ of 49, all 49 built | Re-registration and Clearing policy |
| 3 Integrations and outputs | Large | 49 | UCAS access; signing approach |
| 4 Rule depth | Medium | 49, with full selection rules | Timetabling source |
| 5 Audiences and evidence | Medium | 49, at implemented baseline | Independent and SME review |

Phases 4 and 5 can run alongside Phase 3, which mostly waits on external parties.
