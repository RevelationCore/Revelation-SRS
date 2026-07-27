# Business Process Traceability Matrix

> Status: Initial working crosswalk
> Last updated: 2026-07-26

This matrix connects business outcomes to current Revelation design. It records alignment and gaps; it does not imply that current implementation defines sector practice.

P0 findings have detailed [functional requirements and ADR mappings](p0-requirements-and-adr-traceability.md).

Data findings BPR-D01–BPR-D19 have a completed [logical/physical delta assessment](../architecture/business-process-data-model-delta.md).

## Domain crosswalk

| BP range | Domain | Existing workflows | Principal integration flows/contracts | Principal data areas | Initial finding |
|---|---|---|---|---|---|
| BP-001–BP-007 | Recruitment and admissions | W001, W012 | F005–F006, F025–F026, F045–F046, F051–F052 | `student_application`, `admissions_offer`, identity and CAS entities | W001 requires decomposition |
| BP-008–BP-019 | Registration and status | W001, W007, W010, W012 | F007–F016, F021–F022, F045–F052 | identity, enrolment, fee, hold, re-registration and compliance entities | Transfer/return/closure coverage incomplete |
| BP-020–BP-026 | Curriculum and modules | None complete | F001–F004, F014–F016, F031, F034, F037–F040 | programme, route, module, registration, staff and research entities | No durable module-registration or PGR setup workflow |
| BP-027–BP-032 | Learning, engagement and support | W002, W003, W009 | F013–F014, F027–F028, F053, F059–F063, F066 | attendance, engagement, adjustment, EC and research milestones | PGR progress absent from workflow catalogue |
| BP-033–BP-043 | Assessment and results | W004, W005, W006 | F016, F061–F070 | assessment, marks, results, boards, misconduct and amendment entities | W005 spans several business outcomes |
| BP-044–BP-049 | Progression, awards and graduation | W005, W011 | F012, F023–F024, F029 | progression, award, document and research completion data | PGR completion only partially represented |
| BP-050–BP-057 | Regulatory/statutory | W008, W009, W012 | F047–F052 and F071 | HESA, SLC, CAS/visa/compliance and extracts | Scotland/Wales/NI regulator/funder contracts absent |
| BP-058–BP-063 | Record governance | W006 partial | F023–F024, F030, affected entity contracts | identity, bitemporal versions, audit, documents | DSAR, rights and retention workflows absent |

## Pilot detailed crosswalk

| Process | Workflow | Requirements | Entities | Events | Contracts | Alignment/gap |
|---|---|---|---|---|---|---|
| BP-017 Complete annual re-registration | W010 | ENR-003, ENR-005, ENR-008–ENR-010; REG-001–REG-007 where coupled | `enrolment`, `reenrolment_period`, `reenrolment_confirmation`, `person_identity`, `student_address`, `student_contact_method`, `fee_liability`, `student_hold`, `slc_notification`, `integration_exchange` | `srs.student.re-enrolled` and `srs.enrolment.fee-liability-updated` are documented but remain in the not-implemented event backlog | `portal-self-service-update.v1`, `finance-fee-liability.v1`, `slc-enrolment-exchange.v1`, `iam-account-provisioning.v1`, `vle-course-provisioning.v1`, `library-access-entitlement.v1` | Current W010 provides a state skeleton; national/student-mode variations, acknowledgement/reconciliation and non-registration outcome need more detail |

## Registration and student-status wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-008 Prepare initial registration | W001 partial | Person, application, offer, obligations | Admissions, UCAS, IAM | Explicit registration-case/worklist is absent |
| BP-009 Verify identity/right to study | W001/W012 partial | Identity check, visa and sponsor evidence | Online ID Verification, UKVI | Identity and immigration outcomes require separate controls |
| BP-010 Initial academic registration | W001 | Enrolment, route, terms/declarations | Portal, admissions/UCAS | Accepted terms version/channel are not modelled |
| BP-011 Financial registration | W001 partial | Fee liability, payment/hold and funding refs | Finance, SLC | Academic and financial registration states are not explicit |
| BP-012 Activate access/entitlements | W001 partial | Account/access and exchange ledger | IAM, Library, VLE, attendance, portal | No canonical entitlement matrix/core-ready threshold |
| BP-013 Transfer programme/route/mode | Gap | Enrolment versions, credit/rules, fees/CAS | Curriculum, Finance, SLC, UKVI and services | No complete workflow or specific transfer event |
| BP-014 Interrupt/suspend studies | W007 partial | Enrolment, conditions, dates, liability | Finance, SLC, UKVI and services | W007 lacks evidence/approval/return-condition detail |
| BP-015 Return from interruption | Gap | Enrolment, return plan, curriculum/modules | Finance, SLC, UKVI and services | No durable return workflow |
| BP-016 Withdraw | W007 partial | Enrolment, academic history, liability | Finance, SLC, UKVI, IAM, services | Voluntary/institutional routes and date authority need separation |
| BP-018 Resolve non-registration | W010→W007 gap | Case/evidence, registration and enrolment status | Communications, SLC, UKVI, services | Missing investigation/decision stage before withdrawal |
| BP-019 Close leaver record | W007/W011 partial | Closure worklist, documents, retention, exchanges | All entitlement/regulatory systems, EDRMS | No durable per-target closure workflow |

