# AJ-20 — Teaching a cohort and noticing individual needs

Status: **Proposed narrative v0.5**, 13 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Support](aj-21-reasonable-adjustments.md)

**Perspective:** Aisha, a module lecturer, a personal tutor and Sam. **Boundary:** confirmed registrations become usable learning/attendance rosters, teaching begins and attributable learning evidence or a referral reaches its owner. AJ-24 owns formal mark intake; AJ-23 will own expanded engagement intervention. **Timeline:** t-1 to t+30, repeated for later offerings, using the [shared t](README.md#timeline-convention).

## The story

### Preparing the actual class — t-1

Aisha opens the teaching view and checks that its roster comes from confirmed registrations, not the admissions forecast. The shared Data and Programming module contains students from several programmes, all linked to the appropriate offering. Sam's account works and the correct learning space is visible. Draft or waitlisted choices are labelled and do not become full course access by accident.

Staff authority is also explicit. An approved assignment identifies Sam's personal tutor and the relevant module lecturers. Aisha's role as course proposer does not automatically make her everyone's tutor or grant access to every support case. The tutor sees the academic context needed to advise Sam and the legitimate contact route.

### Beginning teaching — t+1

Sam attends the first session, opens the learning materials and sees where work will be submitted and how feedback will arrive. The lecturer can distinguish planned activities, actual engagement evidence and formal assessment. A login is not proof of learning; absence from one session is not a withdrawal decision.

Nina's approved accessible-format requirement has reached the learning service through AJ-21. The lecturer confirms the relevant materials are usable without asking Nina to repeatedly reveal the evidence behind the decision. The course's outcomes and criteria remain the same; changing the way material is accessed does not silently change the academic standard.

### A stale group roster causes confusion — t+2 to t+3

After AJ-19's room change, a teaching-group view still uses an older allocation. Sam is present but is missing from that group's register. The lecturer records the discrepancy and the actual observation, rather than adding a second academic registration or marking Sam as disengaged.

The operator compares registration and timetable versions, repairs the derived group membership and replays the correct change. The observation retains its original source and any correction provenance. If a resulting attendance alert has already been raised, it is sent to the case owner for review, not silently removed from the audit history. Native Attendance owns its evidence and casework; core SRS receives the authorised consequence, not an indiscriminate raw feed.

### Feedback supports learning — t+8 to t+12

Sam submits an early piece of work and receives feedback that identifies what to improve. Formative comments remain distinguishable from a confirmed module mark. When a summative assessment is ready for formal processing, AJ-24 receives the attempt/version and attributable mark evidence under its own contract.

The personal tutor notices that another student has stopped responding. The tutor first checks timetable/roster accuracy and permitted adjustment effects, then contacts the student. A support referral carries only necessary context. A safeguarding or confidential welfare concern uses its restricted route, not a general teaching note visible to the whole department.

### Closing a teaching period — t+30

The lecturer reviews outstanding submissions and unresolved roster issues before assessment processing. An unresolved mark is not filled with zero merely to make a report complete. The teaching team supplies its evidence to assessment owners and contributes appropriately aggregated feedback to the later programme-review process.

A tutor change is effective-dated and notified; the previous relationship remains reconstructible. When students progress, repeat or leave, new authorised registrations and assignments update the next period's views. Learning evidence is not erased simply because current access ends.

## Starting pack and authority

Provide AJ-16 identity/eligibility, AJ-18 confirmed registrations, AJ-19 published group/session allocations, course resource references, staff assignment authority and the permitted AJ-21 outcome for Nina. Start with correct main learning access at t+1; the stale subgroup fault occurs at t+2. Independent fixtures must not include future ratified marks.

Module lecturers own teaching evidence and feedback; academic tutors own their advising contacts; HR/academic assignment owners confirm relationships; learning-technology and Attendance teams own derived views/evidence processing. Tutors cannot withdraw students or determine immigration action from a flag. Specialist support evidence remains with its owner.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A20-01 | t-1 | Reconcile registration, timetable and staff assignments. | Correct learning spaces/rosters and tutor relationship. |
| A20-02 | t+1 | Deliver first teaching and check accessible materials. | Usable learning experience; actual observations attributed. |
| A20-03 | t+2 to t+3 | Investigate stale subgroup membership after room change. | Corrected derived roster and observation provenance; no duplicate registration. |
| A20-04 | t+8 to t+12 | Give feedback and route formal assessment evidence. | Formative/summative distinction retained; AJ-24 receives owned input. |
| A20-05 | t+12 to t+20 | Tutor reviews a concern and contacts/refers appropriately. | Owned follow-up with minimum disclosure, not automatic status action. |
| A20-06 | t+30 | Reconcile outstanding teaching evidence before period close. | Assessment/review hand-offs and retained relationship history. |

## Owned interactions

Use the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A20-I01 / F-SIS-VLE-01, F-SIS-AM-01 | SRS → VLE/Attendance after confirmed registration or published timetable change: person/registration/offering/period, dates and group/allocation version where needed. | Registration/roster snapshot version + target; authorised source decisions. | Target roster diff and applied version; retry cannot create duplicate membership or revive a withdrawn registration. |
| A20-I02 / F-HR-SIS-01 | HR/academic assignment owner → SRS: confirmed tutor/lecturer relationship, staff eligibility reference, scope and dates. | Assignment + version; designated relationship authority. | Active relationship and predecessor end-date; unresolved staff eligibility is reviewed, not presumed. |
| A20-I03 / F-AM-SIS-01; GI-22 | Attendance process → core on confirmed engagement consequence: case/decision reference, permissible operational effect and dates. | Case decision version; Attendance process authority. | Core outcome receipt. The reference raw-record wording is an external-provider variant requiring explicit design, not native bulk evidence ingestion. |
| A20-I04 / GI-20, GI-24 | Tutor → owned support/engagement referral: student identity, reason category, necessary contact/context and urgency. | Referral action/version; scoped tutor authority. | Receiving case/triage receipt with owner; sensitive narrative excluded from broad dashboards. |

The VLE-to-SRS formal mark exchange is A24-I02, not another teaching-owned marks store. Adjustment delivery is A21-I03; the lecturer acknowledges the operational result through that service. Engagement analytics and student surveys remain AJ-35 responsibilities. AJ-23 is not yet expanded.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A20-AC01 | Confirm registrations, assignments and first teaching. | Sam sees the correct modules; staff access follows assigned scope. |
| A20-AC02 | Registration exists but subgroup roster is stale. | Correct derived membership; actual observation retained, no duplicate academic registration or automatic adverse action. |
| A20-AC03 | Replay withdrawal/registration events out of order. | Latest authorised membership wins; discrepancy and recovery are auditable. |
| A20-AC04 | A lecturer tries to submit formative feedback as a ratified mark. | Distinct evidence/state required; only AJ-24/25 authority can create confirmed/ratified outcomes. |
| A20-AC05 | Tutor sees a risk flag with disputed source data. | Investigate source/contact; no automatic withdrawal or sponsor decision. |
| A20-AC06 | Tutor changes or requests confidential support evidence. | Dates/scope control access; necessary operational effects shared, private evidence withheld. |
| A20-AC07 | Accessible material or target roster is missing. | Visible owned remediation; an approval/delivery message alone is not proof of usable learning. |

## Traceability, implementation and review

BP-03-006 and BP-04-001/002/006 in the [process inventory](../../business-processes/process-inventory.md); REG-006, REG-007, VLE-001, VLE-002, ATT-002 and HRP-002 in [core requirements](../../requirements/functional-requirements.md); ESP-001–006 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-14/GI-20/GI-22 cover resources, communications and referral routing.

VLE and native attendance foundations exist, but the [capability matrix](../current-capabilities.md) does not establish this whole teaching/tutoring journey or external HR integration. Open decisions for teaching/tutoring, HR, learning-technology, Attendance and privacy/accessibility owners: roster authority, observations, referrals and staff-access policy. Closing evidence contains applied rosters, assignments, teaching/assessment hand-offs and owned referrals, not a fabricated measure of student competence.
