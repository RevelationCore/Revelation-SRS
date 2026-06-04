# The Revelation Student Records Enterprise Reference Model

> Source: https://revelationcore.com/blogs/the-revelation-student-records-reference-model.html
> License: CC BY-NC 4.0 — free for non-commercial use with attribution; commercial use prohibited.
> © RevelationCore 2026

## Overview

This comprehensive reference architecture document describes an updated student records system model for UK higher education institutions. The model expands from the original 24 systems and 26 flows to **33 systems and actors** and **69 flows**, encompassing operational systems, statutory bodies, student support, examination operations, and academic governance.

---

## Key Architectural Principles

The model establishes several governing principles:

1. **Student Records as System of Record**: The SIS holds "the authoritative data about who is enrolled, what they are studying, how they are progressing, and what outcomes have been confirmed."

2. **Process vs. Outcome Ownership**: Domain systems manage their processes while passing confirmed outcomes to Student Records, preventing data fragmentation.

3. **SIS as Distribution Hub**: Because Student Records holds the authoritative record, it distributes confirmed outcomes to downstream systems.

4. **Governance Actors Are Not Systems**: The Exam Board and External Examiner apply judgement but don't own records themselves.

5. **UK Regulatory Compliance**: Statutory obligations including HESA returns, Student Loans Company confirmations, and UKVI compliance are treated as "first-class flows" rather than optional additions.

6. **Local Variation**: The model represents generalised UK architecture; institutions should adapt it to their specific systems and governance practices.

---

## Model Structure

The reference model organises 70 logical flows across six categories:

| Category | Flow IDs | Count | Description |
|---|---|---|---|
| Core SIS Integrations | F001–F026 | 26 | Foundational integrations with teaching, learning, operational, and administrative systems |
| Analytics, Administration & Research | F027–F044 | 18 | Business intelligence, HR, payroll, and research systems |
| UK Statutory & Regulatory Flows | F045–F052 | 8 | UCAS, HESA, Student Loans Company, and UKVI |
| Wellbeing, Adjustments & Student Context | F053, F055–F060 | 7 | Disability support and reasonable adjustments |
| Examinations, Governance, Assurance & Academic Integrity | F061–F070 | 10 | Examination operations, academic governance, and misconduct management |

---

## Systems Portfolio

The model describes 33 systems and actors across domains:

### Student Lifecycle & Experience
- **SIS** — Student Records (core system of record)
- **CRM** — Customer Relationship Management
- **AM** — Attendance Monitoring
- **WELL** — Student Wellbeing & Disability
- **OIV** — Online ID Verification
- **UCAS** — Universities and Colleges Admissions Service (actor)

### Teaching & Learning
- **CM** — Curriculum Management
- **TTB** — Timetabling
- **VLE** — Virtual Learning Environment
- **LIB** — Library
- **AI** — Academic Integrity
- **EXAMS** — Exam Scheduling
- **SETS** — Student Evaluation of Teaching Software
- **EXAMBOARD** — Exam Board (actor)
- **EXTEX** — External Examiner (actor)

### Enterprise Administration
- **FIN** — Finance
- **HR** — Human Resources
- **PAY** — Payroll
- **EDRMS** — Electronic Document & Records Management
- **ACC** — Accommodation & Conferences
- **EST** — Estates

### Institutional Analytics & Reporting
- **BI** — Business Intelligence
- **DW** — Data Warehouse

### Compliance & Regulatory Reporting
- **HESA** — Higher Education Statistics Agency (actor)
- **SLC** — Student Loans Company (actor)
- **UKVI** — UK Visas & Immigration (actor)

### IT & Digital Infrastructure
- **IAM** — Identity & Access Management
- **EWP** — Enterprise Web Portal
- **ITSM** — IT Service Management
- **CMS** — Content Management Systems
- **ESB** — Enterprise Service Bus

### Research & Innovation
- **CRIS** — Current Research Information System
- **RP** — Research Proposals

### Campus & Facilities
- **ACC** — Accommodation & Conferences
- **EST** — Estates

---

## Key Design Patterns

The model emphasises several recurring patterns:

- **Source system ownership with SIS consolidation**: Domain systems own their processes; Student Records holds the lasting institutional outcome.
- **Logical rather than technical flows**: The model specifies *what* data flows between systems without prescribing API, batch, or manual implementation.
- **Single record of truth**: Multiple flows prevent divergent states across systems by routing all critical data through the authoritative SIS.
- **Audit trail preservation**: Record locking after board ratification prevents retroactive modification without formal appeals processes.
- **Adjustment distribution via SIS**: No downstream system should receive adjustment data directly from the Wellbeing system; SIS is the sole distribution point.

---

## Critical Flow Categories

### Governance Flows
Distinguish between systems that process data and actors that make formal academic decisions. The Exam Board receives complete board data including marks, classification recommendations, exceptional circumstances outcomes, and misconduct indicators — all sourced from Student Records before ratification.

### Statutory Flows
Reflect UK-specific legal requirements:
- **UCAS** — admissions exchange
- **HESA** — annual statutory statistical returns
- **SLC** — enrolment confirmations for loan release
- **UKVI** — attendance compliance reporting under sponsor licence obligations

### Adjustment Distribution
Ensures reasonable adjustments flow through Student Records to all consuming systems. The VLE must not receive adjustment data directly from Wellbeing; SIS is the sole distribution point.

---

## Application Methodology

The document provides a progression for implementing the model locally:

1. **Domain and System Identification**: Map the reference model against institutional systems
2. **Business Analysis**: Use flow descriptions as starting points for requirements gathering
3. **Functional Flows**: Translate logical flows into institution-specific implementations
4. **Detailed Modeling**: Develop as-is and to-be models for significant changes
5. **Transition Roadmap**: Group integrations into sequenced work packages

---

## Interactive Access

The complete interactive model with detailed flow descriptions and system relationships is available at:
`https://www.revelationcore.com/app/index.html?model=/app/reference/models/revelation-student-records-enterprise-reference-model-2.1.json`

The raw JSON model is stored locally at: `revelation-student-records-enterprise-reference-model-2.1.json`
