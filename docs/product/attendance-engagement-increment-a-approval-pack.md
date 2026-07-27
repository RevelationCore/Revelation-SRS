# Attendance and Engagement Increment A Approval Pack

> Status: Ready for named reviewers
>
> Prepared: 2026-07-27
>
> Scope: BP-027, BP-028 and the referral boundary to BP-052

[Vertical-slice specification](attendance-engagement-vertical-slice.md) · [ADR review](../decisions/attendance-vertical-slice-adr-review.md) · [Contract vocabulary](../architecture/attendance-engagement-contract-vocabulary.md) · [Privacy and threat assessment](../architecture/attendance-engagement-privacy-threat-assessment.md)

## Decision requested

Reviewers are asked to approve, approve with non-material actions, return for amendment or reject the Increment A baseline. Approval authorises detailed physical design for migration `0037` and version 1 API/event contracts; it does not approve production deployment or automated adverse decisions.

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
| A-PROC | Attendance/engagement and student-records SMEs | BP-027/BP-028 boundaries, actors, outcomes and terminology | Confirm operational feasibility |
| A-UK | Scotland, Wales and Northern Ireland SMEs | Nation-specific terminology, funding ownership and Welsh-language operation | Confirm configuration points |
| A-PRIV | DPO/data-protection and records leads | Purposes, lawful bases, DPIA, minimisation, rights and retention | Approve privacy controls or require amendment |
| A-SEC | Security architect and safeguarding/wellbeing leads | Threats, restricted referral boundary and access model | Accept mitigations |
| A-SPON | Student sponsor compliance SME | ADR-022 and the engagement-to-compliance referral boundary | Confirm no automated report path |
| A-INT | Integration architect and attendance/VLE system owner | Source authority, idempotency, correction and reconciliation vocabulary | Approve contract vocabulary |

## Questions requiring recorded answers

| ID | Decision | Options or constraint | Owner | Status |
|---|---|---|---|---|
| ATT-A01 | Expected-event authority | SRS authoritative; or reconciled replica of a configured authoritative timetable/activity source | A-ARCH/A-PROC | Pending |
| ATT-A02 | Observation authority | SRS normalised record with immutable source assertion; identify any source that remains legally/operationally authoritative | A-PROC/A-INT | Pending |
| ATT-A03 | Core versus tenant-extensible values | Approve the core codes and extensibility flags in the vocabulary | A-PROC/A-UK | Pending |
| ATT-A04 | Human authority | Identify case transitions requiring a named role, segregation of duties or second approval | A-PROC/A-SPON | Pending |
| ATT-A05 | Restricted referral visibility | Approve the minimum referral type/status visible to each role | A-PRIV/A-SEC | Pending |
| ATT-A06 | Policy dimensions | Confirm nation, provider, mode, level, location, sponsor and collaborative-delivery applicability | A-PROC/A-UK/A-SPON | Pending |
| ATT-A07 | Lawful basis by purpose | Controller records its Article 6 basis and, where relevant, Article 9 condition for each purpose | A-PRIV | Pending |
| ATT-A08 | Retention schedule | Approve separate periods for raw evidence, corrections, alerts, cases, contacts, referrals and audit | A-PRIV | Pending |
| ATT-A09 | DPIA | Complete controller DPIA before pilot processing of identifiable student data | A-PRIV/A-SEC | Pending |
| ATT-A10 | Student transparency and challenge | Approve notice content, access route and correction/challenge process | A-PRIV/A-PROC | Pending |

## Proposed dispositions for ADRs

| ADR | Proposed disposition | Approval dependency |
|---|---|---|
| ADR-016 | Accept | ATT-A01, ATT-A02 and ATT-A04 |
| ADR-017 | Accept for the referral boundary | ATT-A05 and ATT-A07 |
| ADR-019 | Accept with phased ledger extension | ATT-A02 and integration contract review |
| ADR-022 | Accept | ATT-A04, ATT-A05 and sponsor SME confirmation |
| ADR-018, ADR-020, ADR-021 | Retain as Proposed; outside this approval except shared constraints | Separate domain reviews |

## Evidence checklist

| Evidence | Prepared | Approved |
|---|---|---|
| Detailed vertical-slice specification | Yes | Pending |
| ADR review and proposed dispositions | Yes | Pending |
| Contract vocabulary and core value-set proposal | Yes | Pending |
| Privacy/DPIA screening and threat assessment | Yes | Pending |
| Data-subject-register amendment | Yes | Pending controller confirmation |
| Requirement and process traceability | Yes | Pending |
| Migration/API implementation | Not started; gated | Not applicable |

## Decision record

| Review ID | Named reviewer and authority | Sources/version checked | Outcome | Conditions/actions | Date |
|---|---|---|---|---|---|
| A-ARCH | TBC | Repository baseline `8294e2b` or later | Pending | — | — |
| A-PROC | TBC | BP-027/BP-028 v0.1 | Pending | — | — |
| A-UK | TBC | Four-nation sections and provider policy | Pending | — | — |
| A-PRIV | TBC | ICO guidance current at review | Pending | — | — |
| A-SEC | TBC | Threat assessment v0.1 | Pending | — | — |
| A-SPON | TBC | Current Student Sponsor Guidance | Pending | — | — |
| A-INT | TBC | Contract vocabulary v0.1 | Pending | — | — |

`Approved with actions` is permitted only where an action does not alter the domain boundary, lawful basis, data classification, authority, adverse-decision control or public contract. Any such material change returns the affected artefacts for amendment.

## Exit gate

Increment A is complete only when:

1. A-ARCH, A-PROC, A-PRIV, A-SEC, A-SPON and A-INT have an approving outcome;
2. A-UK has approved or recorded bounded national actions;
3. ATT-A01–ATT-A10 are resolved;
4. ADR-016, ADR-019 and ADR-022 are accepted or superseded;
5. the controller DPIA has an approval reference; and
6. the accepted vocabulary version is recorded for migration and contract authors.

Until then, `pnpm check:attendance-increment-a` reports the pack as structurally ready but approval-gated.
