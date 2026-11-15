# AJ-28 — Life changes the study plan

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Engagement referral](aj-23-engagement-and-intervention.md)

**Perspective:** Omar, a Registry caseworker, his programme adviser and affected service owners. **Boundary:** requested change through an effective-dated decision and reconciled services, then a separately approved return. **Timeline:** interruption t+12 to t+20, across the winter closure at t+13 to t+15; return review t+88 to t+104 and resumed teaching t+105. The [original t](README.md#timeline-convention) does not reset when Omar returns.

## The story

### A referral becomes Omar's own request — t+12 to t+16

The AJ-23 referral opens `CHANGE-OMAR-001` at t+12. At t+16, after the winter closure, Omar confirms that he wishes to interrupt rather than transfer or withdraw. Registry explains the intended dates, academic implications, financial review and how to return. The tutor's concern is evidence of contact, not authority to suspend him.

The caseworker inventories current modules, submissions, attempts, obligations and service access. The fixture has no earned credit for Omar before interruption. A real completed result would need its own preservation decision; it could not be discarded to simplify the plan. Sensitive personal explanations are restricted, while service owners receive the operational consequences they need.

### Decide before the change takes effect — t+17 to t+18

The authorised Registry decision is recorded at t+17, with interruption effective t+18 and expected return t+104 under `CHANGE-2030@1`. The two timestamps remain distinct. A retrospective request would require an explicit decision about earlier activity, attempts and reports rather than backdating every record invisibly.

The academic authority withdraws the affected unfinished attempts without assigning zeros in this fixture. Finance calculates the approved change to liability and any funding consequences using supplied rules. No refund amount or external eligibility is invented. A finance disagreement has its own case and does not silently convert interruption into withdrawal.

### Services act on the same dated decision — t+18 to t+20

Attendance updates future expectations; teaching systems end or limit the relevant memberships; IAM applies the specified entitlement dates. CRM receives the minimum dated lifecycle change so routine active-student messages stop or change appropriately; [AJ-37](aj-37-publication-and-communications.md) governs the recipient-specific communication. Housing reviews its contract and library services apply their own rules. A change in academic status is not permission to delete Omar's account, terminate an accommodation agreement without review or remove an independent employee role.

Each receiver acknowledges the version it applied. If a housing receipt is lost, the operator queries the booking state and retries safely. Registry shows the valid interruption alongside outstanding service work. Any applicable student-finance or sponsor notification needs its own eligibility and signatory; Omar is not assumed to require either route.

### Returning requires a deliverable academic plan — t+88 to t+100

Registry contacts Omar before the planned return. He confirms readiness and receives a review of the retained `EDS-2030@1.0` binding, attempt history and remaining requirements. AJ-02 has approved a new Statistics version, and AJ-03 has just published the 2033-entry release. Neither moves Omar automatically onto those rules.

The programme owner proposes a full stage-1 return at t+104 because Omar has no earned stage-1 credit. The fixture explicitly authorises the repeat/attempt treatment and the six original 20-credit modules. Statistics in 2032/33 is the regular `SCI440@1.0` offering: version 2 applies only to 2033 entrants from t+156, so Omar needs no special legacy arrangement. Capacity and timetable evidence must still support all six modules; an old catalogue entry alone cannot guarantee delivery. Returning at t+52 would have meant restarting stage 1 a year earlier; his circumstances, within the two-year limit in `CHANGE-2030@1`, set t+104.

If a required module cannot be delivered, the case remains pending until an authorised equivalent or transition is approved. The alternative must identify outcome equivalence, remaining credit, prerequisites, assessment attempts and any required student agreement. A convenient substitution is not a completed transition decision. In a variant, Omar fails Statistics in 2032/33 and needs a further attempt in 2033/34, when EDS entrants take version 2. That attempt uses the parallel version-1 delivery committed in AJ-02, unless an authorised equivalence decision says otherwise.

### Register, restore access and verify the return — t+100 to t+105

Finance confirms the new period's arrangement. Registry authorises return and annual registration, AJ-18 confirms the approved study plan, and service owners apply the new dated entitlements. Prior interruption history remains. First teaching is t+105; restoring an account at t+103 is not evidence that Omar attended then.

Omar can see the timetable, learning spaces and adviser contact. The caseworker checks the receipts and records actual start evidence when it exists. Later assessment and progression use Omar's stage and current attempts, not Sam's simultaneous final-year results.

### Other changes have different outcomes

A transfer branch requires an accepted destination route, academic credit/attempt mapping, capacity, offer/terms acknowledgement and effective dates. Withdrawal closes the intended enrolment with owned consequences and a review route; it does not infer an exit award. Non-registration needs contact and a governed decision. A verified notification of death uses a restricted, sensitive route that stops inappropriate chasing and coordinates authorised closure. These alternatives use separate fixture copies and do not alter Omar's return story.

## Starting pack and authority

Supply Omar's confirmed current registrations, referral/request, no-credit snapshot, attempt states, service obligations and `CHANGE-2030@1`. Return scenes additionally require actual 2032/33 offering/resource evidence, approved attempt treatment and fresh financial/registration readiness. Registry owns status; academic authorities own the completion plan; each service owns its consequences. A timetabler or integration operator cannot authorise withdrawal.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A28-01 | t+12 to t+16 | Confirm request and inventory academic/service impacts. | Explicit interruption case, not inferred withdrawal. |
| A28-02 | t+17 | Approve scope, dates and attempt treatment. | Decision recorded before effect at t+18. |
| A28-03 | t+18 to t+20 | Apply and reconcile recipient consequences. | Dated status and owned service outcomes. |
| A28-04 | t+88 to t+96 | Review return, retained rules and actual 2032/33 offerings. | Proposed six-module plan with explicit gaps. |
| A28-05 | t+97 to t+100 | Approve academic feasibility and repeat treatment. | Authorised 120-credit stage-1 plan, no invented earned credit. |
| A28-06 | t+100 to t+104 | Complete finance/registration and restore dated access. | Confirmed registrations and reconciled service readiness. |
| A28-07 | t+105 | Verify actual resumed teaching/start evidence. | Return demonstrated; earlier interruption retained. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A28-I01 / F-EWP-SIS-01; BP-02-006–009 | Student → Registry: requested change, current enrolment version, dates and restricted evidence references. | Request revision; own-record authority. | Owned case and impact review; stale enrolment basis reconciled. |
| A28-I02 / BP-02-007/008; GI-22 | Authorised Registry command → core: decision, effect/recorded dates, academic plan and permitted consequences. | Case decision + expected enrolment version. | New dated status with predecessor retained; retry returns same decision. |
| A28-I03 / F-SIS-CRM-01; A16-I03b, A16-I04, A17-I01, A17-I03, A20-I01 | Core → CRM, Finance, IAM, library, housing and teaching owners: minimum status/registration changes. | Status/registration version + destination. | Per-service applied state; failed recipient does not undo academic authority. |
| A28-I04 / A18-I02/I03; CM-VER-009 | Registry ↔ academic/selection owners: retained binding, attempts, equivalence if needed, capacity and return plan. | Return-plan revision; academic then registration authority. | Approved feasible plan and confirmed registrations; missing delivery blocks readiness. |
| A28-I05 / A34-I05; ENR-006 | Registry → reporting owner where applicable: authorised dated status, scheme/sponsor context and source reference. | Change version + reporting obligation. | Eligible signatory-controlled notification/receipt; no automatic sponsor action. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A28-AC01 | Approve at t+17 with effect t+18. | Distinct recorded/effective times; no attendance backdating. |
| A28-AC02 | Interrupt with unfinished attempts and no earned credits. | Authorised withdrawal treatment; neither fabricated zero nor invented credit. |
| A28-AC03 | A recipient fails or replays an old active-status event. | Current state preserved; owned reconciliation without duplicate closure. |
| A28-AC04 | Return after version 2 is published. | Original binding retained unless an explicit transition applies. |
| A28-AC05 | A return-year module, or a version-1 resit in 2033/34, has no teacher, seat or compatible assessment. | Return plan not declared ready; owned provision/equivalence decision. |
| A28-AC06 | Confirm return before finance/registration authority. | Confirmation gate blocked; academic plan alone cannot activate enrolment. |
| A28-AC07 | Transfer or withdrawal branch is requested. | Distinct authority, credit/attempt impacts and service decisions; no inferred exit award. |
| A28-AC08 | Non-registration or verified death notification occurs. | Separate governed route and appropriate contact suppression; no routine automated adverse decision. |
| A28-AC09 | A separate staff role remains valid during interruption. | Scoped student-entitlement change only; independent role preserved. |

## Traceability, implementation and review

BP-02-006–012 and BP-03-005 in the [process inventory](../../business-processes/process-inventory.md); ENR-002, ENR-006, ENR-008 and REG-002 in [core requirements](../../requirements/functional-requirements.md); IGA-005/006 and RSS-012 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md); CM-VER-008/009 and CM-DIET-010 in [curriculum requirements](../../requirements/curriculum-management-system.md).

The [capability matrix](../current-capabilities.md) records status and registration foundations, not this completed cross-service journey. Review owners, unassigned: Registry, academic regulations, Finance/funding, support, IAM, accommodation and sponsor compliance where applicable. Closing evidence includes the original and return decisions, attempt/credit treatment, actual delivery commitments and recipient reconciliation.
