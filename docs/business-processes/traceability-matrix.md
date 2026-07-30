# Business Process Traceability Matrix

> Status: Initial working crosswalk
> Last updated: 2026-07-26

This matrix connects business outcomes to current Revelation design. It records alignment and gaps; it does not imply that current implementation defines sector practice.

P0 findings have detailed [functional requirements and ADR mappings](p0-requirements-and-adr-traceability.md).

Data findings BPR-D01–BPR-D19 have a completed [logical/physical delta assessment](../architecture/business-process-data-model-delta.md).

## Domain crosswalk

Principal integration flows are summarised by system pair below; see the [Enterprise Reference Model](../reference/revelation-student-records-reference-model.md) for the specific `F-<FROM>-<TO>-<nn>` identifiers each pair covers.

| BP range | Domain | Existing workflows | Principal system pairs | Principal data areas | Initial finding |
|---|---|---|---|---|---|
| BP-01-001–BP-01-007 | Recruitment and admissions | W001, W012 | CRM↔SIS, OIV↔SIS, UCAS↔SIS, UKVI↔SIS | `student_application`, `admissions_offer`, identity and CAS entities | W001 requires decomposition |
| BP-02-001–BP-02-012 | Registration and status | W001, W007, W010, W012 | LIB↔SIS, FIN↔SIS, EWP↔SIS, AM↔SIS, VLE↔SIS, IAM↔SIS, UCAS↔SIS, HESA↔SIS, SLC↔SIS, UKVI↔SIS | identity, enrolment, fee, hold, re-registration and compliance entities | Transfer/return/closure coverage incomplete |
| BP-03-001–BP-03-007 | Curriculum and modules | None complete | CM↔SIS, TTB↔SIS, AM←SIS, VLE↔SIS, SETS←SIS, HR→SIS, CRIS↔SIS, RP↔SIS | programme, route, module, registration, staff and research entities | No durable module-registration or PGR setup workflow |
| BP-04-001–BP-04-006 | Learning, engagement and support | W002, W003, W009 | AM↔SIS, BI↔SIS, WELL↔SIS, VLE←SIS, EXAMS↔SIS | attendance, engagement, adjustment, EC and research milestones | PGR progress absent from workflow catalogue |
| BP-05-001–BP-05-011 | Assessment and results | W004, W005, W006 | VLE→SIS, EXAMS↔SIS, WELL→SIS, EXAMBOARD↔SIS, EXTEX↔SIS/EXAMBOARD, AI↔SIS | assessment, marks, results, boards, misconduct and amendment entities | W005 spans several business outcomes |
| BP-06-001–BP-06-006 | Progression, awards and graduation | W005, W011 | EWP←SIS, EDRMS↔SIS, DW←SIS | progression, award, document and research completion data | PGR completion only partially represented |
| BP-07-001–BP-07-008 | Regulatory/statutory | W008, W009, W012 | HESA↔SIS, SLC↔SIS, UKVI↔SIS, OfS←SIS | HESA, SLC, CAS/visa/compliance and extracts | Scotland/Wales/NI regulator/funder contracts absent |
| BP-08-001–BP-08-006 | Record governance | W006 partial | EDRMS↔SIS, DW→SIS, affected entity contracts | identity, bitemporal versions, audit, documents | DSAR, rights and retention workflows absent |

## Pilot detailed crosswalk

| Process | Workflow | Requirements | Entities | Events | Contracts | Alignment/gap |
|---|---|---|---|---|---|---|
| BP-02-010 Complete annual re-registration | W010 | ENR-003, ENR-005, ENR-008–ENR-010; REG-001–REG-007 where coupled | `enrolment`, `reenrolment_period`, `reenrolment_confirmation`, `person_identity`, `student_address`, `student_contact_method`, `fee_liability`, `student_hold`, `slc_notification`, `integration_exchange` | `srs.student.re-enrolled` and `srs.enrolment.fee-liability-updated` are documented but remain in the not-implemented event backlog | `portal-self-service-update.v1`, `finance-fee-liability.v1`, `slc-enrolment-exchange.v1`, `iam-account-provisioning.v1`, `vle-course-provisioning.v1`, `library-access-entitlement.v1` | Current W010 provides a state skeleton; national/student-mode variations, acknowledgement/reconciliation and non-registration outcome need more detail |

