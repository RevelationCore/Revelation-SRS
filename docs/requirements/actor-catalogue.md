# Actor Catalogue

> Status: Draft — Phase 1
> Last updated: 2026-06-04
> This catalogue defines every human and system actor that interacts with Revelation SRS. It is the primary input to the RBAC role model. Actors marked † are system actors (integrations); all others are human actors.

---

## Human Actors

### 1. Prospective Student
A person who has applied for a programme but is not yet enrolled.

| Attribute | Detail |
|---|---|
| Can read | Own application status, offer details, programme information |
| Can initiate | Application (via UCAS or direct); acceptance of offer; pre-enrolment personal data submission |
| Workflow tasks | Respond to conditional offer; submit pre-enrolment documents |
| Data provided | Personal data, prior qualifications, contact details |

---

### 2. Enrolled Student
An active student with a current enrolment record.

| Attribute | Detail |
|---|---|
| Can read | Own student record; enrolment status; module registrations; timetable; assessment results (post-publication); exam timetable and candidate number; approved adjustments; progression decisions; award record |
| Can initiate | Module registration and changes (within defined windows); personal data updates; exceptional circumstances submission; module feedback survey responses |
| Workflow tasks | Annual re-enrolment confirmation; respond to outstanding actions (e.g. outstanding documents) |
| Data provided | Personal data changes; module preferences; EC submissions |

---

### 3. Registry Administrator
Member of the institution's Registry or Student Records office responsible for managing enrolment, records, and compliance.

| Attribute | Detail |
|---|---|
| Can read | All student records within their assigned faculty/school; enrolment data; regulatory return data; workflow instances |
| Can initiate | Enrolment creation and amendment; status changes (intermission, withdrawal, suspension); manual data corrections (via audit-logged workflow); HESA return generation and submission; SLC and UKVI compliance actions; exam board data pack generation |
| Workflow tasks | Review and approve enrolment exceptions; process withdrawal requests; manage UKVI compliance alerts; correction and appeal administration |
| Data access scope | Tenant-scoped; may be further scoped to faculty or school |

---

### 4. Module Tutor / Academic Staff
An academic member of staff who teaches and assesses one or more modules.

| Attribute | Detail |
|---|---|
| Can read | Module registration lists for their modules; assessment submission status; grades submitted for their modules; student names and student numbers |
| Can initiate | Result entry for their modules (before ratification); flag academic integrity concerns |
| Workflow tasks | Result submission and confirmation; respond to moderation queries |
| Data access scope | Scoped to modules to which they are assigned |

---

### 5. Personal Tutor
An academic member of staff assigned to a cohort of students for academic and pastoral guidance.

| Attribute | Detail |
|---|---|
| Can read | Academic records of their assigned students; module registrations; progression decisions; at-risk flags; contact details |
| Can initiate | Record pastoral meeting notes (where supported); raise wellbeing referrals |
| Workflow tasks | Acknowledgement of assigned student actions; review at-risk alerts |
| Data access scope | Scoped to their assigned student cohort |

---

### 6. Research Supervisor
An academic member of staff supervising one or more postgraduate research students.

| Attribute | Detail |
|---|---|
| Can read | Academic records of their supervised PGR students; research milestones; thesis submission status |
| Can initiate | Confirm research milestones; submit progress reports |
| Workflow tasks | Confirmation of registration, upgrade, and submission milestones |
| Data access scope | Scoped to their supervised students |

---

### 7. Disability Advisor / Wellbeing Practitioner
A member of the Student Wellbeing and Disability service who manages adjustment and EC cases.

| Attribute | Detail |
|---|---|
| Can read | Student disability declarations; DSA records; academic performance indicators (as required for casework); existing adjustment and EC records |
| Can initiate | Disability case creation; reasonable adjustment assessment; exceptional circumstances determination; wellbeing referral |
| Workflow tasks | Conduct adjustment assessment; approve/reject adjustment outcomes; determine EC outcomes; transmit approved outcomes to SIS |
| Data access scope | Special category data; access audited |

---

### 8. Exam Board Chair
The academic member of staff who chairs an Exam Board meeting.

| Attribute | Detail |
|---|---|
| Can read | Full board data pack for their board (all candidate profiles, marks, recommendations, EC flags, adjustment indicators, misconduct outcomes) |
| Can initiate | Formal ratification of board outcomes |
| Workflow tasks | Review and ratify board decisions; sign off record lock; confirm external examiner attendance |
| Data access scope | Scoped to their board's student population |

---

### 9. External Examiner
An independent academic appointed from another UK HEI for standards assurance.

| Attribute | Detail |
|---|---|
| Can read | Sampled assessed work; full candidate result profiles; pre-board classification calculations; borderline and flagged cases |
| Can initiate | Submit standards assurance commentary; provide ratification confirmation |
| Workflow tasks | Review sampled work; attend Exam Board; submit annual report |
| Data access scope | Read-only; scoped to their appointed programme(s); access audited |

---

### 10. Academic Integrity Officer
Member of staff managing academic misconduct cases.

| Attribute | Detail |
|---|---|
| Can read | Student identity and module registrations for cases under investigation; submitted work; prior misconduct history |
| Can initiate | Open misconduct cases; record investigation outcomes; transmit confirmed outcomes to SIS |
| Workflow tasks | Manage investigation workflow; panel administration; outcome notification |
| Data access scope | Scoped to active cases; access audited |

---

### 11. Finance Administrator
Member of the Finance department responsible for student billing and bursaries.

