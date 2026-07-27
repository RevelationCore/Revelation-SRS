# ADR-022: Treat CAS and Sponsor Compliance as Governed Evidence-Bearing Decisions

**Status**: Proposed
**Date**: 2026-07-26

## Context

The current requirements describe generating a CAS request and monitoring attendance. Current Student sponsor duties require evidence, academic-engagement policy application, circumstance decisions and timely reporting. An SMS transaction alone does not prove the institution made or authorised the correct academic/sponsorship decision.

## Decision

CAS and sponsor compliance shall use SRS-owned governed cases while UKVI Sponsor Management System remains authoritative for accepted sponsor transactions.

- A CAS case records guidance version, sponsor/course/location facts, eligibility checks, evidence and approval.
- The assigned-CAS version preserves the exact outbound data and SMS receipt.
- Academic status, sponsorship and SMS reporting are separate linked decisions.
- Engagement evidence may create an alert/intervention but cannot directly create a withdrawal-of-sponsorship report.
- Every report/no-report decision records policy/guidance version, evidence snapshot, authority, deadline and rationale.
- SMS corrections create linked reports; prior evidence is immutable.

Only minimum necessary UKVI transaction data is copied into the SRS; immigration documents remain in the authorised evidence store where architecture/policy assigns them.

## Rationale

- Separates institutional academic authority from sponsor reporting.
- Provides inspection evidence and deadline control.
- Prevents inaccurate automated reporting from raw attendance.
- Reconciles SRS decisions with the external SMS record.

## Consequences

- W009 and W012 require decomposition/correlation.
- CAS, compliance case, evidence reference and report-version entities are required.
- The UKVI adapter must support receipts, correction links and reconciliation.
- Guidance currency becomes operational configuration with expiry/review alerts.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Treat SMS as the complete case record | Does not preserve internal evidence, authority or academic decision |
| Auto-report threshold breaches | Conflates evidence with governed sponsor decision |
| Store all documents in general SRS tables | Unnecessary sensitive-data exposure |

## Traceability

- Requirements: BPC-001–BPC-009, ESP-003–ESP-005, XIC-001–XIC-007
- Backlog: BPR-W02, W07, D03, D08, I03
- Processes: BP-005, BP-027–BP-028, BP-052