## Curriculum, module-registration and PGR-supervision wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-020 Import and publish curriculum | Gap | Programme, route, module, offering and rule-set versions | Curriculum management, metrics and timetabling | No atomic publication/version workflow or protection for assigned cohorts |
| BP-021 Assign route and rules | W001 partial | Enrolment, route/rule-set binding and recognised credit | Curriculum and admissions | No explicit effective route/rule-set assignment with decision provenance |
| BP-022 Select modules | Gap | Selection proposal, preferences and candidate modules | Portal and curriculum | Current model lacks a durable proposed-selection state |
| BP-023 Validate and approve selection | Gap | Validation outcomes, approvals, exceptions and registration | Portal, curriculum and timetabling capacity | Current service creates `registered` immediately; approval, waitlist and exception states are absent |
| BP-024 Change registration | Gap | Add/drop request, effective registration versions and impact decision | Portal, finance, timetabling, VLE and attendance | No atomic substitution/change approval or assessment-impact guard |
| BP-025 Provision registrations | Gap | Registration and per-target exchange state | Timetabling, VLE and attendance | No general per-target acknowledgement/reconciliation ledger for provisioning |
| BP-026 Establish PGR supervision | Gap | Supervision case, `staff_assignment` and research context | HR, CRIS and Research Proposals | Inbound staff assignment does not model nomination, academic approval or initial working arrangements |

## Remaining-wave architecture findings

| BP range | Detailed decomposition now documented | Principal new/extended records indicated | Highest-impact Revelation gap |
|---|---|---|---|
| BP-001–BP-007 | Application intake, assessment, offer, confirmation, CAS, Clearing and conversion | Received application payload, assessment, condition evidence, CAS case, Clearing permission and conversion ledger | W001 combines distinct decisions and does not preserve every source/authority boundary |
| BP-027–BP-032 | Engagement evidence/intervention, PGR review, adjustments, exceptional circumstances and distribution | Expected engagement event/evidence, intervention, PGR review/panel, scoped support outcome and distribution ledger | Specialist evidence, SRS outcome and regulatory decision are not consistently separated |
| BP-033–BP-043 | Assessment setup, entry, marking, moderation, calculation, misconduct, boards, external review, ratification, PGR examination and correction | Assessment-pattern version, candidate attempt, mark-set/moderation, board snapshot/decision, thesis examination and amendment case | W005 is too broad to demonstrate rule-version binding, decision authority and immutable ratification |
| BP-044–BP-049 | Progression, reassessment, award, documents, ceremony and PGR completion | Progression explanation, repeat-study plan, award recommendation/conferment, document instance and PGR closure | Recommendation, conferment, documentation and ceremony status need separate lifecycles |
| BP-050–BP-057 | HESA, student finance, sponsor, OfS, SFC, Medr, DfE and quality correction | Collection specification/snapshot, field lineage, submission/sign-off, response and data-quality issue | Devolved regulator/funder contracts and reproducible submission evidence are absent |
| BP-058–BP-063 | Identity resolution, correction, access, rights, retention/disposal and audit | Identity-resolution case, bitemporal correction, rights case, restriction marker, hold/disposal certificate and audit review | Cross-system governance actions lack durable workflow and reconciliation coverage |

## Coverage controls

Before SME approval:

- every W001–W012 workflow must map to at least one BP page;
- every F001–F071 flow must map to at least one BP page or carry an exclusion rationale;
- every core student entity must have creation, material change, correction and closure/retention coverage;
- each national regulator/funder boundary must have an owned process or explicit out-of-scope decision; and
- PGR lifecycle gaps must be resolved or explicitly deferred.
