# Attendance and Engagement Increment A Approval Pack

> Status: Generic product baseline authorised; institutional configuration approval required before deployment
>
> Prepared: 2026-07-27
>
> Scope: BP-04-001, BP-04-002 and the referral boundary to BP-07-003

[Vertical-slice specification](attendance-engagement-vertical-slice.md) · [ADR review](../decisions/attendance-vertical-slice-adr-review.md) · [Contract vocabulary](../architecture/attendance-engagement-contract-vocabulary.md) · [Privacy and threat assessment](../architecture/attendance-engagement-privacy-threat-assessment.md)

## Decision requested

Generic product development is authorised to proceed with the recorded safe defaults. Deploying institutions approve, amend or reject the configurable policy, privacy, retention, integration and role decisions before processing their identifiable student data. This authorisation never permits automated adverse decisions.

The following remain non-negotiable:

- expected events, observations, alerts and human decisions are separate records;
- raw evidence or a threshold cannot directly change academic status or create a sponsor report;
- corrections append provenance rather than overwrite;
- missing, disputed or unreconciled evidence suspends escalation;
- restricted welfare, health, disability and safeguarding detail stays outside general engagement views; and
- national and institutional variation is configuration, not a fork of the core model.

## Review batches

| Review | Named role required | Scope | Required outcome |
|---|---|---|---|
| A-ARCH | Solution architect and product owner | ADR-016, ADR-019, aggregate boundary and migration sequencing | Accept, amend or supersede decisions |
| A-PROC | Attendance/engagement and student-records SMEs | BP-04-001/BP-04-002 boundaries, actors, outcomes and terminology | Confirm operational feasibility |
| A-UK | Scotland, Wales and Northern Ireland SMEs | Nation-specific terminology, funding ownership and Welsh-language operation | Confirm configuration points |
| A-PRIV | DPO/data-protection and records leads | Purposes, lawful bases, DPIA, minimisation, rights and retention | Approve privacy controls or require amendment |
| A-SEC | Security architect and safeguarding/wellbeing leads | Threats, restricted referral boundary and access model | Accept mitigations |
| A-SPON | Student sponsor compliance SME | ADR-022 and the engagement-to-compliance referral boundary | Confirm no automated report path |
| A-INT | Integration architect and attendance/VLE system owner | Source authority, idempotency, correction and reconciliation vocabulary | Approve contract vocabulary |

## Questions requiring recorded answers

| ID | Decision | Options or constraint | Owner | Status |
|---|---|---|---|---|
| ATT-A01 | Expected-event authority | SRS authoritative; or reconciled replica of a configured authoritative timetable/activity source | A-ARCH/A-PROC | Generic default: SRS normalised authority; institution configures source authority |
| ATT-A02 | Observation authority | SRS normalised record with immutable source assertion; identify any source that remains legally/operationally authoritative | A-PROC/A-INT | Generic default accepted |
| ATT-A03 | Core versus tenant-extensible values | Approve the core codes and extensibility flags in the vocabulary | A-PROC/A-UK | Generic value sets accepted in migration `0037` |
| ATT-A04 | Human authority | Identify case transitions requiring a named role, segregation of duties or second approval | A-PROC/A-SPON | Generic invariant: every adverse/status/sponsor decision is separate and human-authorised |
| ATT-A05 | Restricted referral visibility | Approve the minimum referral type/status visible to each role | A-PRIV/A-SEC | Generic minimum-reference boundary accepted; role mapping is institutional |
| ATT-A06 | Policy dimensions | Confirm nation, provider, mode, level, location, sponsor and collaborative-delivery applicability | A-PROC/A-UK/A-SPON | Generic configuration dimensions accepted |
| ATT-A07 | Lawful basis by purpose | Controller records its Article 6 basis and, where relevant, Article 9 condition for each purpose | A-PRIV | Delegated to deploying controller; mandatory before live data |
| ATT-A08 | Retention schedule | Approve separate periods for raw evidence, corrections, alerts, cases, contacts, referrals and audit | A-PRIV | Delegated to deploying controller; product keeps classes separate |
| ATT-A09 | DPIA | Complete controller DPIA before pilot processing of identifiable student data | A-PRIV/A-SEC | Delegated deployment gate; cannot be disabled |
| ATT-A10 | Student transparency and challenge | Approve notice content, access route and correction/challenge process | A-PRIV/A-PROC | Delegated deployment gate; correction capability is a product invariant |

## Proposed dispositions for ADRs

| ADR | Proposed disposition | Approval dependency |
|---|---|---|
| ADR-016 | Accepted for generic product implementation | Institutional authority configuration |
| ADR-017 | Accepted for generic product implementation | Controller purpose/access/retention approval |
| ADR-019 | Accepted with phased ledger extension | Institution-specific target contract review |
| ADR-022 | Accepted for generic product implementation | Licensed sponsor policy and human decision |
| ADR-018, ADR-020, ADR-021 | Retain as Proposed; outside this approval except shared constraints | Separate domain reviews |

## Evidence checklist

| Evidence | Prepared | Approved |
|---|---|---|
| Detailed vertical-slice specification | Yes | Generic baseline authorised |
| ADR review and proposed dispositions | Yes | Generic baseline authorised |
| Contract vocabulary and core value-set proposal | Yes | Implemented in migration `0037` |
| Privacy/DPIA screening and threat assessment | Yes | Controls accepted; controller DPIA remains |
| Data-subject-register amendment | Yes | Generic categories accepted; controller confirmation remains |
| Requirement and process traceability | Yes | Generic baseline authorised |
| Migration/API implementation | Migration `0037` implemented; API not started | Increment B in progress |

## Decision record

| Review ID | Named reviewer and authority | Sources/version checked | Outcome | Conditions/actions | Date |
|---|---|---|---|---|---|
| A-ARCH | TBC | Repository baseline `8294e2b` or later | Pending | — | — |
| A-PROC | TBC | BP-04-001/BP-04-002 v0.1 | Pending | — | — |
| A-UK | TBC | Four-nation sections and provider policy | Pending | — | — |
| A-PRIV | TBC | ICO guidance current at review | Pending | — | — |
| A-SEC | TBC | Threat assessment v0.1 | Pending | — | — |
| A-SPON | TBC | Current Student Sponsor Guidance | Pending | — | — |
| A-INT | TBC | Contract vocabulary v0.1 | Pending | — | — |

`Approved with actions` is permitted only where an action does not alter the domain boundary, lawful basis, data classification, authority, adverse-decision control or public contract. Any such material change returns the affected artefacts for amendment.

## Exit and deployment gates

Increment A is complete for generic product development: the architecture boundary, vocabulary, privacy controls and non-adverse-decision invariant are fixed for version 1.

Before an institution processes identifiable student data it must record A-PROC, A-UK, A-PRIV, A-SEC, A-SPON and A-INT outcomes, complete ATT-A01–ATT-A10 for its configuration and record its DPIA approval reference. `pnpm check:attendance-increment-a` verifies the generic baseline; institutional deployment assurance is intentionally external to the repository.
