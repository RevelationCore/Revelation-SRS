# Workflow Catalogue

> Status: Draft — Phase 1
> Last updated: 2026-06-04
> This catalogue defines every long-running, multi-actor business process managed by the Revelation SRS workflow engine (Temporal). Each workflow entry defines the trigger, participating actors, state machine, decision points, and terminal outcomes.
> Workflows marked **Core** are required for Phase 4/5; those marked **Regulatory** for Phase 6; **Governance** for Phase 5 (Exam Board); **Wellbeing** for Phase 8 (example module).

---

## W001 — Student Admissions and Enrolment `Core`

**Trigger**: UCAS application received, or direct application submitted.
**Actors**: Applicant, Admissions/Registry staff, Finance system, IAM system, SLC, UKVI.

### States

| # | State | Description |
|---|---|---|
| 1 | `application_received` | Application ingested from UCAS or direct channel |
| 2 | `offer_pending` | Under admissions review |
| 3 | `offer_made` | Conditional or unconditional offer issued |
| 4 | `offer_accepted` | Applicant has accepted the offer |
| 5 | `conditions_pending` | Awaiting confirmation of conditional offer requirements |
| 6 | `conditions_met` | All conditions satisfied; enrolment may proceed |
| 7 | `pre_enrolment` | Applicant completing pre-enrolment documentation |
| 8 | `enrolled` | Student record created; enrolment confirmed |
| 9 | `withdrawn_pre_enrolment` | Offer declined, lapsed, or withdrawn before enrolment |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `application_received` | Admissions review initiated | `offer_pending` | Registry |
| `offer_pending` | Offer issued | `offer_made` | Registry |
| `offer_made` | Applicant accepts | `offer_accepted` | Applicant |
| `offer_made` | Offer declined / lapsed | `withdrawn_pre_enrolment` | System / Applicant |
| `offer_accepted` | Conditional offer | `conditions_pending` | System |
| `offer_accepted` | Unconditional offer | `pre_enrolment` | System |
| `conditions_pending` | Conditions confirmed | `conditions_met` | Registry |
| `conditions_pending` | Conditions not met / deadline passed | `withdrawn_pre_enrolment` | System / Registry |
| `conditions_met` | Pre-enrolment initiated | `pre_enrolment` | System |
| `pre_enrolment` | Documents submitted and verified | `enrolled` | System |

### On reaching `enrolled`
- Student record created in SIS
- Fee liability record created → Finance system notified
- IAM account provisioned
- SLC enrolment confirmation sent
- UKVI CAS creation initiated (if international)
- UCAS enrolment confirmation transmitted
- Domain event `srs.student.enrolled` published

### Deadline enforcement
- Offer acceptance: configurable per offer type (default 28 days)
- Conditions confirmation: configurable per intake
- Pre-enrolment document submission: configurable per intake

---

## W002 — Reasonable Adjustment Case Management `Wellbeing`

**Trigger**: Student disability declaration, or referral by personal tutor or other staff member.
**Actors**: Student, Disability Advisor/Wellbeing Practitioner, Specialist assessor (external), Registry.

### States

| # | State | Description |
|---|---|---|
| 1 | `referral_received` | Case opened; student notified |
| 2 | `assessment_pending` | Awaiting student to provide evidence or attend assessment |
| 3 | `under_assessment` | Active assessment by disability advisor or specialist |
| 4 | `determination_made` | Adjustment plan drafted |
| 5 | `approved` | Adjustments approved and transmitted to SIS |
| 6 | `rejected` | Claim not upheld; student notified |
| 7 | `under_review` | Student has requested review of a rejection |
| 8 | `review_complete` | Review outcome communicated |
| 9 | `closed` | Case closed; adjustments in effect or case ended |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `referral_received` | Student engages with service | `assessment_pending` | Student |
| `referral_received` | Student does not engage (deadline) | `closed` | System (deadline) |
| `assessment_pending` | Evidence received | `under_assessment` | Disability Advisor |
| `under_assessment` | Determination drafted | `determination_made` | Disability Advisor |
| `determination_made` | Advisor approves | `approved` | Disability Advisor |
| `determination_made` | Advisor rejects | `rejected` | Disability Advisor |
| `rejected` | Student requests review | `under_review` | Student |
| `rejected` | No review requested (deadline) | `closed` | System |
| `under_review` | Review completed | `review_complete` | Disability Advisor / Manager |
| `review_complete` | Upheld | `approved` | System |
| `review_complete` | Not upheld | `closed` | System |
| `approved` | Adjustments distributed to SIS | `closed` | System |

