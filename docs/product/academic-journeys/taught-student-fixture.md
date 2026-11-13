# Shared continuation: registration, study and graduation

Status: **Proposed narrative v0.5**, 13 November 2026 · [Document status](README.md#status-of-these-documents). A fictional fixture: discussion and acceptance-test inputs, not university regulations or seed data.

This extends the [Northbridge course and identities](README.md#shared-scenario-northbridge-entry-cohort-2030) for AJ-16–21, AJ-24–26 and AJ-29. It preserves `NBU-EDS@1.0`, `EDS-FT@1.0`, `EDS-2030@1.0`, the `SCI420`/`SCI440` shared modules and the must-pass ethics component. No new curriculum release is implied by writing these stories.

## People and branches

| Person / role | Fixture and purpose |
|---|---|
| Sam Taylor | The applicant from AJ-06; `PERSON-SAM-001`, `ENR-SAM-2030-01`. Completes the course without reassessment on the main path. Sam's visit access request does not become a permanent support decision. |
| Nina Shah | Fictional classmate; `PERSON-NINA-001`, `ENR-NINA-2030-01`. Makes a separate study-support request before entry. Her evidence is restricted; no diagnosis is needed in the narrative or general student record. |
| Ben Morgan | Fictional classmate; `PERSON-BEN-001`, `ENR-BEN-2030-01`. Final-year ethics-component failure provides the connected assessment → board → reassessment → later-award branch. Ben is distinct from Morgan, the research protagonist in AJ-30–33. |
| Aisha / teaching team | Aisha leads the programme; approved staff assignments identify module leaders, tutors, assessors and moderators. Authoring the course does not automatically grant those roles. |
| Professional services and governance | Registry officer, Finance adviser, accommodation officer, librarian, timetabler, support adviser, examiner, board secretary/chair and awards officer are unassigned role slots. A deployment must name authorised people and deputies. |

An independent story starts from labelled snapshots containing only the facts needed at that time. Future marks, support decisions or awards are not visible early. A connected walkthrough consumes preceding outputs. Counterfactual cases use separate copies of the fixture; they never alter Sam's successful history invisibly.

## Calendar and ordering

All offsets use **t = Monday 23 September 2030**, with one unit equal to seven calendar days, as defined in the [timeline convention](README.md#timeline-convention). For this fictional calendar only, stage-2 and stage-3 academic years begin at t+52 and t+104; their first teaching is at t+53 and t+105. Those are explicit fixture dates, not a rule that every academic year has exactly 52 weeks. Dates within a week are ordered by actual decision/event timestamps.

| Time / window | Milestone and owner |
|---|---|
| t-24 to t-3 | AJ-17 housing enquiries/reservation and AJ-21 Nina's separate support case. An applicant may use these processes before active enrolment. |
| t-20 to t-4 | AJ-19 plans timetable/resources from demand forecasts; these are not confirmed student rosters. |
| t-4 to t-2 | AJ-16 prepares registration and authorises Sam's enrolment. Approval is recorded before the study start at t; scheduled study status is not evidence of attendance. |
| t-2 to t-1 | After enrolment authorisation, AJ-18 confirms six first-stage registrations; AJ-19 finalises allocations; AJ-16/17/20 reconcile access. Configured welcome access can begin before t without inventing attendance. |
| t; t+1 | AJ-17 arrival/induction at t; AJ-20 first teaching at t+1, as already described in AJ-06. |
| t+2 to t+3 | AJ-19 resolves a room closure; AJ-20 corrects a stale teaching-group roster. Academic registrations remain unchanged. |
| t+8 to t+36 | AJ-24 assessment, examination operations and moderation; AJ-21 monitors implemented adjustments. |
| t+36 to t+40 | AJ-25 prepares the first board, ratifies at t+39 and publishes at t+40. A changed pack requires renewed review before ratification. |
| t+40 to t+51 | AJ-26 delivers progression decisions; AJ-18 confirms second-stage options after capacity review at t+49; AJ-16 handles annual registration. |
| t+88 to t+92 | Second-stage board cycle: ratification at t+91, publication at t+92. Third-stage selection/registration follow through t+103. |
| t+132 to t+140 | Final assessment/moderation. Sam passes the ethics component; Ben fails it despite a high weighted project mark. |
| t+140 to t+144 | Final board cycle: ratification at t+143, publication at t+144. Sam is recommended for the award; Ben receives reassessment, not an award. |
| t+145 to t+156 | AJ-29 confers Sam's award at t+145, issues documents at t+146, manages a ceremony at t+150 and reconciles leaver services. |
| t+145 to t+154 | Ben's separate branch: reassessment at t+148, moderation at t+149, supplementary board at t+150, publication at t+151 and conferral (lower second) at t+152. He misses Sam's ceremony and receives a later invitation. |

## Explicit scenario policies

The policies below fill only the decisions needed by this batch. They are synthetic examples, not advice on national regulations. Anything outside them stays an owned policy question rather than being inferred from a credit count.

| Policy reference | Fixture rule |
|---|---|
| `REGISTRATION-2030@1` | Verified identity, accepted terms, confirmed place and an approved fee/payment arrangement permit the authorised Registry decision. An arrangement is not evidence of full payment. The decision records a future study-start date at t and separately authorises specified pre-entry entitlements. |
| `SELECTION-2030@1` | Initial first-stage selection window t-3 to t+2; second-stage window t+40 to t+50; third-stage window t+92 to t+102. Proposals may be drafted before annual registration, but confirmation requires the appropriate registration/continuation authority. Capacity is operational; prerequisites and mandatory hurdles cannot be waived by a capacity reviewer. |
| `ASSESS-EDS-2030@1` | Marks use 0–100. Ordinary module pass threshold is 40. `EDS610` has a 20% ethics/proposal component and an 80% report, module threshold 40, plus an independent ethics-component threshold of 40. The fixture treats the ethics component as the assessed ethics outcome; its criteria must substantiate that judgement. No compensation or condonement may bypass this hurdle or the required project. |
| `REASSESS-EDS-2030@1` | For Ben's specified first failed attempt, one further component attempt is permitted. Carry forward the passed report; reassess only ethics. On passing both the hurdle and aggregate, credit is awarded once and the recorded module mark is capped at 40. Store raw recalculated and capped marks separately; the capped mark is the recorded result. Capping only the reassessed component is policy variant A29-AC11. A second failure requires a new repeat/exit decision; no automatic third attempt or award. Other exceptional-circumstances policies are not invented here. |
| `PROGRESSION-EDS-2030@1` | Main-path progression requires all 120 credits of the current stage passed, applicable prerequisites satisfied and a ratified board decision. No trailing failed credit on this fixture's ordinary progression route. Academic approval to progress does not complete annual registration or reserve optional seats. |
| `BOARD-EDS-2030@1` | Quorum is the chair plus two eligible internal decision-makers. Required external-examiner input must be recorded; conflicts are resolved before counting members. The chair authorises ratification of the identified pack/decisions; Registry authorises the scheduled result release separately. The board may ratify complete candidates and explicitly defer an incomplete candidate; a failed meeting-wide authority/quorum gate still blocks the affected scope. Approval-panel advisers from AJ-01 are not automatically exam-board members. |
| `AWARD-EDS-2030@1` | Award requires 360 distinct passed credits on the approved diet, all compulsory modules and hurdles, ratified results and a board recommendation. Classification uses unrounded credit-weighted stage means: 30% stage 2 + 70% stage 3; stage 1 contributes credit, not classification. First ≥70; upper second ≥60 and <70; lower second ≥50 and <60; third ≥40 and <50. No borderline uplift. Display rounding does not change classification. Classification uses each module's **recorded** result, so a capped reassessment counts at its capped mark; raw recalculated marks are kept as evidence only. Separate authorised conferral establishes the award; ceremony attendance is optional. |
| `SERVICES-2030@1` | Student access is reviewed against each entitlement's purpose/dates, not deleted wholesale on a coarse person-status change. A housing debt or overdue book does not block an academic result or award in this fixture. An independent staff role survives student-role closure. |
| `SUPPORT-NINA-001@1` | Hypothetical approved outcome: accessible learning formats and 25% additional time on specified timed written exams, effective t through t+51 (the end of the stage-1 academic year, so it covers summer reassessment) with review at t+32. The review issues any stage-2 version, effective from t+52, before the first one ends. The concrete example is Nina's `SCI440` written exam attempt `EX-NINA-SCI440-01` at t+30: standard duration 120 minutes, approved duration 150 minutes. No attendance exemption or blanket deadline extension. A later year requires a new reviewed version, never an assumed three-year extension. |

Sam's financial route requires a supplied, authorised arrangement record under `FEES-2030@1`; no real tariff is claimed. An SLC branch additionally needs verified entitlement and the particular confirmation's required start/attendance facts. Do not send a positive attendance confirmation at t-2 simply because registration was authorised then.

## Marks and results that interlock

These marks are **future fixture inputs**, revealed only at their assessment/board stages. Every result still needs its attempt, source, assessment policy, moderation and ratification records. A table of numbers is not those records.

| Student / stage | Module results after the required authority | Credit and calculation |
|---|---|---|
| Sam / stage 1 | `EDS410` 60; `SCI420` 60; `EDS430` 60; `SCI440` 60; `EDS450` 60; `EDS460` 60. | Six modules × 20 = 120 passed credits. |
| Sam / stage 2 | `EDS510` 60; `EDS520` 64; `EDS530` 62; `EDS540` 65; `EDS550` 63; `EDS570` 66. | 120 passed credits; mean 380/6 = 63⅓. |
| Sam / stage 3 | `EDS610`: ethics 60, report 68 → 66.4; `EDS620` 64; `EDS630` 68; `EDS640` 66; `EDS660` 67. | Project 40 credits, others 20 each = 120; credit-weighted mean 66.3. |
| Sam / award | All three stages above; no duplicate credit, failed hurdle or unresolved result. | 360 credits; classification score 0.3 × (380/6) + 0.7 × 66.3 = **65.41**, upper second under the fixture rule. |
| Ben / stages 1–2 | Separate authorised starting snapshot with 240 passed credits. Stage 2: `EDS510`, `EDS520`, `EDS530`, `EDS550`, `EDS560`, `EDS570`, each 60. | Stage-2 mean 60. His records are not Sam's copied identity. |
| Ben / stage 3, other modules | `EDS620`, `EDS630`, `EDS640`, `EDS650`, each 60 (prerequisites `EDS520` and `EDS510` passed). | At first final board: 320 passed credits, with the project's 40 still unearned. |
| Ben / project attempt 1 | Ethics 35; report 70 → raw weighted mark 63. | **Fail: ethics hurdle not met.** No project credit and no award, despite aggregate ≥40. |
| Ben / project attempt 2 | Ethics 50; carried report 70 → raw weighted mark 66; recorded module result capped at 40. | On ratification: project passed, 40 credits awarded once, 360 total. |
| Ben / award | Project counted at its recorded (capped) 40. | Stage-3 mean (40 × 40 + 80 × 60) / 120 = 53⅓; score 0.3 × 60 + 0.7 × 53⅓ = **55.33**, lower second. The cap costs Ben a class: counted at its raw 66, the score would be 61.40 (upper second); with only the component capped (module 64), 60.93 (upper second). |

Every interaction table follows the [exchange and evidence convention](README.md#exchange-and-evidence-convention).
