# UK Higher Education Business Process Documentation Plan

> Status: Implemented — SME approval pending
> Created: 2026-07-26
> Scope: Business processes that create, change, validate, consume, or report student record data

---

## 1. Purpose

Create a navigable, evidence-based business process library for UK higher education. The library will describe how human and system actors collaborate around the student record and will provide a reviewed basis for:

- Revelation SRS integration boundaries and contracts;
- the logical and physical data model;
- workflow and rules-engine requirements;
- role and permission design;
- audit, retention, and regulatory controls; and
- later implementation and acceptance-test traceability.

Each process will have one page containing a plain-language overview, a numbered main flow, numbered alternative and exception flows, and a Mermaid sequence diagram. The documentation will describe the sector process independently of any one institution while identifying policy-controlled institutional variants.

---

## 2. Current Project Baseline

The codebase reports v1.0.0 as released and all eleven delivery phases as complete. It already contains several sources that the process library must reconcile rather than duplicate:

| Existing source | Relevance to the process library |
|---|---|
| [Domain Glossary](domain-glossary.md) | Authoritative project terminology |
| [Actor Catalogue](requirements/actor-catalogue.md) | Existing human roles, external system actors, and RBAC mappings |
| [Workflow Catalogue](requirements/workflow-catalogue.md) | Twelve long-running workflow state models, W001–W012 |
| [Functional Requirements](requirements/functional-requirements.md) | Testable SRS capabilities and REQ identifiers |
| [Enterprise Reference Model](reference/revelation-student-records-reference-model.md) | System landscape and F001–F070 integration-flow taxonomy |
| [Integration Contract Catalogue](architecture/integration-contract-catalogue.md) | Current integration ownership, direction, payload, and failure semantics |
| [Data Model](architecture/data-model.md) | Current entities, relationships, temporal history, and ownership |
| [Domain Events](architecture/domain-events.md) | Published event names and meanings |
| [Workflow Traceability Matrix](architecture/workflow-traceability-matrix.md) | Existing workflow-to-entity, event, contract, and audit mappings |
| [Demo Scenarios](demo-scenarios/README.md) | Implemented user journeys and observable product behaviour |

The new library fills a different need. The current workflow catalogue focuses on workflow-engine states and transitions; integration documents focus on technical contracts; demo scenarios focus on product walkthroughs. None provides a consistent end-to-end business narrative across institutional teams, the SRS, and external systems.

Before process drafting begins, the baseline must be reconciled. In particular:

- the repository says the project is complete, but the workflow catalogue still says `Draft — Phase 1`;
- some actor labels differ between prose, workflow transition tables, RBAC roles, and demo personas;
- W001 combines admissions and enrolment, although these are likely to need separate detailed process pages;
- W007 combines withdrawal and intermission, which share events but have different decisions and downstream consequences; and
- the twelve workflow-engine workflows are not necessarily the complete set of business processes that affect student records.

---

## 3. Documentation Architecture

Create the following structure:

```text
docs/business-processes/
├── README.md
├── process-map.md
├── terminology-and-conventions.md
├── source-register.md
├── traceability-matrix.md
├── 01-recruitment-and-admissions/
│   ├── README.md
│   └── bp-01-001-*.md
├── 02-registration-and-student-status/
│   ├── README.md
│   └── bp-*.md
├── 03-curriculum-and-module-registration/
├── 04-learning-engagement-and-support/
├── 05-assessment-and-results/
├── 06-progression-awards-and-graduation/
├── 07-regulatory-and-statutory-reporting/
└── 08-record-governance-and-lifecycle/
```

Navigation will operate at four levels:

1. The [project README](../README.md) links to the business process library.
2. The library `README.md` presents lifecycle, actor, system, and regulatory indexes.
3. Each domain `README.md` presents its process pages in lifecycle order.
4. Every process page provides previous, parent, next, related-process, source, and traceability links.

The process map will distinguish:

- **business process** — an end-to-end outcome involving one or more actors;
- **workflow** — durable orchestration of part or all of a process;
- **integration flow** — exchange across a system boundary; and
- **product journey** — actions exposed by the implemented Revelation user interface.

These concepts must not share identifiers. New business processes use `BP-dd-nnn` (domain-scoped, see the process library README); existing workflows retain `Wnnn`; reference-model integration flows retain `Fnnn`; functional requirements retain `REQ-nnn`.

---

## 4. Process Page Standard

Each `BP-dd-nnn` page will use this required structure:

1. **Title and metadata**
   - process ID, lifecycle domain, status, owner, version, last reviewed date;
   - jurisdiction/applicability;
   - mapped `W`, `F`, and `REQ` identifiers;
   - source currency or review-by date.
2. **Purpose and outcome**
   - short overview in business language.
3. **Scope**
   - start event, end state, in-scope and out-of-scope cases.
