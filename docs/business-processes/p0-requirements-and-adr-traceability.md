# P0 Requirements and ADR Traceability

> Status: Complete proposed mapping
> Date: 2026-07-26

[P0 functional requirements](../requirements/business-process-p0-functional-requirements.md) · [Change backlog](revelation-change-backlog.md)

| P0 backlog item | Functional requirements | Architecture decisions |
|---|---|---|
| BPR-W02 | BPC-001–BPC-009 | ADR-016, ADR-019, ADR-022 |
| BPR-W07 | BPC-007; ESP-001–ESP-006 | ADR-016, ADR-022 |
| BPR-W08 | ESP-007–ESP-012 | ADR-016, ADR-017, ADR-019 |
| BPR-W09 | ABR-001–ABR-013; XIC-008 | ADR-016, ADR-020 |
| BPR-W10 | ABR-014–ABR-017 | ADR-016, ADR-019, ADR-020 |
| BPR-W12 | RSS-001–RSS-011 | ADR-016, ADR-018, ADR-019 |
| BPR-W13 | IGA-001–IGA-018 | ADR-016, ADR-019, ADR-021 |
| BPR-D03 | BPC-001–BPC-006 | ADR-022 |
| BPR-D08 | ESP-001–ESP-005 | ADR-016, ADR-022 |
| BPR-D09 | ESP-007–ESP-012 | ADR-017, ADR-019 |
| BPR-D10 | ABR-001–ABR-006 | ADR-020 |
| BPR-D11 | ABR-007–ABR-013 | ADR-020 |
| BPR-D13 | ABR-014–ABR-017 | ADR-013, ADR-020 |
| BPR-D16 | RSS-001–RSS-011 | ADR-013, ADR-018 |
| BPR-D17 | IGA-001–IGA-006 | ADR-013, ADR-021 |
| BPR-D18 | IGA-007–IGA-015 | ADR-021 |
| BPR-D19 | IGA-016–IGA-018 | ADR-021 |
| BPR-I03 | BPC-005–BPC-009; XIC-001–XIC-007 | ADR-019, ADR-022 |
| BPR-I07 | ESP-009–ESP-012; XIC-001–XIC-007 | ADR-017, ADR-019 |
| BPR-I08 | ABR-012; XIC-001–XIC-005; XIC-008 | ADR-019, ADR-020 |
| BPR-I10 | RSS-001–RSS-011; XIC-001–XIC-007 | ADR-018, ADR-019 |
| BPR-I11 | RSS-012; XIC-001–XIC-007 | ADR-018, ADR-019 |
| BPR-I12 | IGA-004; IGA-011–IGA-015; XIC-001–XIC-007 | ADR-019, ADR-021 |

## Decision status

ADR-013 provides the temporal storage primitive. ADR-016, ADR-017, ADR-019 and ADR-022 are accepted for generic product implementation; each institution retains its deployment approvals. ADR-018, ADR-020 and ADR-021 remain proposed pending their domain reviews.

## Implementation specifications

| Scope | Processes and requirements | Specification | Decision review |
|---|---|---|---|
| Attendance and academic engagement | BP-04-001–BP-04-002; ESP-001–ESP-006; BPR-W07; BPR-D08 | [Attendance and engagement vertical slice](../product/attendance-engagement-vertical-slice.md) | [Attendance ADR review](../decisions/attendance-vertical-slice-adr-review.md) |

## Coverage rule

A P0 item is ready for delivery planning only when its process pages have an SME outcome, ADRs are accepted or superseded, requirements are reconciled with the existing catalogue, architecture trace targets are assigned and acceptance tests are linked.
