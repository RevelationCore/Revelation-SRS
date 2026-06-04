# Functional Requirements

> Status: Draft — Phase 1
> Last updated: 2026-06-04
> Traceability: Reference model flows are cited as F-nnn. See `docs/reference/revelation-student-records-enterprise-reference-model-2.1.json` for flow detail.
> Priority: **M** = Must Have · **S** = Should Have · **C** = Could Have

---

## 1. Student Identity and Personal Data (SID)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| SID-001 | The system shall create and maintain a unique student record for each individual, identified by a system-generated UUID and a human-readable student number. | — | M |
| SID-002 | The system shall record and maintain core personal data: legal name, preferred name, date of birth, gender, nationality, and contact details (address, email, phone). | F045 | M |
| SID-003 | The system shall store personal data fields bitemporally, preserving both the real-world valid period and the transaction time at which each change was recorded. | — | M |
| SID-004 | The system shall assign and store the HESA student identifier, propagating it to all systems that require it. | F048 | M |
| SID-005 | The system shall record the outcome of identity verification checks, including verification status, confidence score, and fraud flag. | F026 | M |
| SID-006 | The system shall initiate identity verification requests by transmitting student identity data to an Online ID Verification service. | F025 | M |
| SID-007 | The system shall allow students to update their own contact details and personal data through a self-service interface, subject to validation rules. | F011 | M |
| SID-008 | The system shall record a student's disability declarations and their current declaration status. | F053 | M |
| SID-009 | The system shall support a student record in multiple statuses: Prospective, Enrolled, Intermitting, Withdrawn, Suspended, Graduated, Deceased. | — | M |
| SID-010 | The system shall record the source of a student record's creation (UCAS, direct application, manual entry) for audit purposes. | F045 | M |

---

## 2. Programme and Module Catalogue (CAT)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| CAT-001 | The system shall maintain a catalogue of programmes, each with a unique code, title, qualification type, credit framework, duration, and awarding body. | F001 | M |
| CAT-002 | The system shall maintain a catalogue of modules, each with a unique code, title, credit value, level, and assessment structure. | F001 | M |
| CAT-003 | The system shall record prerequisite and co-requisite relationships between modules. | F001 | M |
| CAT-004 | The system shall record learning outcomes for programmes and modules. | F001 | M |
| CAT-005 | The system shall receive and process catalogue updates from an external Curriculum Management system. | F001 | M |
| CAT-006 | The system shall provide enrolment, completion, and performance metrics to a Curriculum Management system to support evidence-based curriculum review. | F002 | S |
| CAT-007 | The system shall version the programme and module catalogue bitemporally, so that any historical enrolment can be reconstructed against the rules in force at the time. | — | M |
| CAT-008 | The system shall support academic year and period definitions, associating modules with the periods in which they are delivered. | — | M |
| CAT-009 | The system shall record approved changes to programmes and modules with an effective date, preserving the prior version. | — | M |

---

## 3. Enrolment and Registration (ENR)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ENR-001 | The system shall create an enrolment record linking a student to a programme, capturing start date, intended end date, mode of study, and attendance type. | F005, F045 | M |
| ENR-002 | The system shall support enrolment status transitions: Enrolled → Intermitting, Enrolled → Withdrawn, Enrolled → Suspended, Enrolled → Graduated. Each transition shall be recorded bitemporally. | — | M |
| ENR-003 | The system shall record the fee liability for each enrolled student, including fee amount, fee type, and funding source (SLC, self-funded, sponsored). | F009 | M |
| ENR-004 | The system shall confirm enrolment to UCAS upon successful registration and notify UCAS of withdrawals, deferrals, and no-shows. | F046 | M |
| ENR-005 | The system shall transmit enrolment confirmation to the Student Loans Company to trigger fee and maintenance loan release. | F049 | M |
| ENR-006 | The system shall notify the Student Loans Company of changes to enrolment status that affect loan entitlement. | F049 | M |
| ENR-007 | The system shall initiate a CAS creation request to UKVI for students requiring a Student visa, based on enrolment status and nationality. | F051 | M |
| ENR-008 | The system shall support annual re-enrolment, allowing students to confirm continuation for the next academic year. | — | M |
| ENR-009 | The system shall record the academic level of each enrolment (undergraduate, postgraduate taught, postgraduate research, CPD, etc.). | — | M |
| ENR-010 | The system shall support concurrent enrolments where an institution permits students to be registered on more than one programme simultaneously. | — | S |

---