## Registration and student-status wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-02-001 Prepare initial registration | W001 partial | Person, application, offer, obligations | Admissions, UCAS, IAM | Explicit registration-case/worklist is absent |
| BP-02-002 Verify identity/right to study | W001/W012 partial | Identity check, visa and sponsor evidence | Online ID Verification, UKVI | Identity and immigration outcomes require separate controls |
| BP-02-003 Initial academic registration | W001 | Enrolment, route, terms/declarations | Portal, admissions/UCAS | Accepted terms version/channel are not modelled |
| BP-02-004 Financial registration | W001 partial | Fee liability, payment/hold and funding refs | Finance, SLC | Academic and financial registration states are not explicit |
| BP-02-005 Activate access/entitlements | W001 partial | Account/access and exchange ledger | IAM, Library, VLE, attendance, portal | No canonical entitlement matrix/core-ready threshold |
| BP-02-006 Transfer programme/route/mode | Gap | Enrolment versions, credit/rules, fees/CAS | Curriculum, Finance, SLC, UKVI and services | No complete workflow or specific transfer event |
| BP-02-007 Interrupt/suspend studies | W007 partial | Enrolment, conditions, dates, liability | Finance, SLC, UKVI and services | W007 lacks evidence/approval/return-condition detail |
| BP-02-008 Return from interruption | Gap | Enrolment, return plan, curriculum/modules | Finance, SLC, UKVI and services | No durable return workflow |
| BP-02-009 Withdraw | W007 partial | Enrolment, academic history, liability | Finance, SLC, UKVI, IAM, services | Voluntary/institutional routes and date authority need separation |
| BP-02-011 Resolve non-registration | W010→W007 gap | Case/evidence, registration and enrolment status | Communications, SLC, UKVI, services | Missing investigation/decision stage before withdrawal |
| BP-02-012 Close leaver record | W007/W011 partial | Closure worklist, documents, retention, exchanges | All entitlement/regulatory systems, EDRMS | No durable per-target closure workflow |

## Curriculum, module-registration and PGR-supervision wave

| Process | Workflow alignment | Principal data | Principal integrations | Material Revelation finding |
|---|---|---|---|---|
| BP-03-001 Import and publish curriculum | Gap | Programme, route, module, offering and rule-set versions | Curriculum management, metrics and timetabling | No atomic publication/version workflow or protection for assigned cohorts |
| BP-03-002 Assign route and rules | W001 partial | Enrolment, route/rule-set binding and recognised credit | Curriculum and admissions | No explicit effective route/rule-set assignment with decision provenance |
| BP-03-003 Select modules | Gap | Selection proposal, preferences and candidate modules | Portal and curriculum | Current model lacks a durable proposed-selection state |
| BP-03-004 Validate and approve selection | Gap | Validation outcomes, approvals, exceptions and registration | Portal, curriculum and timetabling capacity | Current service creates `registered` immediately; approval, waitlist and exception states are absent |
| BP-03-005 Change registration | Gap | Add/drop request, effective registration versions and impact decision | Portal, finance, timetabling, VLE and attendance | No atomic substitution/change approval or assessment-impact guard |
| BP-03-006 Provision registrations | Gap | Registration and per-target exchange state | Timetabling, VLE and attendance | No general per-target acknowledgement/reconciliation ledger for provisioning |
| BP-03-007 Establish PGR supervision | Gap | Supervision case, `staff_assignment` and research context | HR, CRIS and Research Proposals | Inbound staff assignment does not model nomination, academic approval or initial working arrangements |

## Remaining-wave architecture findings

| BP range | Detailed decomposition now documented | Principal new/extended records indicated | Highest-impact Revelation gap |
|---|---|---|---|
| BP-01-001–BP-01-007 | Application intake, assessment, offer, confirmation, CAS, Clearing and conversion | Received application payload, assessment, condition evidence, CAS case, Clearing permission and conversion ledger | W001 combines distinct decisions and does not preserve every source/authority boundary |
| BP-04-001–BP-04-006 | Engagement evidence/intervention, PGR review, adjustments, exceptional circumstances and distribution | Expected engagement event/evidence, intervention, PGR review/panel, scoped support outcome and distribution ledger | Specialist evidence, SRS outcome and regulatory decision are not consistently separated |
| BP-05-001–BP-05-011 | Assessment setup, entry, marking, moderation, calculation, misconduct, boards, external review, ratification, PGR examination and correction | Assessment-pattern version, candidate attempt, mark-set/moderation, board snapshot/decision, thesis examination and amendment case | W005 is too broad to demonstrate rule-version binding, decision authority and immutable ratification |
| BP-06-001–BP-06-006 | Progression, reassessment, award, documents, ceremony and PGR completion | Progression explanation, repeat-study plan, award recommendation/conferment, document instance and PGR closure | Recommendation, conferment, documentation and ceremony status need separate lifecycles |
| BP-07-001–BP-07-008 | HESA, student finance, sponsor, OfS, SFC, Medr, DfE and quality correction | Collection specification/snapshot, field lineage, submission/sign-off, response and data-quality issue | Devolved regulator/funder contracts and reproducible submission evidence are absent |
| BP-08-001–BP-08-006 | Identity resolution, correction, access, rights, retention/disposal and audit | Identity-resolution case, bitemporal correction, rights case, restriction marker, hold/disposal certificate and audit review | Cross-system governance actions lack durable workflow and reconciliation coverage |

## Coverage controls

Before SME approval:

- every W001–W012 workflow must map to at least one BP page;
- every reference-model flow (all 69, plus the locally added `F-SIS-OFS-01`) must map to at least one BP page or carry an exclusion rationale;
- every core student entity must have creation, material change, correction and closure/retention coverage;
- each national regulator/funder boundary must have an owned process or explicit out-of-scope decision; and
- PGR lifecycle gaps must be resolved or explicitly deferred.
