# AJ-23 — Understanding apparent disengagement

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Interruption and return](aj-28-study-change-and-return.md)

**Perspective:** Omar, his tutor and an Attendance caseworker. **Boundary:** an explained engagement signal through human investigation, contact and an owned outcome; academic status and sponsor decisions remain separately authorised. **Timeline:** t+9 to t+20, with the winter closure at t+13 to t+15, under the [shared anchor](README.md#timeline-convention).

## The story

### A signal starts a question — t+9

Omar's record shows two missed required sessions in 14 days. The Attendance module opens `ENG-OMAR-001` under `ENGAGEMENT-2030@1`, retaining the evidence and rule version. The tutor can see why the case exists, which sessions it concerns and what remains uncertain. A dashboard colour or predictive score cannot decide Omar has abandoned his course.

The caseworker checks confirmed registrations, timetable changes and the permitted effects of any approved adjustments. No adjustment is invented because Nina has one. A digital-learning signal, if used in a variant, carries its measurement window and limitations; a login is neither attendance nor proof of learning.

### Correct the evidence before acting on it — t+9 to t+10

One session entry came from a stale group view. The lecturer supplies the actual observation, and the evidence owner appends a correction linked to the old record. The case retains the original trigger and the explanation of the corrected evaluation. It is not secretly deleted to improve an attendance report.

After correction only one missed session remains, so the original threshold is no longer met. The caseworker records that the rule-triggered alert is resolved. The permitted voluntary contact with Omar continues as a separately explained support action, not a false ongoing threshold breach. This distinguishes a corrected data problem from an actual reason for concern.

### A conversation identifies the right help — t+10 to t+12

The tutor contacts Omar through his chosen accessible channel and explains the concern. Omar describes a change in personal responsibilities and asks about taking a break. Detailed personal evidence belongs in a restricted support or Registry case, not in a teaching register. A referral includes only identity, contact permission, relevant study context and the requested action.

The referral reaches Registry at t+12, before the winter closure. The two-week review clock starts at that referral; its t+14 review point falls in the closure, so the caseworker moves it to t+16, the first teaching week back. The caseworker records the receiving case and owner. In an alternative branch, practical support resolves the problem and Omar continues studying; follow-up observations close the case at t+20. In the connected main branch, his request becomes the interruption review in AJ-28. A referral receipt alone does not mean interruption has been approved.

### A decision reaches the academic record — t+16 to t+18

Registry examines the request and its consequences and authorises interruption at t+17, effective t+18. Attendance receives the confirmed status and updates future expected sessions from that date. It preserves earlier observations and does not excuse every prior absence retrospectively.

The native Attendance process owns its evidence, evaluation and casework. Core SRS receives a confirmed operational consequence where appropriate; it does not acquire a second raw attendance ledger. External-provider variants need an explicit contract for the reference model's broader raw-record flow. Omar's record contains no assumed immigration or sponsorship requirement.

### Close the loop and preserve a route back — t+18 to t+20

The caseworker confirms that Omar has the Registry contact, intended return review and relevant support route. Contact attempts and unresolved service tasks remain visible. No response in a counterfactual branch triggers an owned escalation, not automatic withdrawal. An urgent welfare concern follows its designated safeguarding route immediately rather than waiting for the routine review date.

An international-student branch would require AJ-09's actual sponsored-student context, a separately authorised sponsor review and the appropriate reporting owner. The attendance alert itself cannot generate a report to an external authority. AJ-34 consumes only the later authorised reporting decision.

## Starting pack and authority

Supply Omar's registrations and session expectations, two synthetic observations, the stale-group correction evidence, policy version, actor assignments and communication preferences. Do not preload the interruption decision. Lecturers attest observations; Attendance owns evidence and case outcomes; tutors support and refer; Registry owns study-status changes; designated sponsor staff own sponsor decisions. None derives these authorities from seeing the dashboard.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A23-01 | t+9 | Evaluate dated evidence against the configured rule. | Explainable alert and owned case. |
| A23-02 | t+9 to t+10 | Verify roster and append observation correction. | Threshold no longer met; correction and alert resolution retained. |
| A23-03 | t+10 to t+12 | Contact Omar and agree a minimum referral. | Registry/support receipt; no status change yet. |
| A23-04 | t+16 to t+18 | Consume separately authorised interruption. | Expected sessions change from the effective date only. |
| A23-05 | t+18 to t+20 | Confirm hand-off and outstanding tasks. | Owned return/support route; case closes with reasons. |
| A23-06 | t+20, alternative | Review successful support without interruption. | Continued study and proportionate case closure. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A23-I01 / F-SIS-AM-01, F-SIS-AM-02 | SRS → Attendance: confirmed registration/calendar changes and separately approved relevant adjustment effects. | Source version + target; respective source authority. | Applied expectations/instructions; missing context remains unknown rather than inferred. |
| A23-I02 / F-BI-SIS-01; GI-22 | Analytics → governed triage, where enabled: signal version, evidence references, window and limitations. | Signal + version; authorised analytical source, human case owner. | Linked review receipt; duplicate or unexplained signal cannot cause a status decision. |
| A23-I03 / BP-04-001/002 | Evidence owner → Attendance case: corrected observation, original reference and evaluation explanation. | Observation/correction version; authorised evidence owner. | Recomputed finding with preserved trigger/history; stale input cannot resurrect it. |
| A23-I04 / GI-20, GI-22 | Tutor/caseworker → support or Registry: minimum referral and requested review. | Referral + revision; scoped referring role. | Receiving case/owner acknowledgement; unavailable service leaves an owned follow-up. |
| A23-I05 / F-AM-SIS-01; A20-I03 | Native Attendance → core: confirmed case outcome and permitted effect, with decision reference. | Case decision version; Attendance authority. | Core receipt; raw observations remain in Attendance. Registry status decisions are separately sourced through AJ-28. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A23-AC01 | Two qualifying missed sessions with complete context. | Explained human-review case, no automatic withdrawal. |
| A23-AC02 | Correct one stale-roster absence. | Original alert retained as resolved; one remaining absence does not meet the two-session rule. |
| A23-AC03 | Omar asks for interruption during voluntary contact. | Minimum referral; Registry decides independently. |
| A23-AC04 | Student does not respond before the review point. | Assigned escalation and contact history; no invented consent or status change. |
| A23-AC05 | Approved interruption takes effect at t+18. | Future expectations updated; earlier observations preserved. |
| A23-AC06 | Risk score proposes sponsor reporting or withdrawal. | Separate eligibility, human decision and authority required; score alone blocked. |
| A23-AC07 | Duplicate referral or out-of-order evidence arrives. | Existing case/receipt reused or reconciled; no duplicate adverse action. |
| A23-AC08 | General teaching user requests confidential referral evidence. | Purpose-scoped view; sensitive evidence stays with its owner. |

## Traceability, implementation and review

BP-04-001/002/006 and BP-02-007 in the [process inventory](../../business-processes/process-inventory.md); ATT-001–003 and ENR-002 in [core requirements](../../requirements/functional-requirements.md); ESP-001–006 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-20/GI-22 cover contact and owned referral tasks; GI-24 covers the separate urgent incident/continuity route.

The [capability matrix](../current-capabilities.md) records a native engagement baseline; this fictional end-to-end case has not been executed. Review owners, unassigned: Attendance, tutors, Registry, support, privacy and sponsor compliance for that separate variant. Agree evidence thresholds, outreach, urgent escalation and external-provider ownership. Closing evidence connects the explained alert, correction, contact, receiving case and independently authorised consequence.