## 4. Module Registration (REG)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| REG-001 | The system shall allow students to register for modules, subject to prerequisite checking and registration window constraints. | F011 | M |
| REG-002 | The system shall record module registrations bitemporally, preserving the history of additions and withdrawals. | — | M |
| REG-003 | The system shall enforce module registration credit limits per period, as defined by programme rules. | — | M |
| REG-004 | The system shall provide confirmed module registration data to the Timetabling system to support schedule generation. | F003 | M |
| REG-005 | The system shall receive finalised timetable and room allocation data from the Timetabling system and make it available to students. | F004 | M |
| REG-006 | The system shall provide a student roster to the Attendance Monitoring system, identifying which students are registered for each timetabled activity. | F014 | M |
| REG-007 | The system shall provide confirmed module registration data to the VLE, so that the correct students are enrolled in the corresponding online course. | F015 | M |

---

## 5. Assessment and Results (ASS)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ASS-001 | The system shall receive and record assessment grades from all assessment sources (VLE, paper-based, practical, portfolio). | F016 | M |
| ASS-002 | The system shall aggregate marks across assessment components for a module, applying configured weighting rules to produce a module mark. | — | M |
| ASS-003 | The system shall apply configured late submission penalty rules to assessment marks, suppressing penalties where an approved adjustment is in force. | — | M |
| ASS-004 | The system shall record mark changes and the reason for each change, with full audit trail. | — | M |
| ASS-005 | The system shall prevent modification of assessment records that have been ratified by an Exam Board, except through a formal correction workflow. | F065 | M |
| ASS-006 | The system shall support result entry for resit assessments, tracking the original mark and the resit mark separately. | — | M |
| ASS-007 | The system shall generate a module result for each registered student, incorporating marks from all components and applied rules. | — | M |
| ASS-008 | The system shall record the assessment structure (components, weightings, pass marks) for each module, versioned against the academic year. | — | M |
| ASS-009 | The system shall provide student identity, module registrations, and submission context to the Academic Integrity system to support misconduct case management. | F070 | M |
| ASS-010 | The system shall receive academic misconduct outcomes and penalties from the Academic Integrity system and record them against the student and module. | F069 | M |

---

## 6. Progression and Awards (PRG)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PRG-001 | The system shall evaluate student progression against configured programme rules at the end of each academic year, determining outcomes: progress, resit, repeat year, withdraw. | — | M |
| PRG-002 | The system shall apply configured compensation and condonement rules when evaluating progression, within the parameters set by institutional regulations. | — | M |
| PRG-003 | The system shall calculate a degree classification recommendation for eligible students, applying the configured classification algorithm and boundary rules. | — | M |
| PRG-004 | The system shall record the final award for each graduating student, including qualification title, classification, and award date. | — | M |
| PRG-005 | The system shall generate a Higher Education Achievement Record (HEAR) for each student, capturing all academic achievements, awards, and co-curricular activities. | — | S |
| PRG-006 | The system shall apply approved progression rule configurations bitemporally, so that any decision can be reconstructed under the rules that applied at the time. | — | M |
| PRG-007 | The system shall record research degree milestones (confirmation of registration, upgrade, thesis submission, viva outcome) received from the CRIS. | F038 | S |

---

## 7. Exam Board and Academic Governance (GOV)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| GOV-001 | The system shall generate a complete Exam Board data pack for each board meeting, including: module marks, component breakdowns, pre-board classification recommendations, compensation and condonement calculations, approved exceptional circumstances flags, approved adjustment indicators, and academic misconduct outcomes. | F064 | M |
| GOV-002 | The system shall make board data packs available to authorised Exam Board members and the External Examiner through secure, access-controlled interfaces. | F064, F067 | M |
| GOV-003 | The system shall receive ratified academic decisions from the Exam Board and record them as the authoritative, locked outcome. | F065 | M |
| GOV-004 | The system shall lock all academic records covered by an Exam Board ratification. Locked records shall not be modifiable outside of an approved formal correction or appeal workflow. | F065 | M |
| GOV-005 | The system shall record the identity of board members present at ratification, the date of ratification, and the confirmation of external examiner sign-off. | F065, F068 | M |
| GOV-006 | The system shall provide the External Examiner with access to sampled assessed work, full candidate result profiles, and pre-board classification calculations. | F067 | M |
| GOV-007 | The system shall support a post-ratification appeal workflow, allowing record amendments with full authorisation trail only on successful appeal or approved correction. | — | M |
| GOV-008 | The system shall provide exam scheduling data to the Exam Scheduling system: student entries, module registrations, and approved examination accommodations. | F061 | M |
| GOV-009 | The system shall receive finalised exam timetables, seating plans, and candidate numbers from the Exam Scheduling system and make them available to students. | F062 | M |
| GOV-010 | The system shall surface a record-lock status field on every academic record, indicating whether the record has been ratified and is locked. | — | M |

