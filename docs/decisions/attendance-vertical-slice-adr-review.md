# Attendance and Engagement Vertical Slice — ADR Review

> Review status: Generic product baseline authorised; institutional adoption approval delegated
>
> Review date: 2026-07-27
>
> Scope: BP-027, BP-028, BPR-W07, BPR-D08 and ESP-001–ESP-006

## Outcome

The generic attendance and engagement vertical slice may proceed to implementation. ADR-016, ADR-017, ADR-019 and ADR-022 are accepted for the generic product baseline. Each deploying institution retains approval of its policies, roles, lawful bases, retention, source authority, contracts and sponsor decisions.

## Decision assessment

| ADR | Relevance to slice | Review recommendation | Condition or clarification |
|---|---|---|---|
| [ADR-016](ADR-016-authoritative-business-state-and-workflow-separation.md) | Direct and foundational | Accept | Expected events, observations, alerts and intervention outcomes are domain records; workflow tasks and retries are correlated operational state |
| [ADR-017](ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) | Direct at referral boundary | Accept | General engagement views store referral type/status only; welfare, disability, medical and safeguarding detail remains in the authorised specialist service |
| [ADR-018](ADR-018-versioned-regulatory-submission-lineage.md) | Not required for the first slice | Defer for its own review | Attendance evidence may later contribute to regulated submissions, but this slice does not create a regulatory submission |
| [ADR-019](ADR-019-per-target-exchange-ledger-and-reconciliation.md) | Direct for inbound sources and downstream referrals | Accept with sequencing condition | Reuse and extend the shared exchange ledger; do not create an attendance-specific delivery ledger |
| [ADR-020](ADR-020-staged-assessment-authority-and-ratification-lock.md) | No direct dependency | Defer for assessment review | Assessment absence and teaching-event attendance remain distinct facts |
| [ADR-021](ADR-021-governed-identity-rights-retention-and-audit.md) | Shared platform constraint | Defer for governance review | The slice must use canonical person identifiers, append-only audit, restriction enforcement and configured retention |
| [ADR-022](ADR-022-cas-and-sponsor-compliance-evidence-boundary.md) | Direct at sponsor-referral boundary | Accept | An engagement alert may create a compliance referral; it must never directly create a report/no-report decision or SMS transaction |

## Findings against the current implementation

1. Migration `0037` and the Drizzle engagement schema now provide the physical expected-event, observation, correction, alert and intervention baseline.
2. The UKVI service currently generates reports with zero absence counts and marks attendance completeness as `pending-attendance-integration`. This is an explicit placeholder, not an attendance system of record.
3. The existing rules engine includes `ukvi-attendance-threshold`, but a threshold breach must create evidence for review rather than an adverse decision.
4. The shared workflow platform can represent intervention tasks, deadlines and decisions, but domain state must not be stored only in workflow context.
5. The integration exchange ledger supplies useful idempotency and delivery fields, but ADR-019 requires source version, target application acknowledgement and reconciliation semantics beyond the current attempt-oriented record.
6. Reasonable-adjustment distribution already recognises an `attendance` target. The attendance slice must consume only the approved operational instruction and must not copy adjustment notes or diagnostic context.

## Required approvals

| Decision | Required review |
|---|---|
| Domain/workflow boundary and lifecycle states | Product owner; solution architect; student-records SME |
| Evidence classification and restricted referral boundary | Data protection; information security; wellbeing/safeguarding SME |
| Engagement policy configuration and four-nation applicability | Engagement/attendance SME; Scotland, Wales and Northern Ireland SMEs |
| Sponsor referral boundary | Student sponsor compliance SME |
| Inbound and reconciliation contracts | Integration architect; operational service owner |
| Retention and correction rules | Records manager; data owner |

## Approval questions

1. Is the SRS authoritative for expected events and normalised observations, or may a configured attendance platform remain authoritative with the SRS holding a reconciled replica?
2. Which observation outcomes and capture methods form the UK-wide core value set, and which are tenant extensions?
3. Which intervention transitions require human authority, segregation of duties or a second approval?
4. What minimum referral status may be visible to teaching, engagement, wellbeing and compliance roles?
5. Which policy variants apply by nation, provider, study mode, location, sponsor status and collaborative-delivery arrangement?
6. What retention periods apply separately to raw observations, correction provenance, alerts, contact attempts and restricted referral links?

## Implementation disposition

Generic physical design may proceed using the accepted contract vocabulary. Public API/event contracts remain versioned and reviewable. Institutions must complete the decisions in the approval pack before processing their identifiable student data; those deployment decisions do not block generic product development.