4. **Actors and responsibilities**
   - human actors, system actors, accountable owner, and system of record.
5. **Preconditions**
   - required data, permissions, prior process outcomes, and time windows.
6. **Trigger**
   - business event or schedule that starts the process.
7. **Main flow**
   - numbered steps using the convention `1`, `2`, `3`;
   - each step names the initiating actor, action, receiving actor/system, and material record effect.
8. **Alternative and exception flows**
   - identifiers tied to the branch point, for example `A3.1`, `A3.2`, `E5.1`;
   - rejoin point or terminal outcome stated explicitly.
9. **Postconditions**
   - record state, notifications, obligations, and downstream eligibility.
10. **Business rules and controls**
    - decision rules, deadlines, evidence, approvals, audit, privacy, and retention.
11. **Data impact**
    - data created/read/updated; authoritative source; temporal and provenance needs.
12. **Integration impact**
    - sending and receiving systems, interaction type, trigger, acknowledgement, retry, and reconciliation.
13. **Sequence diagram**
    - Mermaid `sequenceDiagram` using exactly the same actor and system names as the prose;
    - `alt`, `else`, `opt`, and `loop` blocks used where they clarify the documented alternatives;
    - no undocumented interaction added merely to make the diagram appear complete.
14. **Open questions and institutional variants**
    - unresolved evidence conflicts and configuration points, not hidden assumptions.
15. **Sources**
    - source title, publisher, URL, version/publication date, access date, and the sections supporting the page.
16. **Traceability and related processes**
    - links to adjacent processes and current project artefacts.
17. **Change history**
    - material changes, reviewer, and rationale.

A reusable authoring template will be committed before the first process page. A short worked example will be approved as the quality baseline.

---

## 5. Naming and Language Convention

The first deliverable is a controlled term register produced by reconciling the glossary, actor catalogue, reference model, API resources, and implementation.

Rules:

- Use UK higher education language and UK spelling.
- Use **Revelation SRS** for the product and **SRS** for its system boundary. Do not alternate between SRS, SIS, student system, and student information system without a documented distinction.
- Use the exact canonical actor names from the actor catalogue after reconciliation. Role names are singular title case in prose, for example **Registry Administrator**.
- Treat an organisational team and an application role as different concepts where necessary.
- Use the exact external-system names from the reference model and actor catalogue.
- Use glossary terms for domain concepts; add a proposed glossary entry rather than inventing a synonym locally.
- Use active-voice step text in the form “Actor performs action”.
- Use canonical business names in prose and diagrams; technical event names and status values remain in backticks.
- Give each process one verb-led or outcome-led title and one stable `BP-dd-nnn` identifier. Filenames are lower-case kebab-case: `bp-01-001-receive-ucas-application.md`.
- Never reuse or renumber a published identifier. Retired pages remain as redirects or tombstones.

The terminology document will include a “do not use / use instead” table for resolved synonyms and a Mermaid participant-alias convention for long names.

---

## 6. Research and Evidence Method

Detailed process descriptions must be derived from evidence, not inferred solely from the current implementation.

### 6.1 Source hierarchy

Use sources in this order:

1. legislation, statutory instruments, and official government guidance;
2. regulator, designated data body, and statutory-agency specifications;
3. sector-body standards and codes;
4. published policies and process descriptions from multiple UK higher education providers;
5. Revelation requirements, architecture, implementation, and tests;
6. SME evidence and institutional practice.

Official sources will include, where relevant, current material from UCAS, Jisc/HESA, the Office for Students and devolved regulators, the Student Loans Company, UK Visas and Immigration, the Office of the Independent Adjudicator, the Quality Assurance Agency, the Information Commissioner's Office, and qualification/framework bodies.

### 6.2 Research protocol

For each candidate process:

1. Define the research question, boundary, jurisdiction, and likely record impact.
2. Locate current authoritative sources and record their dates and versions.
3. Triangulate institutional practice using at least two provider sources where the process is institution-defined.
4. Extract actors, triggers, deadlines, decisions, evidence, outcomes, system exchanges, and record effects into a research worksheet.
5. Separate mandated behaviour from common practice and configurable institutional policy.
6. Compare the evidence with current Revelation workflows, contracts, entities, events, and UI journeys.
7. Record contradictions as explicit issues; do not silently prefer implementation over authoritative evidence.
8. Draft the process and attach source references to the claims they support.
9. Have a second author or reviewer reproduce the main flow from the cited evidence.
10. Set a review-by date for volatile regulatory material.

The source register will capture publisher, title, URL, jurisdiction, version/effective date, access date, process IDs supported, authority level, and review-by date. For example, current UKVI Student Sponsor Guidance is actively versioned and therefore requires currency metadata rather than a bare link.

### 6.3 Evidence labels