### On reaching `approved`
- Approved adjustment outcome transmitted to SIS core
- SIS records adjustment bitemporally against student record
- SIS distributes to VLE, Attendance Monitoring, Exam Scheduling
- Domain event `srs.adjustment.approved` published

---

## W003 — Exceptional Circumstances Determination `Wellbeing`

**Trigger**: Student submits an EC claim for a specific assessment or period.
**Actors**: Student, Wellbeing Practitioner, Registry.

### States

| # | State | Description |
|---|---|---|
| 1 | `submitted` | EC claim received |
| 2 | `evidence_pending` | Awaiting supporting evidence |
| 3 | `under_review` | Being reviewed by wellbeing practitioner |
| 4 | `upheld` | Claim upheld; SIS flagged for board |
| 5 | `not_upheld` | Claim not upheld; student notified |
| 6 | `closed` | Case closed |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `submitted` | Evidence complete | `under_review` | System |
| `submitted` | Evidence required | `evidence_pending` | Wellbeing Practitioner |
| `evidence_pending` | Evidence submitted | `under_review` | Student |
| `evidence_pending` | Deadline passed without evidence | `not_upheld` | System |
| `under_review` | Claim upheld | `upheld` | Wellbeing Practitioner |
| `under_review` | Claim not upheld | `not_upheld` | Wellbeing Practitioner |
| `upheld` | Outcome transmitted to SIS | `closed` | System |
| `not_upheld` | Student notified | `closed` | System |

### On reaching `upheld`
- Approved EC outcome transmitted to SIS core (F-WELL-SIS-02)
- SIS records EC flag bitemporally against student and module
- Flag surfaced in next Exam Board data pack
- Domain event `srs.exceptional-circumstances.flagged` published

---

## W004 — Academic Misconduct Investigation `Core`

**Trigger**: Misconduct allegation raised by academic staff or detection system.
**Actors**: Academic Integrity Officer, Respondent Student, Academic staff (witness), Panel members, Registry.

### States

| # | State | Description |
|---|---|---|
| 1 | `allegation_received` | Case opened; student notified |
| 2 | `preliminary_inquiry` | Initial assessment of allegation by AI Officer |
| 3 | `no_case_to_answer` | Allegation does not meet threshold; case closed |
| 4 | `investigation` | Formal investigation underway |
| 5 | `student_response_pending` | Awaiting student written response |
| 6 | `panel_hearing_scheduled` | Hearing date set |
| 7 | `panel_hearing` | Hearing in progress |
| 8 | `decision_made` | Panel has reached a decision |
| 9 | `penalty_applied` | Penalty determined and outcome transmitted to SIS |
| 10 | `closed` | Case closed |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `allegation_received` | Preliminary inquiry initiated | `preliminary_inquiry` | AI Officer |
| `preliminary_inquiry` | Below threshold | `no_case_to_answer` | AI Officer |
| `preliminary_inquiry` | Formal investigation warranted | `investigation` | AI Officer |
| `investigation` | Student invited to respond | `student_response_pending` | System |
| `student_response_pending` | Response received | `panel_hearing_scheduled` | AI Officer |
| `student_response_pending` | Deadline passed | `panel_hearing_scheduled` | System |
| `panel_hearing_scheduled` | Hearing conducted | `panel_hearing` | Panel |
| `panel_hearing` | Panel deliberates | `decision_made` | Panel |
| `decision_made` | Penalty determined | `penalty_applied` | AI Officer |
| `penalty_applied` | Outcome transmitted to SIS (F-AI-SIS-01) | `closed` | System |
| `no_case_to_answer` | Student notified | `closed` | System |

