# ADR-020: Model Assessment as Staged Authority with an Immutable Ratification Lock

**Status**: Accepted for generic product implementation
**Date**: 2026-07-26

## Context

W005 spans mark intake through publication. The business-process review shows that raw marks, moderated marks, calculated results, board decisions and published outcomes have different authorities. Treating them as one mutable result risks premature publication, irreproducible calculation and unauthorised post-board change.

## Decision

Assessment shall use explicit staged records:

1. approved assessment-pattern/rule version;
2. candidate attempt;
3. raw mark/submission fact;
4. moderated/confirmed mark-set version;
5. calculated module/progression/award recommendation with explanation;
6. immutable board snapshot and authorised decision;
7. ratified outcome lock;
8. publication/delivery state.

Transitions are one-way except through a linked, authorised correction case. Ratification references the exact board pack, membership/quorum, sign-offs and decision set. A correction appends a bitemporal version and creates republication items; it never unlocks or edits the ratified row in place.

Domain events and contracts shall include stage/status and authoritative version. Only ratified events may drive final transcript, progression, award or student-result consumers.

## Rationale

- Preserves academic authority and external-examiner/board evidence.
- Makes calculations reproducible.
- Prevents consumers from mistaking provisional marks for final results.
- Supports controlled correction without destroying history.

## Consequences

- W005 requires decomposition and migration compatibility.
- New assessment, mark-set, board-snapshot and amendment entities are required.
- Existing consumers must enforce the authoritative-stage contract.
- Board pack generation needs snapshot/hash semantics.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| One mutable result row with status | Weak provenance and accidental overwrite risk |
| Unlock after board approval | Removes evidence of the originally ratified fact |
| Store calculations only in reports | Cannot reproduce or test decision inputs |

## Traceability

- Requirements: ABR-001–ABR-017, XIC-008
- Backlog: BPR-W09–W10, D10–D11, D13, I08
- Processes: BP-05-001–BP-05-011