---

## 8. Reasonable Adjustments (ADJ)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ADJ-001 | The system shall receive approved reasonable adjustment outcomes from the Student Wellbeing and Disability system. | F063 | M |
| ADJ-002 | The system shall record approved adjustment outcomes bitemporally against the student record, with effective dates and audit trail. | F063 | M |
| ADJ-003 | The system shall distribute approved adjustment outcomes to all downstream systems that require them: VLE, Attendance Monitoring, and Exam Scheduling. | F059, F060, F061 | M |
| ADJ-004 | The system shall be the sole distribution point for adjustment data to downstream systems. No downstream system shall receive adjustment data directly from the Wellbeing system. | F059, F060 | M |
| ADJ-005 | The system shall surface adjustment indicators in Exam Board data packs where they are relevant to board consideration. | F064 | M |
| ADJ-006 | The system shall provide the Student Wellbeing and Disability system with student profiles, disability declarations, and academic records to support case management. | F053 | M |

---

## 9. Exceptional Circumstances (EXC)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| EXC-001 | The system shall receive approved exceptional circumstances outcomes from the Student Wellbeing and Disability system. | F066 | M |
| EXC-002 | The system shall record approved exceptional circumstances flags against the student and the relevant module(s), with the determination date and outcome. | F066 | M |
| EXC-003 | The system shall surface exceptional circumstances flags in Exam Board data packs for board consideration, alongside the relevant module marks. | F064 | M |
| EXC-004 | The system shall maintain a clear distinction between exceptional circumstances (ad hoc, time-bound, for board consideration) and reasonable adjustments (ongoing operational accommodations). | — | M |

---

## 10. Academic Integrity (ACI)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ACI-001 | The system shall receive confirmed academic misconduct outcomes and penalties from the Academic Integrity system once a case is concluded. | F069 | M |
| ACI-002 | The system shall record misconduct outcomes against the student record and the relevant assessment, with audit trail. | F069 | M |
| ACI-003 | The system shall surface misconduct outcomes in Exam Board data packs for board consideration. | F064 | M |
| ACI-004 | The system shall provide the Academic Integrity system with student identity, module registrations, and submission records to support case management. | F070 | M |

---

## 11. Regulatory — UCAS (UCR)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| UCR-001 | The system shall receive and process application data, offer decisions, and clearing records from UCAS. | F045 | M |
| UCR-002 | The system shall create a student record and initiate the enrolment workflow on receipt of a confirmed acceptance from UCAS. | F045 | M |
| UCR-003 | The system shall transmit enrolment confirmations, withdrawal notifications, deferral records, and no-show notifications to UCAS. | F046 | M |
| UCR-004 | The system shall support UCAS Clearing, processing late applications and offers during the clearing period. | F045 | S |

---

## 12. Regulatory — HESA (HES)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| HES-001 | The system shall generate the annual HESA Student Record return, covering all enrolled students, their programme details, module registrations, qualifications awarded, and demographic data, conforming to the current HESA coding manual. | F047 | M |
| HES-002 | The system shall validate the HESA return against HESA business rules before submission, reporting errors and warnings to the submitting user. | F047 | M |
| HES-003 | The system shall submit the HESA return via the appropriate exchange mechanism and record the submission outcome. | F047 | M |
| HES-004 | The system shall receive HESA validation reports and HESA student identifiers, storing and propagating the identifiers to all systems that require them. | F048 | M |
| HES-005 | The system shall support amendments to a submitted HESA return, tracking the delta between the original and amended submission. | F047 | S |

---

## 13. Regulatory — Student Loans Company (SLC)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| SLC-001 | The system shall confirm enrolment to the Student Loans Company for each eligible student, triggering tuition fee loan release to the institution and maintenance loan release to the student. | F049 | M |
| SLC-002 | The system shall notify the Student Loans Company of changes to enrolment status (withdrawal, intermission, change of intensity) that affect loan entitlement. | F049 | M |
| SLC-003 | The system shall receive and record loan entitlement, payment status, and overpayment notifications from the Student Loans Company. | F050 | M |