### On reaching `penalty_applied`
- Outcome and penalty transmitted to SIS (F-AI-SIS-01)
- SIS records against student and assessment
- Misconduct flag surfaced in Exam Board data pack
- Domain event `srs.misconduct.outcome-recorded` published

---

## W005 — Exam Board Preparation and Ratification `Governance`

**Trigger**: End of assessment period; board meeting date reached.
**Actors**: Registry, Module Tutors, External Examiner, Exam Board Chair, Exam Board members.

### States

| # | State | Description |
|---|---|---|
| 1 | `marks_collection` | Module results being submitted and confirmed |
| 2 | `data_preparation` | Registry preparing board data pack |
| 3 | `pre_board_review` | Board data pack available; external examiner review period |
| 4 | `board_meeting` | Formal board meeting in session |
| 5 | `ratified` | Board has ratified outcomes; record lock initiated |
| 6 | `records_locked` | All covered records locked in SIS |
| 7 | `results_published` | Student results published via portal |
| 8 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `marks_collection` | All module results confirmed | `data_preparation` | System |
| `data_preparation` | Data pack generated | `pre_board_review` | Registry |
| `pre_board_review` | External examiner confirmation received (F-EXTEX-EXAMBOARD-01) | `board_meeting` | System |
| `board_meeting` | Board ratification recorded (F-EXAMBOARD-SIS-01) | `ratified` | Exam Board Chair |
| `ratified` | Record lock applied to all covered records | `records_locked` | System |
| `records_locked` | SLC notification sent (if applicable) | — | System |
| `records_locked` | Results publication approved | `results_published` | Registry |
| `results_published` | Domain events published; downstream systems notified | `closed` | System |

### On reaching `records_locked`
- All academic records covered by the board are locked in SIS
- Domain event `srs.exam-board.ratified` published
- Downstream systems notified (VLE, portal, SLC if applicable)
- Post-ratification, only W006 (appeal/correction) can unlock records

---

## W006 — Post-Ratification Appeal and Correction `Governance`

**Trigger**: Student submits a formal appeal, or Registry identifies an administrative error requiring correction.
**Actors**: Student (for appeals), Registry, Appeals Committee, Exam Board Chair.

### States

| # | State | Description |
|---|---|---|
| 1 | `submitted` | Appeal or correction request received |
| 2 | `preliminary_review` | Initial assessment of grounds |
| 3 | `not_eligible` | Appeal does not meet grounds; closed |
| 4 | `committee_review` | Academic Appeals Committee review |
| 5 | `upheld` | Appeal upheld; correction authorised |
| 6 | `dismissed` | Appeal dismissed |
| 7 | `record_amended` | SIS record amended with full authorisation trail |
| 8 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `submitted` | Grounds assessed | `preliminary_review` | Registry |
| `preliminary_review` | Grounds not met | `not_eligible` | Registry |
| `preliminary_review` | Grounds met | `committee_review` | System |
| `committee_review` | Committee upholds appeal | `upheld` | Appeals Committee |
| `committee_review` | Committee dismisses appeal | `dismissed` | Appeals Committee |
| `upheld` | Record amendment authorised | `record_amended` | Exam Board Chair / Registry |
| `record_amended` | Amendment written to SIS with audit trail | `closed` | System |
| `dismissed` | Student notified | `closed` | System |
| `not_eligible` | Student notified | `closed` | System |

### On reaching `record_amended`
- SIS record lock overridden under this workflow's authorisation
- Amendment recorded with full before/after values, authorising actor, and appeal reference
- Amended record re-locked
- Domain event `srs.record.amended-post-ratification` published

