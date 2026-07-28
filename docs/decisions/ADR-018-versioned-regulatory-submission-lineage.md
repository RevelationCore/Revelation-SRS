# ADR-018: Version Regulatory Submissions with Field-Level Lineage

**Status**: Proposed
**Date**: 2026-07-26

## Context

HESA/Jisc, OfS, SFC, Medr, Department for the Economy, student-finance and UKVI exchanges depend on changing specifications, provider scope and national rules. A flat exported file plus an audit message cannot reliably reproduce what was submitted or distinguish a source correction from a mapping exception.

## Decision

Every regulatory collection shall be a versioned aggregate comprising:

- regulator/funder, provider scope, specification/schema version, reference period and deadlines;
- immutable source cut-off and population snapshot;
- field/metric lineage to authoritative record versions and transformation/code versions;
- validation issues and dispositions;
- accountable sign-off;
- exact payload or content hash, channel, submission time and receipt;
- amendment/resubmission relationship and cross-return impact.

Authoritative source errors shall be corrected through the owning domain process. A correct source fact may be transformed through an explicitly authorised submission exception, but the exception shall not alter the source.

National contracts and code sets remain separate where semantics differ. HESA-derived national outputs reference the accepted HESA submission version.

## Rationale

- Makes every submitted value reproducible.
- Prevents untraceable spreadsheet/extract patching.
- Preserves national scope rather than assuming an England-only model.
- Supports quality queries, amendments and audit.

## Consequences

- Collection, snapshot, lineage, validation, sign-off and submission entities are required.
- Transformation rules become versioned configuration/code artefacts.
- Storage and retention increase because exact versions must be retained.
- Data owners need controlled correction and resubmission tooling.

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Retain submitted files only | Cannot explain field provenance or reproduce transformation |
| Rebuild from current SRS state | Current data may differ from the signed cut-off |
| Patch rejected extracts manually | Breaks source authority and repeatability |

## Traceability

- Requirements: RSS-001–RSS-012
- Backlog: BPR-W12, D16, I10–I11
- Processes: BP-07-001–BP-07-008

