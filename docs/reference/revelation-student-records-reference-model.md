# The Revelation Student Records Enterprise Reference Model

> Source: https://revelationcore.com/blogs/the-revelation-student-records-reference-model.html
> License: CC BY-NC 4.0 — free for non-commercial use with attribution; commercial use prohibited.
> © RevelationCore 2026
> Model version: 3.0 (2026-07-28)

## Overview

This comprehensive reference architecture document describes an updated student records system model for UK higher education institutions. The model covers **33 systems and actors** and **69 published interactions**.

Version 3.0 carries forward the same 33 systems and 69 flows as version 2.1 unchanged, and makes one structural change: flow identifiers move from a flat, gap-prone `F001`–`F070` sequence (version 2.1 has no `F054`) to a domain-pair-scoped scheme, `F-<FROM>-<TO>-<nn>` — for example `F-SIS-HESA-01`. A flow's identifier now names the systems it connects, and a new flow between an existing pair simply gets the next local sequence number rather than forcing every later flow to renumber. See [Flow identifier scheme](#flow-identifier-scheme) below.

This repository is itself the reference implementation this model has since informed — see [Reference implementation alignment](#reference-implementation-alignment) below for how each system in this model maps to the current Revelation SRS build.

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

## Flow identifier scheme

Flows use `F-<FROM>-<TO>-<nn>`, where `FROM` and `TO` are the system codes from the [Systems Portfolio](#systems-portfolio) below and `nn` is a two-digit sequence local to that ordered pair (most pairs have one flow; a few, such as SIS→AM and SIS→VLE, have two). For example `F-CM-SIS-01` is the first (and only) flow from Curriculum Management to Student Records; `F-SIS-AM-02` is the second flow from Student Records to Attendance Monitoring.

This replaces version 2.1's flat `F001`–`F070` numbering, which had two problems: it carried no information (nothing about `F047` indicated it concerned HESA) and it had a gap with no defined meaning (`F054` was never assigned). Under the new scheme every identifier is self-describing, and adding a flow — to an existing pair or a new one — never requires renumbering an unrelated flow.

## Model Structure

The reference model organises **69 published interactions** across five categories:

| Category | Count | Description |
|---|---|---|
| Core SIS Integrations | 26 | Foundational integrations with teaching, learning, operational, and administrative systems |
| Analytics, Administration & Research | 18 | Business intelligence, HR, payroll, and research systems |
| UK Statutory & Regulatory Flows | 8 | UCAS, HESA, Student Loans Company, and UKVI |
| Wellbeing, Adjustments & Student Context | 7 | Disability support and reasonable adjustments |
| Examinations, Governance, Assurance & Academic Integrity | 10 | Examination operations, academic governance, and misconduct management |

> **Note — Non-SIS-facing flows:** `F-VLE-BI-01`, `F-AM-BI-01`, `F-DW-BI-01`, and `F-CRM-EWP-01` do not involve the SIS directly. They describe enterprise ecosystem flows between other systems. Revelation SRS treats these as **reference context** rather than SRS-owned requirements unless the SRS explicitly brokers them through its integration layer.

> **Note — ESB:** The Enterprise Service Bus (ESB) is included as a system actor in the reference model but has no flows assigned to it. In Revelation SRS, the ESB role is fulfilled by the internal integration layer. ESB should be treated as an optional institutional integration pattern — present where an institution routes integrations through an enterprise bus — not as a required Revelation SRS adapter.

---

## Systems Portfolio

The model describes 33 systems and actors across domains. **SRS status** reflects the current Revelation SRS build (see [Reference implementation alignment](#reference-implementation-alignment)); it is a snapshot, not a permanent commitment.

### Student Lifecycle & Experience
- **SIS** — Student Records (core system of record) — *Implemented (this repository's core)*
- **CRM** — Customer Relationship Management — *Not implemented; not tracked*
- **AM** — Attendance Monitoring — *Implemented as `modules/attendance`, a native pluggable module (outcome-ownership pattern, not a raw-feed adapter)*
- **WELL** — Student Wellbeing & Disability — *Implemented as `modules/wellbeing`*
- **OIV** — Online ID Verification — *Not implemented; not tracked*
- **UCAS** — Universities and Colleges Admissions Service (actor) — *Implemented, regulatory route in core*

### Teaching & Learning
- **CM** — Curriculum Management — *Implemented, natively in SIS core rather than as a separate synced system*
- **TTB** — Timetabling — *Planned — named in the domain-events backlog*
- **VLE** — Virtual Learning Environment — *Implemented as `adapters/vle`*
- **LIB** — Library — *Not implemented; not tracked*
- **AI** — Academic Integrity — *Implemented, natively in SIS core rather than as a separate synced system*
- **EXAMS** — Exam Scheduling — *Implemented, natively in SIS core rather than as a separate synced system*
- **SETS** — Student Evaluation of Teaching Software — *Not implemented; not tracked*
- **EXAMBOARD** — Exam Board (actor) — *Implemented, governance workflow in core*
- **EXTEX** — External Examiner (actor) — *Implemented, governance workflow in core*

### Enterprise Administration
- **FIN** — Finance — *Planned — named in the domain-events backlog*
- **HR** — Human Resources — *Planned — named in the domain-events backlog*
- **PAY** — Payroll — *Not implemented; not tracked*
- **EDRMS** — Electronic Document & Records Management — *Planned — named in the domain-events backlog*

### Campus & Facilities
- **ACC** — Accommodation & Conferences — *Not implemented; not tracked*
- **EST** — Estates — *Not implemented; not tracked*

### Institutional Analytics & Reporting
- **BI** — Business Intelligence — *Planned — named in the domain-events backlog*
- **DW** — Data Warehouse — *Planned — named in the domain-events backlog*

### Compliance & Regulatory Reporting
- **HESA** — Higher Education Statistics Agency (actor) — *Implemented, regulatory route in core*
- **SLC** — Student Loans Company (actor) — *Implemented, regulatory route in core*
- **UKVI** — UK Visas & Immigration (actor) — *Implemented, regulatory route in core*

### IT & Digital Infrastructure
- **IAM** — Identity & Access Management — *Implemented (outbound) via `packages/auth`/Keycloak; inbound account events are backlog*
- **EWP** — Enterprise Web Portal — *Implemented as `apps/portal`*
- **ITSM** — IT Service Management — *Not implemented; not tracked*
- **CMS** — Content Management Systems — *Not implemented; not tracked*
- **ESB** — Enterprise Service Bus — *Not applicable — optional institutional pattern, fulfilled internally*

### Research & Innovation
- **CRIS** — Current Research Information System — *Planned — named in the domain-events backlog*
- **RP** — Research Proposals — *Not implemented; not tracked*

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

## Reference implementation alignment

This model has since informed Revelation SRS — this repository. Revelation SRS is a separate project under a separate licence from this model (AGPL v3 for the code, CC BY-NC 4.0 for the model itself): it is a working implementation the model's authors have used to test the model against real build decisions, not a certification that the model is complete or that any given institution's landscape matches it.

Two deviations are architectural choices worth calling out rather than gaps to be closed:

- **Curriculum, exam scheduling, and academic misconduct are consolidated natively in the SIS core** rather than modelled as separate systems synced via a flow. Revelation SRS builds programme/module authoring, exam-entry logistics, and misconduct casework directly into `apps/api`. The corresponding flows (`F-CM-SIS-01`/`F-SIS-CM-01`, `F-SIS-EXAMS-01`/`F-EXAMS-SIS-01`, `F-AI-SIS-01`/`F-SIS-AI-01`) describe a valid pattern for institutions running separate products for these capabilities, but not how Revelation SRS itself is built.
- **Attendance is a native pluggable module, not an external feed** — matching the outcome-ownership pattern this model uses for Wellbeing. `modules/attendance` owns its own casework and hands the SIS only the confirmed engagement outcome, exactly as `modules/wellbeing` hands the SIS an approved-adjustment outcome. The raw-attendance-feed flow this model assumes (`F-AM-SIS-01`, a third-party Attendance Monitoring product pushing raw records into the SIS) is not implemented and not currently planned.

Beyond these two deviations, every system in this model is in one of three states in the current build: implemented substantially as modelled, named in the [domain-events backlog](../architecture/domain-events.md#backlog--not-yet-implemented) as planned but not yet built (Finance, Timetabling, EDRMS, Business Intelligence, Data Warehouse, HR, CRIS, and IAM's inbound events), or not implemented and not tracked anywhere (CRM, Library, Accommodation & Conferencing, Estates, Online ID Verification, Student Evaluation of Teaching, Payroll, Research Proposals, Content Management, IT Service Management). See the **SRS status** annotation against each system in the [Systems Portfolio](#systems-portfolio) above.

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
`https://www.revelationcore.com/app/index.html?model=/app/reference/models/revelation-student-records-enterprise-reference-model-3.0.json`

The raw JSON model is stored locally at: `revelation-student-records-enterprise-reference-model-3.0.json`