---

## 14. Regulatory — UKVI (UKV)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| UKV-001 | The system shall generate CAS creation requests for international students requiring a Student visa and transmit them to UKVI. | F051 | M |
| UKV-002 | The system shall provide ongoing attendance compliance data to UKVI as required under the institution's sponsor licence obligations. | F051 | M |
| UKV-003 | The system shall receive and record visa status updates from UKVI, including grants, refusals, curtailments, and sponsor compliance alerts. | F052 | M |
| UKV-004 | The system shall generate alerts when a sponsored student's attendance falls below the configured UKVI compliance threshold, triggering the compliance workflow. | — | M |
| UKV-005 | The system shall maintain records sufficient to demonstrate sponsor licence compliance for inspection by UKVI. | F051 | M |

---

## 15. Regulatory — OfS and Other (OFS)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| OFS-001 | The system shall provide data extracts sufficient to support OfS B3 student outcome and experience condition reporting. | — | M |
| OFS-002 | The system shall support generation of access and participation plan progress reports from student enrolment and outcome data. | — | S |
| OFS-003 | The system shall maintain records sufficient to support the institution's obligations under the Prevent duty, including any required notifications. | — | M |
| OFS-004 | The system shall support responses to Freedom of Information requests by providing authorised administrators with structured data extracts. | — | M |
| OFS-005 | The system shall provide accurate, current course information in a format suitable for consumer-facing publication, supporting CMA guidance compliance. | — | S |

---

## 16. Finance Integration (FIN)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| FIN-001 | The system shall provide enrolment and tuition fee liability data to the Finance system to enable accurate student billing. | F009 | M |
| FIN-002 | The system shall receive payment confirmations and financial hold status from the Finance system, recording the effect on the student's account standing. | F010 | M |
| FIN-003 | The system shall provide authorised lists of bursary-eligible students and GTA payment authorisations to the Payroll system. | F035 | S |
| FIN-004 | The system shall receive bursary and stipend payment confirmations from the Payroll system and record them against the student record. | F036 | S |

---

## 17. Library Integration (LIB)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| LIB-001 | The system shall provide the Library system with student enrolment status and access rights to enable or restrict library privileges. | F008 | M |
| LIB-002 | The system shall receive library loans, fines, and overdue notifications from the Library system and record any outstanding obligations against the student record. | F007 | S |

---

## 18. Enterprise Web Portal (EWP)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| EWP-001 | The system shall provide the Enterprise Web Portal with authoritative student data: enrolment status, timetable, module registrations, grades, notifications, and exam timetable. | F012 | M |
| EWP-002 | The system shall receive student self-service updates from the Enterprise Web Portal: personal data changes, module selections, and declaration submissions. | F011 | M |
| EWP-003 | The SRS Core shall not hold authoritative personalised communications from CRM. Where the Revelation Enterprise Web Portal is deployed, CRM-to-portal communications may be surfaced by the portal as a non-SIS-facing integration and shall not create authoritative SRS records. | F058 | C |

---

## 19. Attendance Monitoring Integration (ATT)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ATT-001 | The system shall receive attendance records and absence alerts from the Attendance Monitoring system and maintain a consolidated engagement record per student. | F013 | M |
| ATT-002 | The system shall provide the Attendance Monitoring system with the student roster and academic calendar. | F014 | M |
| ATT-003 | The system shall distribute approved attendance adjustment outcomes to the Attendance Monitoring system. | F060 | M |

---

## 20. VLE Integration (VLE)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| VLE-001 | The system shall provide the VLE with student enrolment data, module registrations, and term dates to enable course access provisioning. | F015 | M |
| VLE-002 | The system shall receive assessment grades, completion status, and academic alerts from the VLE. | F016 | M |
| VLE-003 | The system shall distribute approved reasonable adjustment outcomes to the VLE, including extended deadlines, alternative formats, and accessible content requirements. | F059 | M |

---

## 21. Accommodation Integration (ACC)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ACC-001 | The system shall provide the Accommodation system with student profiles, enrolment status, and programme details to support housing allocations. | F017 | S |
| ACC-002 | The system shall receive room allocation, booking status, and check-in/out records from the Accommodation system. | F018 | S |

---

## 22. Identity and Access Management Integration (IAM)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| IAM-001 | The system shall provide the IAM system with student identity, enrolment status, and access eligibility data to enable account provisioning. | F021 | M |
| IAM-002 | The system shall receive credential updates, account locks, and role assignments from the IAM system. | F022 | M |