| Attribute | Detail |
|---|---|
| Can read | Student enrolment status and fee liability records; bursary eligibility lists |
| Can initiate | Transmit payment confirmations and financial hold status to SIS |
| Workflow tasks | Approve bursary payments; process financial holds |
| Data access scope | Financial data only; no access to academic records |

---

### 12. Tenant Administrator
The institution-level system administrator responsible for configuring the SRS for their institution.

| Attribute | Detail |
|---|---|
| Can read | All tenant configuration; integration adapter status; user and role assignments; plugin registry |
| Can initiate | Configure integration adapters; manage business rules and assessment regulations; manage tenant-level user roles; enable/disable modules and integrations |
| Workflow tasks | Onboarding configuration; integration health management |
| Data access scope | Configuration and administrative data for their tenant only; no access to student records |

---

### 13. System Administrator
The platform-level administrator with cross-tenant operational access.

| Attribute | Detail |
|---|---|
| Can read | All tenant configurations; system health dashboards; audit logs (cross-tenant); deployment status |
| Can initiate | Tenant provisioning; platform-level configuration changes; user account management; database maintenance operations |
| Workflow tasks | Tenant onboarding; platform incident management |
| Data access scope | Platform-level administrative access; student data access strictly controlled and audit-logged |

---

### 14. Data Protection Officer (DPO)
Responsible for GDPR compliance; may be internal or external to the institution.

| Attribute | Detail |
|---|---|
| Can read | Audit logs; data subject register; retention schedule status; access records for special category data |
| Can initiate | Data subject access request workflows; erasure request workflows; data breach notifications |
| Workflow tasks | Review and approve erasure requests; review DSAR disclosures |
| Data access scope | Administrative and compliance data; student record access for DSAR fulfilment |

---

## System Actors (External Integrations) †

These actors are external systems that integrate with the SRS via the integration layer. They do not hold authoritative outcome data; the SIS is the system of record for all confirmed outcomes.

| Actor | ID | Role | Integration Pattern |
|---|---|---|---|
| UCAS | UCAS | UK undergraduate admissions service | File / API bidirectional |
| HESA | HESA | Statutory data collection body | File submission (annual) |
| Student Loans Company | SLC | Loan administration | File / API bidirectional |
| UK Visas and Immigration | UKVI | Sponsor licence compliance | API / file |
| Curriculum Management | CM | Programme and module catalogue | API / event bidirectional |
| Timetabling | TTB | Schedule generation | API / event bidirectional |
| CRM | CRM | Admissions and student engagement | API / event bidirectional |
| Finance | FIN | Billing and payments | API / event bidirectional |
| Library | LIB | Resource loans and access | API / event bidirectional |
| Enterprise Web Portal | EWP | Student and staff self-service | API / event bidirectional |
| Attendance Monitoring | AM | Attendance tracking | API / event bidirectional |
| Virtual Learning Environment | VLE | Online learning and assessment | API / event bidirectional |
| Accommodation | ACC | Housing allocation | API / event bidirectional |
| Estates | EST | Campus facilities | API (outbound) |
| Identity and Access Management | IAM | User provisioning and authentication | API / event bidirectional |
| EDRMS | EDRMS | Document and records management | API / event outbound |
| Online ID Verification | OIV | Identity verification | API bidirectional |
| Business Intelligence | BI | Analytics and at-risk flagging | API / event bidirectional |
| Data Warehouse | DW | Longitudinal data storage | File / event bidirectional |
| Student Evaluation of Teaching | SETS | Teaching feedback surveys | API bidirectional |
| HR | HR | Staff assignments | API / event bidirectional |
| Payroll | PAY | Bursary payments | API bidirectional |
| CRIS | CRIS | Research information | API / event bidirectional |
| Research Proposals | RP | Research funding | API bidirectional |
| Content Management | CMS | Web content | API / event |
| IT Service Management | ITSM | Support tickets | API bidirectional |
| Academic Integrity | AI | Misconduct case management | API / event bidirectional |
| Exam Scheduling | EXAMS | Examination logistics | API / event bidirectional |
| Wellbeing and Disability | WELL | Adjustments and EC management | First-party module (direct DB + events) |

---

## RBAC Role Hierarchy

The following application-level roles are defined. Roles are assigned to users within a tenant and govern data access and operation permissions. A user may hold multiple roles; their effective permissions are the union of all assigned roles.

| Role | Base Actor | Scope |
|---|---|---|
| `student` | Enrolled Student | Own records only |
| `module-tutor` | Module Tutor | Assigned modules |
| `personal-tutor` | Personal Tutor | Assigned student cohort |
| `research-supervisor` | Research Supervisor | Supervised students |
| `wellbeing-advisor` | Disability Advisor / Wellbeing Practitioner | Wellbeing cases; special category data |
| `exam-board-member` | Exam Board member | Board data pack; read-only |
| `exam-board-chair` | Exam Board Chair | Board ratification |
| `external-examiner` | External Examiner | Appointed programme; read-only |
| `integrity-officer` | Academic Integrity Officer | Active misconduct cases |
| `registry-administrator` | Registry Administrator | Tenant-scoped student records |
| `finance-administrator` | Finance Administrator | Financial data |
| `dpo` | Data Protection Officer | Compliance and audit data |
| `tenant-administrator` | Tenant Administrator | Tenant configuration |
| `system-administrator` | System Administrator | Platform-level |
| `integration-service` | System Actor (integration) | Scoped to integration contract |