---

## W007 — Student Withdrawal and Intermission `Core`

**Trigger**: Student requests withdrawal or intermission; or institutional action (e.g. academic failure, non-payment, visa curtailment).
**Actors**: Student, Personal Tutor, Registry, Finance, SLC, UKVI (if applicable).

### States

| # | State | Description |
|---|---|---|
| 1 | `request_received` | Request or institutional trigger received |
| 2 | `tutor_consultation` | Personal tutor notified; consultation opportunity |
| 3 | `approved` | Approved by Registry |
| 4 | `effective` | Enrolment status updated in SIS |
| 5 | `notifications_sent` | Downstream systems notified |
| 6 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `request_received` | Personal tutor notified | `tutor_consultation` | System |
| `tutor_consultation` | Consultation period elapsed or waived | `approved` | System / Registry |
| `approved` | Enrolment status updated | `effective` | System |
| `effective` | SLC notified; fee liability adjusted | `notifications_sent` | System |
| `notifications_sent` | UKVI notified if applicable | `closed` | System |

### On reaching `effective`
- Enrolment status changed (bitemporally) to Withdrawn or Intermitting
- Fee liability adjusted
- SLC notified of change
- UKVI notified if student is sponsored
- IAM account status updated
- Domain event `srs.student.status-changed` (newStatus: withdrawn / intermitting) published

---

## W008 — HESA Annual Statutory Return `Regulatory`

**Trigger**: Annual HESA submission window opens (typically October–January).
**Actors**: Data/Registry team, HESA (external).

### States

| # | State | Description |
|---|---|---|
| 1 | `extraction` | Student data extracted from SIS |
| 2 | `internal_validation` | Data validated against HESA business rules |
| 3 | `validation_errors` | Errors identified; corrections required |
| 4 | `ready_for_submission` | Data clean; submission approved |
| 5 | `submitted` | Return submitted to HESA |
| 6 | `hesa_validation_pending` | Awaiting HESA validation response |
| 7 | `hesa_errors` | HESA has returned errors; amendments required |
| 8 | `accepted` | HESA has accepted the return |
| 9 | `ids_received` | HESA student identifiers received and stored |
| 10 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `extraction` | Extract complete | `internal_validation` | System |
| `internal_validation` | Errors found | `validation_errors` | System |
| `validation_errors` | Data corrections made | `internal_validation` | Registry |
| `internal_validation` | No errors | `ready_for_submission` | System |
| `ready_for_submission` | Submission authorised | `submitted` | Registry |
| `submitted` | Response received | `hesa_validation_pending` | System |
| `hesa_validation_pending` | HESA errors returned | `hesa_errors` | System |
| `hesa_errors` | Amendments submitted | `submitted` | Registry |
| `hesa_validation_pending` | HESA accepts return | `accepted` | System |
| `accepted` | HESA IDs received and stored | `ids_received` | System |
| `ids_received` | IDs propagated to downstream systems | `closed` | System |

---

## W009 — UKVI Attendance Compliance `Regulatory`

**Trigger**: Student attendance falls below the configured UKVI compliance threshold; or visa status change received from UKVI.
**Actors**: UKVI Compliance Officer, Registry, Student, UKVI (external).

### States

| # | State | Description |
|---|---|---|
| 1 | `alert_triggered` | Attendance threshold breach or visa change detected |
| 2 | `under_review` | Compliance officer reviewing the case |
| 3 | `contact_student` | Student contacted for explanation |
| 4 | `resolved_no_action` | Explanation accepted; no sponsor action required |
| 5 | `sponsor_action_required` | Institution must report to UKVI |
| 6 | `reported_to_ukvi` | UKVI notified |
| 7 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `alert_triggered` | Compliance officer assigned | `under_review` | System |
| `under_review` | Contact required | `contact_student` | Compliance Officer |
| `under_review` | Review complete, no action | `resolved_no_action` | Compliance Officer |
| `contact_student` | Satisfactory explanation | `resolved_no_action` | Compliance Officer |
| `contact_student` | No satisfactory explanation / no response | `sponsor_action_required` | Compliance Officer |
| `sponsor_action_required` | UKVI notified (F-SIS-UKVI-01) | `reported_to_ukvi` | System |
| `resolved_no_action` | Case closed | `closed` | System |
| `reported_to_ukvi` | Case closed | `closed` | System |