Each material rule or variation will be classified as:

- `MANDATED` — required by legislation, regulation, or binding agency specification;
- `SECTOR` — standard or widespread cross-sector practice;
- `INSTITUTIONAL` — provider policy/configuration;
- `REVELATION` — current product behaviour or design;
- `PROPOSED` — recommended future behaviour awaiting agreement.

This prevents a common institutional practice from being presented as a UK-wide rule.

---

## 7. Inventory and Prioritisation

Do not treat W001–W012 as the final inventory. Build the inventory through four passes:

1. Decompose each existing workflow into coherent end-to-end business processes.
2. Walk the student lifecycle and identify processes that directly mutate or govern student records.
3. Walk all 69 reference-model interactions and identify the business processes that cause them.
4. Walk key data entities and identify creation, change, correction, closure, reporting, and retention processes.

Candidate scope includes:

| Domain | Candidate processes to assess |
|---|---|
| Recruitment and admissions | Receive application; assess application; make and manage offer; confirm conditions; Confirmation of Acceptance for Studies; Clearing; applicant-to-student conversion |
| Registration and status | Pre-registration; identity and right-to-study checks; initial registration; annual re-registration; transfer; suspension/intermission; withdrawal; return from interruption; leaver closure |
| Curriculum and modules | Publish programme/module data to the SRS; select modules; approve exceptions; change module registration; manage programme or route transfer |
| Engagement and support | Record engagement; investigate non-engagement; manage reasonable adjustments; manage exceptional circumstances; apply support outcomes |
| Assessment and results | Create assessment structures; enter candidates; receive marks; moderate and confirm marks; investigate academic misconduct; prepare exam board; ratify and publish results; correct ratified outcomes |
| Progression and awards | Determine progression; reassessment/referral; confer award; issue award documentation and HEAR; graduation eligibility |
| Regulatory reporting | HESA student data; SLC attendance/enrolment and change reporting; UKVI sponsorship duties; OfS/devolved-regulator returns; data quality correction and resubmission |
| Record governance | Duplicate resolution; identity correction; data-subject request; retention and disposal; audit review; post-ratification correction |

The inventory workshop will assign each candidate:

- SRS impact: create, update, read, report, govern, or no material impact;
- regulatory/data risk;
- integration complexity;
- data-model significance;
- institutional variation;
- current implementation coverage; and
- SME availability.

### Proposed drafting waves

1. **Pilot** — one high-value cross-system process, provisionally annual re-registration or student withdrawal/intermission.
2. **Core student lifecycle** — application handoff, registration, module registration, status changes.
3. **Assessment and progression** — marks through boards, progression, awards, corrections.
4. **Regulatory and support** — HESA, SLC, UKVI, adjustments, exceptional circumstances, misconduct.
5. **Governance and completeness** — record correction, retention, remaining flows, and lifecycle gap closure.

The final process list and identifiers are baselined only after the inventory and decomposition workshop.

---

## 8. Delivery Plan

### Phase 0 — Mobilise and baseline

Deliver:

- agreed scope and definition of “business process”;
- current-document status review;
- named document owner, editorial owner, and SME groups;
- decision log and issue register;
- confirmation of supported jurisdictions (UK-wide or nation-specific variants).

Exit: stakeholders agree boundaries and governance.

### Phase 1 — Reconcile terminology and build the inventory

Deliver:

- canonical actor/system/term register;
- crosswalk for conflicting existing names;
- candidate process inventory and domain decomposition;
- mappings from candidates to `W`, `F`, `REQ`, data entities, and demo journeys;
- risk-based drafting order.

Exit: no unowned high-impact integration flow or key student-record lifecycle event.

### Phase 2 — Establish the documentation system

Deliver:

- folder structure and navigation indexes;
- process-page template;
- authoring, Mermaid, citation, and link conventions;
- source register and traceability-matrix schemas;
- automated checks for duplicate IDs, broken relative links, required headings, and Mermaid syntax.

Exit: template and controls accepted using a skeletal sample page.

### Phase 3 — Research and write the pilot

Deliver:

- completed research worksheet and evidence pack;
- one fully drafted process with alternatives and sequence diagram;
- data and integration impact assessment;
- content, architecture, and SME review findings;
- refined template and definition of done.

Exit: pilot approved as the exemplar for subsequent pages.

### Phase 4 — Draft in waves

For each wave:

1. Research pages independently against the source hierarchy.
2. Conduct actor/system boundary and terminology review.
3. Draft overview, flow, alternatives, controls, data impact, and integrations.
4. Derive the diagram from the written flow and cross-check both directions.
5. Update navigation and traceability at the same time as each page.
6. Run automated documentation checks.
7. Submit a domain-sized SME review pack rather than isolated pages.
8. Resolve comments or record an explicit decision/open issue.

