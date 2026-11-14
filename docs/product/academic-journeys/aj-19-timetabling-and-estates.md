# AJ-19 — Turning demand into a workable timetable

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Module selection](aj-18-module-selection-and-diets.md)

**Perspective:** a timetabler, Estates planner, teaching staff and affected students. **Boundary:** forecast demand through published teaching allocations and controlled changes; examination logistics are owned by AJ-24. **Timeline:** t-20 to t+3, then recurring planning for later stages. All offsets use the [shared t](README.md#timeline-convention).

## The story

### Planning before students register — t-20 to t-12

Northbridge's new course has an approved intake plan, but forty planned places do not mean forty registered students. The timetabler imports demand forecasts with their source date and uncertainty. Existing shared modules also serve other courses, so their combined demand matters. The planner distinguishes an approved academic definition from an offering with a teacher, room and time.

Estates identifies suitable computing rooms, accessible routes and specialist equipment. Teaching staff provide availability through their authorised scheduling process. The planner records which assumptions are provisional. A draft allocation is useful for resource decisions, but is not presented to Sam as a final personal timetable.

### Making constraints explicit — t-8 to t-4

The draft timetable is checked for room capacity, group size, teacher availability, travel between sites and clashes among compulsory modules. A room marked accessible must actually meet the specified operational need; an empty accessibility flag is not positive evidence. The planner receives necessary delivery instructions through the authorised route and never needs Nina's private support evidence.

When a proposed optional combination cannot fit, the timetabler returns an explained constraint to the selection owner. A valid academic diet is not automatically operationally deliverable. The programme owner considers a different group or revised scheduling plan rather than changing a student's module without authority.

### Confirmed registrations become allocations — t-2 to t-1

AJ-18 supplies Sam's confirmed six-module registration set. The timetabler places Sam in the appropriate teaching groups and publishes timetable `TT-NBU-2030-31@1` with source registration references. The timetable version belongs to the institution and teaching period, because shared modules mix programmes; each programme's view is a filter on it. The SRS accepts the dated allocation and the portal shows its published status. Teaching services use the same group/version, rather than a different spreadsheet roster.

The check is not merely whether a file was sent. The receiver must acknowledge the intended version, and a reconciliation view identifies missing allocations or students assigned twice. A partial publication has explicit affected scope and an owner; it cannot claim the whole timetable succeeded.

### A room closes after teaching starts — t+2

Estates reports that the computing room for a shared-module session is unavailable. The timetabler identifies the affected sessions, teachers and students, including students outside Environmental Data Science. An accessible alternative at the same session time is found in the main branch. The new room meets equipment and capacity requirements; students' academic registrations stay unchanged.

The timetabler authorises `TT-NBU-2030-31@2` for the affected scope, across every programme it touches. Sam receives a clear room-change message and sees the same change in the portal. The lecturer and attendance service acknowledge the new location/group context. A delayed v1 event cannot restore the closed room after v2 has been applied.

### Closing the loop — t+3 and beyond

The operator checks delivery and handles any failed channel. A notification sent is not proof that every student read it, so the fixture includes visible portal information and a local assistance route. If no suitable room exists in an alternative branch, the issue remains a declared delivery problem for the programme owner; the system cannot silently select an inaccessible room or withdraw a student.

Later exam planning uses the confirmed study context but has its own entries, accommodations and seating authority in AJ-24. The room inventory and closure facts can be reused without treating a teaching timetable as an examination plan. Annual planning repeats against new offerings while preserving historical timetable versions.

## Starting pack and authority

Supply approved course/resource assumptions, offering IDs, labelled demand forecasts, room/equipment/accessibility inventory, staff availability and calendar. Introduce actual student registrations only when AJ-18 confirms them. The room-closure branch includes a dated Estates incident and candidate alternatives. Do not fabricate a clash-free result when staff or travel data is missing.

Estates owns room availability; staff/scheduling owners attest to availability; the timetabler owns allocations and their publication; Registry owns the registrations being consumed. A support adviser supplies approved delivery effects through SRS; neither Estates nor the timetabler sees diagnostic evidence. The communications owner manages reachability, not academic status.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A19-01 | t-20 to t-12 | Combine labelled forecast demand and resource inventory. | Capacity plan with uncertainty and unresolved dependencies. |
| A19-02 | t-8 to t-4 | Check constraints and draft allocations. | Proposed timetable; blockers returned to owners. |
| A19-03 | t-2 to t-1 | Reconcile confirmed registrations and publish v1. | Applied student/group/room allocations and portal status. |
| A19-04 | t+2 | Estates closes room; assess all affected cohorts. | Authorised feasible replacement or explicit delivery escalation. |
| A19-05 | t+2 to t+3 | Publish v2 and reconcile recipients. | Correct room information, retained v1 and owned failed deliveries. |
| A19-06 | t+28 onwards | Supply relevant resource context to exam planning. | AJ-24 creates its own exam logistics; no implied ratification. |

## Owned interactions

Use the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Acknowledgement and recovery |
|---|---|---|---|
| A19-I01 / F-SIS-TTB-01 | SRS → TTB after registrations/change: confirmed student/module/offering/period versions, dates and permitted delivery constraints. | Registration snapshot/change version; Registry source. | Accepted demand/group membership; reconcile omissions and distinguish forecast from confirmed counts. |
| A19-I02 / F-SIS-EST-01, F-EST-SIS-01 | SRS ↔ EST: permitted cohort demand/timetable context; returned resource availability and allocation references. | Planning snapshot or resource version; Estates owns availability. | Scoped resource response with dates; missing/expired data remains unknown. |
| A19-I03 / GI-10 | TTB ↔ EST/staff scheduling: room/time/equipment and staff availability, closure/change evidence. | Resource/availability revision + scheduling request; respective source owners. | Feasibility/reservation acknowledgement; exact direct-versus-SRS-brokered transport is a design decision, not an invented published flow. |
| A19-I04 / F-TTB-SIS-01 | TTB → SRS on authorised publication: timetable version, sessions, student/group allocation, rooms/dates and replaced scope. | Timetable publication + version; timetabler authority. | Applied allocation snapshot; reject stale/unknown registration references and reconcile incomplete scope. |
| A19-I05 / F-SIS-EWP-01; GI-20 | SRS/communication owner → portal/recipients: authorised changed sessions, version and audience. | Publication + recipient/channel; publishing authority. | Applied portal view plus delivery evidence; failed messages retain an owner, not fabricated readership. |

AJ-20 owns teaching/attendance roster application; it consumes the published allocation version. AJ-24 owns exam scheduling exchanges. These boundaries prevent three separate services deciding room availability or academic registration independently.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A19-AC01 | Reconcile forecast, then confirmed cohort, and publish. | Distinct forecast/actual counts; every required allocation traceable to confirmed registration. |
| A19-AC02 | Compulsory clash, inaccessible room or missing staff data. | Explained blocked/unknown state; no false feasible result. |
| A19-AC03 | Close a room used by several programmes. | All affected sessions/cohorts included; alternative meets actual constraints. |
| A19-AC04 | Deliver v2 then replay v1, or lose the v2 receipt. | Latest authorised version remains applied; recover via query/replay without duplicate allocations. |
| A19-AC05 | One portal/roster consumer fails. | Others retain the authorised update; visible failure and owned reconciliation. |
| A19-AC06 | No feasible alternative exists. | Programme owner receives a delivery escalation; no silent module change, withdrawal or unsuitable allocation. |
| A19-AC07 | Request confidential support evidence or present inaccessible change notices. | Only approved operational effects are shared; accessible notification/assistance route remains available. |

## Traceability, implementation and review

BP-03-006 and BP-05-002 in the [process inventory](../../business-processes/process-inventory.md); REG-004, REG-005 and GOV-008/GOV-009 in [core requirements](../../requirements/functional-requirements.md); XIC-001–007 and ESP-009 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-10 is the explicit direct scheduling/resource-interface gap.

The reference portfolio plans timetabling/Estates connections; the current selection matrix states that timetable-clash detection lacks the necessary slot data. Open decisions for timetabling, Estates, academic delivery, accessibility and integration owners: travel/resource constraints, publication cut-offs, operational authority and urgent-change communication. Closing evidence is the source demand/constraint snapshots, allocation versions, change authority and receiver reconciliation.
