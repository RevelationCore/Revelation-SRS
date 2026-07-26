# Business Process Library Completion Review

> Status: Completed — formal SME approval pending
> Review date: 2026-07-26
> Scope: BP-001–BP-063

[Library home](README.md) · [SME review pack](sme-review-pack.md) · [Revelation change backlog](revelation-change-backlog.md)

## Outcome

The documentation baseline is structurally complete and ready for domain SME review. All 63 stable process identifiers have a linked page, numbered flow, alternatives, exceptions, four-nation section, data/integration assessment, Mermaid sequence diagram, sources and review record.

This completion review does not mark any business process `Approved`. Approval requires a named reviewer with the authority described in the [SME review register](sme-review-register.md).

## Consistency controls performed

| Control | Result | Evidence |
|---|---|---|
| Inventory/page one-to-one coverage | Pass — 63 inventory IDs and 63 unique pages | Automated documentation check |
| Stable ID/title/filename convention | Pass | Canonical title and filename checks |
| Required page structure | Pass | 21 required headings checked per page |
| Lifecycle navigation | Pass | Local-link validation across the library |
| Four-nation coverage | Pass | All four national headings required |
| Mermaid/prose actor naming | Pass after 28 mismatches were corrected | Actor-table/participant validation |
| Numbered main-flow sequence | Pass | Sequential numbering validation |
| Source-register integrity | Pass | Every referenced `SRC-nnn` must exist |
| Canonical system name | Pass | Unqualified `SIS` prohibited on process pages |
| Formatting | Pass | `git diff --check` |

## Naming decisions applied

- `Revelation SRS` names the product and `SRS` its system boundary.
- `Prospective Student` is used before initial registration and `Enrolled Student` afterwards.
- `Disability Adviser` uses UK spelling.
- A committee, human decision role and external system are represented separately where that distinction affects authority.
- Existing technical identifiers remain unchanged even where their wording differs from business vocabulary.
- BP-001–BP-063 are stable working identifiers; page status remains `Draft`.

## Cross-process boundaries confirmed

| Boundary | Decision |
|---|---|
| Application versus enrolment | W001 is decomposed; accepted-applicant conversion, registration preparation and enrolment are separate outcomes |
| Academic versus financial registration | Separate states and owners; financial failure does not silently undo academic status |
| Proposed versus confirmed module choice | Proposal, validation/approval and confirmed registration are separate states |
| Specialist support evidence versus SRS outcome | Specialist systems retain sensitive evidence; the SRS receives the minimum operational outcome |
| Raw, moderated and ratified results | Each is a distinct version/state with separate authority |
| Award versus ceremony | Conferment creates the award; ceremony participation does not |
| Source correction versus return patch | Correct authoritative source facts first; submission exceptions retain an explicit rationale |
| Identity merge versus data correction | Identity resolution has independent approval, redirect and reconciliation controls |

## Residual decisions for SMEs

1. Confirm each process owner and delegated decision authority.
2. Validate provider-defined deadlines, thresholds, evidence and appeal/review routes.
3. Confirm four-nation terminology and regulator/funder scope with national SMEs.
4. Decide which proposed actors become authoritative actor-catalogue entries.
5. Approve, amend or reject the proposed architecture items in the [change backlog](revelation-change-backlog.md).
6. Decide the explicit inventory extensions: fitness to practise/study, collaborative provision, apprenticeships/ILR, prior learning/mobility, complaints/OIA hand-off and deceased-student handling.

## Completion position

The consistency stage is complete. The SME stage is review-ready but cannot be declared approved until named reviewers, source checks and decisions are recorded against the reviewed page versions.