---

## 23. Document and Records Management Integration (EDR)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| EDR-001 | The system shall transmit official student documents (enrolment forms, transcripts, graduation certificates) to the EDRMS for secure, compliant storage. | F023 | S |
| EDR-002 | The system shall receive document archive confirmations and access logs from the EDRMS. | F024 | S |

---

## 24. Analytics and Reporting (ANA)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ANA-001 | The system shall provide the Business Intelligence platform with structured extracts of student performance, enrolment, module outcomes, and retention data. | F027 | M |
| ANA-002 | The system shall receive at-risk flags and predictive intervention alerts from the Business Intelligence platform and record them against the student record. | F028 | S |
| ANA-003 | The system shall provide the Data Warehouse with full and incremental extracts of student data for longitudinal reporting. | F029 | M |
| ANA-004 | The system shall receive data quality reports and reconciliation alerts from the Data Warehouse and surface them to data administrators. | F030 | S |
| ANA-005 | The system shall provide the Student Evaluation of Teaching system with module rosters for survey distribution. | F031 | S |
| ANA-006 | The system shall receive survey completion rates and aggregated feedback scores from the Student Evaluation system. | F032 | C |

---

## 25. HR, Payroll and Research Integration (HRP)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| HRP-001 | The system shall provide HR with records of students holding dual roles (GTAs, research assistants, student ambassadors). | F033 | S |
| HRP-002 | The system shall receive academic supervisor and personal tutor assignment confirmations from HR. | F034 | M |
| HRP-003 | The system shall provide the CRIS with enrolment data for postgraduate research students. | F037 | S |
| HRP-004 | The system shall receive research degree milestones and publication records from the CRIS. | F038 | S |
| HRP-005 | The system shall provide Research Proposals with student researcher eligibility and supervisor assignment data. | F039 | C |
| HRP-006 | The system shall receive funded research studentship award records from the Research Proposals system. | F040 | C |

---

## 26. Platform — Authentication and Authorisation (PLT-SEC)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-SEC-001 | The system shall authenticate all human users via OAuth 2.0 / OIDC, integrating with institutional IAM systems and the bundled identity provider. | — | M |
| PLT-SEC-002 | The system shall enforce role-based access control on all data and operations. A user's effective permissions shall be the union of their assigned roles. | — | M |
| PLT-SEC-003 | The system shall enforce row-level security at the database layer, scoping all data access to the user's assigned tenant and permitted data scope. | — | M |
| PLT-SEC-004 | The system shall authenticate all service-to-service integrations using client credentials (OAuth 2.0) or signed tokens. No integration endpoint shall be unauthenticated. | — | M |
| PLT-SEC-005 | The system shall grant each integration the minimum permissions required to perform its defined function. | — | M |

---

## 27. Platform — Audit Trail (PLT-AUD)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-AUD-001 | The system shall generate an immutable audit record for every change to a data record, regardless of the origin of the change. | — | M |
| PLT-AUD-002 | Each audit record shall capture: entity type, record identifier, field(s) changed, before value, after value, actor identity, UTC timestamp, and reason or workflow step reference where applicable. | — | M |
| PLT-AUD-003 | The system shall generate an audit record for read access to data records classified as sensitive or special category. | — | M |
| PLT-AUD-004 | Audit records shall be append-only and shall never be modified or deleted. | — | M |
| PLT-AUD-005 | The system shall provide an audit log search and export facility for authorised administrators, sufficient to support regulatory inspection and data subject access requests. | — | M |

---

## 28. Platform — Bitemporal Data (PLT-TMP)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-TMP-001 | The system shall store all temporally mutable data with both a valid-time period (when the fact was true in the world) and a transaction-time period (when the fact was recorded in the system). | — | M |
| PLT-TMP-002 | The system shall support point-in-time queries against any temporally mutable record, returning the state as of a specified valid time and/or transaction time. | — | M |
| PLT-TMP-003 | The system shall not perform destructive updates on temporal records. Prior states shall always be recoverable. | — | M |
| PLT-TMP-004 | Open-ended temporal records shall use a null valid-time end value rather than a sentinel date. | — | M |

---