Exit: every in-scope process meets the definition of done.

### Phase 5 — Cross-process assurance

Deliver:

- end-to-end lifecycle walkthrough;
- actor responsibility and hand-off review;
- integration-flow coverage review;
- entity lifecycle and system-of-record review;
- regulatory currency check;
- duplicate/gap/inconsistent-outcome report;
- proposed changes to glossary, workflows, integrations, events, data model, or implementation.

Exit: every material hand-off has a preceding and succeeding process, and all findings are dispositioned.

### Phase 6 — Baseline and maintain

Deliver:

- approved versioned process-library baseline;
- README and architecture-index links;
- ownership and review calendar;
- source-change monitoring responsibilities;
- change-control rules tying process changes to architecture and implementation impact assessment.

Exit: SME and architecture owners approve the baseline for use in Revelation design.

---

## 9. Review Model

Each page requires these review perspectives:

| Review | Primary question |
|---|---|
| Business SME | Does this reflect legitimate sector and institutional practice? |
| Regulatory/data owner | Are duties, deadlines, evidence, and return semantics current? |
| Integration architect | Are system boundaries, ownership, failure paths, and reconciliation accurate? |
| Data architect | Are record effects, provenance, history, and authoritative sources complete? |
| Product/workflow owner | Does the page reconcile with current and intended Revelation behaviour? |
| Editorial reviewer | Are terminology, numbering, links, diagram, and accessibility consistent? |

Allowed page statuses:

`Proposed` → `Researched` → `Draft` → `SME review` → `Approved` → `Superseded`

Approval records the reviewer, role, date, scope of approval, source versions, and unresolved institutional variants. SME approval validates business accuracy; it does not by itself approve implementation changes.

---

## 10. Definition of Done

A process page is complete only when:

- its boundary and intended outcome are unambiguous;
- its main flow is sequentially numbered;
- alternatives and exceptions identify their branch and rejoin/termination points;
- every named actor and system uses the canonical vocabulary;
- every interaction in the Mermaid diagram is supported by the prose, and every material cross-system prose step is diagrammed;
- business rules distinguish mandated, sector, institutional, Revelation, and proposed behaviour;
- material assertions have current, traceable sources;
- SRS data reads/writes, authority, provenance, audit, and temporal needs are stated;
- integration triggers, acknowledgements, failures, retries, and reconciliation are addressed where relevant;
- existing `W`, `F`, `REQ`, entity, event, and related-process mappings are recorded;
- navigation links work and all automated checks pass;
- review comments are resolved or explicitly accepted as open issues; and
- the required SME, regulatory, integration, data, product, and editorial reviews are recorded.

---

## 11. Risks and Controls

| Risk | Control |
|---|---|
| Current implementation is mistaken for sector policy | Evidence labels and source hierarchy |
| England-only rules are stated as UK-wide | Applicability metadata and nation-specific variants |
| Regulatory guidance changes after approval | Effective dates, review-by dates, and source ownership |
| One page becomes too large to review | One outcome-oriented process per page; linked subprocesses |
| Diagram and prose diverge | Stable step references and bidirectional review |
| Actor/system naming drifts | Controlled terminology register and automated linting |
| Alternatives are hidden in narrative | Required `A` and `E` flow identifiers |
| Library duplicates existing catalogues | Explicit `BP`/`W`/`F`/`REQ` distinctions and cross-links |
| SME review becomes an unstructured rewrite | Defined review questions, decision log, and page statuses |
| Research captures one provider's local practice | Authoritative sources plus multi-provider triangulation |
| Findings do not influence architecture | Mandatory integration/data impact sections and traceability matrix |

---

## 12. Initial Success Measures

- 100% of approved pages meet the page template and definition of done.
- 100% of material cross-system steps map to an integration contract or an explicitly recorded gap.
- 100% of student-record mutations identify the authoritative system and affected data concept.
- 100% of regulatory rules identify jurisdiction, source version/effective date, and review date.
- 100% of pages have no broken internal links or invalid Mermaid blocks.
- All existing W001–W012 workflows and F001–F070 reference-model flows are mapped to at least one process or have a documented exclusion rationale.
- Every high-risk process has named SME, integration, and data reviewers.
- Cross-process assurance produces no unexplained actor, system, terminology, or lifecycle discontinuity.

---

## 13. Immediate Next Actions

1. Agree whether the library is UK-wide with nation-specific variants or initially England-focused.
2. Nominate the documentation owner and initial SME groups.
3. Run the terminology reconciliation and process-inventory workshop.
4. Baseline the `BP-dd-nnn` inventory before assigning permanent IDs.
5. Commit the folder structure, template, source register, and traceability matrix.
6. Select and complete the pilot process.
7. Review the pilot and adjust the standard before drafting the remaining waves.
