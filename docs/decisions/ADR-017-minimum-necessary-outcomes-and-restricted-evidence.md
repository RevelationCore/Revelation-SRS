# ADR-017: Keep Restricted Evidence Outside General Student-Record Outcomes

**Status**: Accepted for generic product implementation
**Date**: 2026-07-26

Each deploying controller remains responsible for lawful basis, specialist-system ownership, visibility and retention approval.

## Context

Reasonable-adjustment, exceptional-circumstances, welfare, misconduct, identity and rights processes may use medical, safeguarding, third-party or investigative evidence. Operational systems need an instruction or authorised academic effect, not the underlying evidence. Copying case evidence into the general SRS or every downstream system would expand access and retention risk.

## Decision

Use a two-layer information model:

1. The authorised specialist case service retains restricted evidence, assessment and detailed reasoning.
2. The SRS stores the minimum approved outcome required to operate the student record.

Each SRS outcome shall include source case/decision reference, effective interval, operational instruction/effect, visibility classification, review/supersession state and provenance. Each target receives a separately derived minimum-necessary schema. Evidence URLs shall be opaque, access-controlled references rather than embedded content.

No diagnosis, allegation detail, third-party narrative or safeguarding context shall appear in a general event, dead-letter payload, board indicator or operational roster unless explicitly authorised and necessary.

## Rationale

- Enforces purpose limitation and least privilege.
- Allows specialist retention and access rules to differ from academic-record rules.
- Reduces sensitive-data propagation and breach impact.
- Still permits the SRS to prove why an operational effect existed.

## Consequences

- Outcome schemas need visibility and permitted-purpose metadata.
- Target-specific contracts replace a shared rich support payload.
- Authorisation must be checked when dereferencing specialist evidence.
- Corrections and withdrawals require distribution reconciliation.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Copy full case files into SRS | Excessive access, duplication and conflicting retention |
| Send specialist evidence directly to all targets | Uncontrolled propagation and inconsistent authority |
| Store only a boolean flag | Insufficient scope, timing, instruction and provenance |

## Traceability

- Requirements: ESP-006–ESP-012, IGA-009, XIC-006
- Backlog: BPR-W08, D09, I07
- Processes: BP-030–BP-032, BP-034, BP-038, BP-060–BP-061