---

## W010 — Annual Student Re-Enrolment `Core`

**Trigger**: Start of new academic year; re-enrolment window opens for continuing students.
**Actors**: Student, Registry, Finance.

### States

| # | State | Description |
|---|---|---|
| 1 | `window_open` | Re-enrolment window open; students notified |
| 2 | `confirmed` | Student has completed re-enrolment |
| 3 | `reminder_sent` | Reminder issued to students who have not re-enrolled |
| 4 | `lapsed` | Student did not re-enrol within the deadline |
| 5 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `window_open` | Student completes re-enrolment | `confirmed` | Student |
| `window_open` | Reminder threshold reached | `reminder_sent` | System |
| `reminder_sent` | Student completes re-enrolment | `confirmed` | Student |
| `reminder_sent` | Deadline passed | `lapsed` | System |
| `confirmed` | Module registration window opened | `closed` | System |
| `lapsed` | Registry notified; withdrawal workflow initiated | `closed` | System → W007 |

---

## W011 — Award and Graduation `Core`

**Trigger**: Exam Board ratification confirms student has met all award requirements (output of W005).
**Actors**: Student, Registry, Graduation/Ceremonies team.

### States

| # | State | Description |
|---|---|---|
| 1 | `award_confirmed` | Award ratified by Exam Board |
| 2 | `hear_generated` | HEAR document generated |
| 3 | `graduation_invited` | Student invited to graduation ceremony |
| 4 | `ceremony_registered` | Student confirmed attendance |
| 5 | `awarded` | Award formally conferred |
| 6 | `certificate_issued` | Certificate record created; certificate dispatched |
| 7 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `award_confirmed` | HEAR generated | `hear_generated` | System |
| `hear_generated` | Graduation invitation issued | `graduation_invited` | Registry |
| `graduation_invited` | Student registers | `ceremony_registered` | Student |
| `graduation_invited` | In absentia pathway | `awarded` | Registry |
| `ceremony_registered` | Ceremony conducted | `awarded` | System |
| `awarded` | Certificate record created | `certificate_issued` | System |
| `certificate_issued` | Enrolment status set to Graduated | `closed` | System |

### On reaching `closed`
- Enrolment status updated to Graduated (bitemporally)
- EDRMS notified of certificate record (F-SIS-EDRMS-01)
- IAM account status updated
- Domain event `srs.student.graduated` published

---

## W012 — CAS Creation `Regulatory`

**Trigger**: International student admitted and enrolment confirmed; or continuing student requires visa renewal.
**Actors**: International/Registry team, Student, UKVI.

### States

| # | State | Description |
|---|---|---|
| 1 | `request_raised` | CAS creation required; student details verified |
| 2 | `verification_pending` | Identity and eligibility verification in progress |
| 3 | `verified` | Student details verified and CAS details prepared |
| 4 | `cas_created` | CAS reference assigned |
| 5 | `cas_issued_to_student` | CAS reference provided to student |
| 6 | `closed` | Workflow complete |

### State Transitions

| From | Event | To | Actor |
|---|---|---|---|
| `request_raised` | Verification initiated | `verification_pending` | Registry |
| `verification_pending` | Verification complete | `verified` | Registry |
| `verified` | CAS submitted to UKVI (F-SIS-UKVI-01) | `cas_created` | System |
| `cas_created` | CAS reference received | `cas_issued_to_student` | System |
| `cas_issued_to_student` | Student notified | `closed` | System |
