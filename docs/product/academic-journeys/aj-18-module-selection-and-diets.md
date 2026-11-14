# AJ-18 — Building a valid individual course diet

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Timetabling](aj-19-timetabling-and-estates.md)

**Perspective:** Sam, an academic adviser and a module-capacity owner. **Boundary:** draft study choices through confirmed, versioned registrations and consumer acknowledgements. Academic definition belongs to CM; enrolment to AJ-16; delivery allocations to AJ-19. **Timeline:** t-3 to t+2, then t+40 to t+50 and t+92 to t+102. The [original t anchor](README.md#timeline-convention) never resets.

## The story

### Sam sees the actual requirements — t-3

Sam opens the module-selection view for the course accepted in AJ-06. The six compulsory stage-1 modules are shown with their credits and delivery information. The view uses `EDS-2030@1.0`, not whichever catalogue version was most recently published. It explains that the initial plan is 120 credits and which steps remain before registrations are confirmed.

Sam can review the proposed plan while registration is being completed. It is not yet a VLE roster or an award entitlement. At t-2, after Registry's authority is recorded, the selection service validates and confirms the compulsory set. `SCI420` and `SCI440` retain their shared identities; they are not copied into new EDS module records simply for this programme.

### Confirmation reaches the teaching services — t-2 to t-1

The approved proposal records the programme/diet, offering and period versions used. Downstream services receive a registration version with a clear confirmed state. Sam sees the learning-space and timetable status for each module. A service failure cannot silently undo a valid registration; a real cancellation requires an authorised registration change.

An adviser can explain each validation result in ordinary language. A missing timetable is “not yet checked”, not a green claim that there are no clashes. Confirmation follows the configured split between academic eligibility and operational delivery evidence. Where a mandatory operational check is unresolved, the relevant registration remains pending with its owner.

### Real choices arrive after the first board — t+40 to t+48

Sam has passed stage 1 and received a ratified progression decision. Stage 2 requires `EDS510`, `EDS520` and `EDS530`, plus three options. Sam chooses `EDS540`, `EDS550` and `EDS570`, the pathway recorded in the shared continuation. The prior passed results satisfy the prerequisites; merely having registered for the prerequisite would not suffice.

The adviser also looks ahead. A simulated route selecting `EDS660` in stage 3 without `EDS570` in stage 2 fails, with the missing prerequisite identified. This is a useful planning explanation, not a retrospective alteration of Sam's choices. A joint-honours variant would need its own approved balance rules; staff cannot improvise them from the total credits.

### A valid choice can still be full — t+48 to t+49

The Community Field Study offering reaches its authorised capacity while Sam's proposal is being processed. Sam sees a waitlisted item and the alternatives. The adviser cannot bypass it by saying the diet is valid. Field-study capacity is set by transport, site access and staff-to-student safety ratios, not by seminar rooms. The module owner confirms a second field-trip cohort on different dates, with a second trained staff leader, a transport booking and a safety risk assessment, under the fixture's operational policy.

Capacity allocation is committed without allowing two concurrent requests to claim the same last seat. Once the second cohort is confirmed and the annual-registration/continuation prerequisites are met, Sam's option is confirmed. The confirmation does not waive any academic prerequisite or change the diet for another student. Sam keeps the intended option set and receives updated service status before the next teaching period.

### Choices and changes retain history — later stages

At t+92, Sam can propose the final-stage compulsory project/decision/communication modules and `EDS640` plus `EDS660`. The completed stage-2 results support both options. A change after confirmation would record the exact old/new offerings, authority, effective date and any fee/assessment impact; removing a record is not a substitute for withdrawal.

An interrupted student returning to a changed curriculum is an AJ-28 branch. They need an approved transition or equivalent-module decision. Neither rollover nor provider replacement automatically moves Sam or a returner onto the latest diet. A completed selection check still says nothing about a future award until the selected work has been passed and ratified.

## Starting pack and roles

Supply the approved curriculum dependency set, exact cohort binding, offerings/selection windows, the appropriate registration authority, any prior ratified results and operational capacity/timetable evidence. The independent stage-2 snapshot includes the t+39/t+40 board outcome. Synthetic future passes are not used to authorise an earlier choice.

Sam proposes; the academic adviser resolves rule/evidence questions; the module owner owns capacity; Registry owns exceptional registration authority. A capacity approver cannot waive a non-waivable academic hurdle. Students and advisers see only the records within their legitimate scope.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A18-01 | t-3 | Present the pinned diet and compulsory proposal. | Draft 120-credit plan; no downstream enrolment implied. |
| A18-02 | t-2 to t-1 | Validate after registration authority and confirm. | Six versioned registrations; AJ-19/20 consume them. |
| A18-03 | t+40 to t+48 | Use ratified stage-1 results for stage-2 choices. | Academic checks pass; full offering separately flagged. |
| A18-04 | t+49 | Owner confirms a second field-trip cohort with staffing, transport and safety evidence. | Seat allocated once; Sam's selected three options confirmed. |
| A18-05 | t+92 to t+102 | Validate final-stage plan against ratified prerequisites. | Five stage-3 modules, 120 credits, correct project requirement. |
| A18-06 | Applicable change window | Process an authorised change/return branch. | Prior registration and downstream correction evidence retained. |

## Owned interactions

Use the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and minimum payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A18-I01 / F-EWP-SIS-01 | Portal → selection service: proposal/version, route/diet binding, requested offerings and student acknowledgement. | Proposal revision + submit action; own-record student authority. | Validation report and state; reject stale edits/closed windows, preserve draft. |
| A18-I02 / GI-10, GI-22 | Selection ↔ capacity/timetable owners: academically valid requests, offering load, clash/capacity checks and scoped exception decision. | Proposal revision + operational check version; named owner. | Feasibility/seat reservation result; no assumption of capacity when data is missing. Concurrent conflicts are reconciled. |
| A18-I03 / BP-03-004, BP-03-006 | Authorised selection → SRS registrations: confirmed exact module/offering versions, period, approval and effective dates. | Proposal revision + confirmation operation; registration authority. | Transactional registration result/outbox; no duplicate registrations or partial unlabelled confirmation. |
| A18-I04 / F-EWP-SIS-01; BP-03-005 | Student/staff → change workflow: current registration version, replacement/withdrawal scope and reason. | Change request + expected version; designated approver. | Decision and dated new version; publish reversal/correction work to the same consumers. Do not erase attempts or fees silently. |

AJ-19 owns timetable distribution/application and AJ-20 owns VLE/attendance rosters. AJ-16 owns any resulting authorised liability/status exchange. A18 closes its operational hand-off only with required receipts or an explicitly permitted, owned outstanding item.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A18-AC01 | Confirm first-stage compulsory set after enrolment authority. | Six distinct modules, 120 credits and the original curriculum binding. |
| A18-AC02 | Choose too few/many options or count the same module twice. | Explain the failed count/credit rule; no duplicate credit. |
| A18-AC03 | Request `EDS660` without passed `EDS570`. | Academic failure is explicit; capacity approval cannot waive it. |
| A18-AC04 | Valid proposal meets a full offering; two requests compete for one seat. | Owned waitlist/allocation process, no over-allocation; approved additional capacity has evidence. |
| A18-AC05 | Timetable or capacity data is absent. | Not fully evaluated/pending for the applicable gate, not a false pass. |
| A18-AC06 | Duplicate confirmation, stale edit or out-of-window request. | Reuse receipt or reject with reason; no duplicated or silently overwritten registration. |
| A18-AC07 | New course release appears during selection. | Bound version remains unless an authorised transition explicitly applies. |
| A18-AC08 | A confirmed change affects teaching/fees; consumer fails. | History preserved, per-target corrective work visible; no informal deletion to hide failure. |

## Traceability, implementation and review

BP-03-002–006 in the [process inventory](../../business-processes/process-inventory.md); REG-001–007 in [core requirements](../../requirements/functional-requirements.md); CM-DIET-001, CM-DIET-004, CM-DIET-006, CM-DIET-012, CM-DIET-016 and CM-DIET-017 in [curriculum requirements](../../requirements/curriculum-management-system.md). GI-10/GI-22 cover operational coordination and exception routing.

The [capability matrix](../current-capabilities.md) records partial selection, including gaps in clash checking, joint-honours rules, allocation and proposal-window enforcement. Open decisions for academic regulations, Registry, timetable/capacity and accessibility owners: exception authority and the exact operational gate. The closing bundle contains proposal versions, rule explanations, allocation authority and registration/consumer receipts.