## 29. Platform — Workflow (PLT-WFL)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-WFL-001 | The system shall manage all long-running, multi-actor processes through a durable workflow engine. | — | M |
| PLT-WFL-002 | Workflow instances shall survive service restarts and deployments without loss of state. | — | M |
| PLT-WFL-003 | The system shall assign tasks to human actors within workflows and notify those actors of pending tasks. | — | M |
| PLT-WFL-004 | The system shall enforce workflow deadlines and escalate to a configured actor when a deadline is breached. | — | M |
| PLT-WFL-005 | All workflow state transitions shall be written to the audit trail. | — | M |
| PLT-WFL-006 | Authorised administrators shall be able to view the current state and history of any workflow instance. | — | M |

---

## 30. Platform — Multi-Tenancy (PLT-MT)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-MT-001 | The system shall support multiple tenants (institutions) within a single deployment, with complete data isolation between tenants enforced at the database layer. | — | M |
| PLT-MT-002 | Each tenant shall have independently managed configuration: integration endpoints, business rules, assessment regulations, branding, and user roles. | — | M |
| PLT-MT-003 | Tenant provisioning shall be automated and manageable through a system administration interface without code changes or redeployment. | — | M |
| PLT-MT-004 | A tenant administrator shall be able to configure, enable, and disable integration adapters for their institution independently. | — | M |

---

## 31. Platform — Integration Layer (PLT-INT)

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| PLT-INT-001 | The system shall publish a domain event to the message broker for every significant state change in the SRS, following the domain event taxonomy. | — | M |
| PLT-INT-002 | The system shall expose all SRS capabilities through versioned REST API endpoints, documented with OpenAPI 3.x specifications. | — | M |
| PLT-INT-003 | The system shall support file-based data exchange (structured inbound and outbound files) for bulk and regulatory integrations. | — | M |
| PLT-INT-004 | The system shall maintain a plugin registry recording all active integrations, their contract versions, enabled status, and health. | — | M |
| PLT-INT-005 | Integration failures shall be logged, alerted, and retried according to a configured retry and dead-letter policy. Failures shall not result in silent data loss. | — | M |
| PLT-INT-006 | The system shall validate all inbound data against the integration contract before processing. Invalid data shall be rejected with a structured error response and logged. | — | M |

---

## 32. CRM Integration (CRM)

> **Scope note:** F006 (SIS→CRM) was absent from the original requirements. It is added here as Should Have.

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| CRM-001 | The system shall transmit student enrolment status and progression updates to the CRM system, enabling accurate engagement records and post-enrolment communications. | F006 | S |
| CRM-002 | The system shall notify the CRM of student withdrawal, intermission, and graduation events. | F006 | S |

---

## 33. Estates Integration (EST)

> **Scope note:** F019 and F020 (SIS↔Estates) were absent from the original requirements. Added as Could Have.

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| EST-001 | The system shall provide the Estates system with enrolment volumes, timetable data, and occupancy forecasts to support campus facilities planning. | F019 | C |
| EST-002 | The system shall receive room allocation confirmations and availability updates from the Estates system. | F020 | C |

---

## 34. Content Management Integration (CMS)

> **Scope note:** F041 and F042 were absent from the original requirements. Added as Could Have; F042 supports CMA consumer protection and regulatory publication obligations.

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| CMS-001 | The system shall provide the Content Management System with student cohort and programme data to enable targeted and personalised content delivery. | F041 | C |
| CMS-002 | The system shall receive notifications from the CMS when significant regulatory, policy, or procedural documents are published that require annotation against student records. | F042 | C |

---

## 35. IT Service Management Integration (ITSM)

> **Scope note:** F043 and F044 were absent from the original requirements. Added as Could Have.

| ID | Requirement | Flows | Priority |
|---|---|---|---|
| ITSM-001 | The system shall provide the IT Service Management platform with student identity, enrolment status, and system access details for incident context. | F043 | C |
| ITSM-002 | The system shall receive notifications from ITSM of resolved service requests or incidents that result in changes to a student's account status. | F044 | C |

---

## Reference Flows — Out of Scope

The following reference model flows do not involve the SIS directly. They describe enterprise ecosystem flows between other systems and are treated as **reference context** only. Revelation SRS does not own or implement these flows unless a future decision explicitly brings them in scope.

| Flow | Direction | Reason excluded |
|---|---|---|
| F055 | VLE → BI | Non-SIS-facing; BI integration covered by F027/F028 (SIS→BI, BI→SIS) |
| F056 | AM → BI | Non-SIS-facing; Attendance data reaches BI via F029 DW extract |
| F057 | DW → BI | Non-SIS-facing; internal analytics infrastructure |
| F058 | CRM → EWP | Non-SIS-facing; portal communications owned by CRM/EWP, not SRS |
