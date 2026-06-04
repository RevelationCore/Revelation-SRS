# Reference Model Review

> Status: Draft for review
> Reviewed sources:
> - `docs/reference/revelation-student-records-reference-model.md`
> - `docs/reference/revelation-student-records-enterprise-reference-model-2.1.json`

## Summary

The raw JSON reference model contains 33 systems and 69 interactions. Flow IDs run from F001 to F070, but F054 is absent. The markdown summary contains several inconsistencies with both itself and the JSON model. These issues do not invalidate the model, but they should be explicitly handled before Revelation SRS treats the reference model as a complete requirements source.

## Findings

### REF-001 — Flow count inconsistency

The markdown overview says the model has 69 flows, while the model structure section says it organises 70 logical flows. The JSON contains 69 interactions.

Impact: Phase 1 states that requirements were derived from 70 reference model flows. This creates a traceability problem because one flow ID is missing from the source model.

Recommended action: Treat the reference as 69 published interactions with a reserved or missing F054. Update Phase 1 wording to distinguish between "F001-F070 identifier range" and "69 published flows".

### REF-002 — Missing F054

The JSON has no F054 interaction. The flow sequence moves from F053 to F055.

Impact: Any automated coverage check against F001-F070 will report a missing source flow. Human reviewers may assume a Wellbeing-related flow was accidentally dropped, because F053 and F055-F060 sit in the same reference category.

Recommended action: Add an explicit local note that F054 is absent from the published reference model. Do not invent a Revelation requirement for F054 unless a corrected upstream model is obtained or the project deliberately defines a local extension.

### REF-003 — Category table count mismatch

The markdown says the model organises flows across six categories, but the table lists five categories. The category counts sum to 69.

Impact: The current category structure may cause requirements grouping errors and false assumptions about omitted domains.

Recommended action: Update the markdown summary to say five categories, or add the missing category if the upstream article defines one.

### REF-004 — Wellbeing category range is misleading

The markdown category row says "F053, F055-F060", which is accurate for the published JSON but visually odd because F054 is skipped.

Impact: This obscures whether F054 was intentionally retired, accidentally omitted, or belongs to a different category.

Recommended action: Add a footnote in local docs: "F054 is not present in reference model version 2.1."

### REF-005 — Accommodation and Estates are duplicated in the markdown portfolio

The markdown lists ACC and EST under Enterprise Administration and again under Campus & Facilities. The JSON assigns both to Campus & Facilities.

Impact: This can lead to duplicate actor classification or inconsistent ownership in the actor catalogue.

Recommended action: Use the JSON as canonical: ACC and EST belong to Campus & Facilities.

### REF-006 — ESB is a disconnected system in the JSON

The JSON includes `ESB` as a system actor, but no interaction has `ESB` as source or target.

Impact: Revelation SRS has an integration-layer principle, but the reference model does not show whether ESB is an implementation pattern, an external system, or a logical intermediary. This matters for contract ownership and adapter design.

Recommended action: Treat ESB as an optional institutional integration pattern, not a domain actor with required flows. Record that Revelation SRS replaces this role with the internal integration layer unless an institution explicitly integrates through an enterprise bus.

### REF-007 — Some reference flows are not SIS-facing

F055, F056, F057, and F058 do not involve SIS directly:

| Flow | Direction | Description |
|---|---|---|
| F055 | VLE -> BI | Learning analytics and digital engagement data |
| F056 | AM -> BI | Attendance trends and engagement analytics |
| F057 | DW -> BI | Consolidated multi-system data feeds for analytics |
| F058 | CRM -> EWP | Personalised communications and targeted content |

Impact: These are enterprise ecosystem flows, not necessarily SRS product responsibilities. Phase 1 currently implies all reference flows are SRS requirements, which overstates SRS ownership.

Recommended action: Mark non-SIS-facing flows as "reference context" unless Revelation SRS will broker them through its integration layer.

### REF-008 — Governance actors are mixed with systems

EXAMBOARD and EXTEX are actors in the JSON, but they appear alongside systems. This is semantically correct in the reference model but needs careful translation into Revelation architecture.

Impact: Treating governance actors as integration adapters would be wrong. They need user roles, workflows, secure UI/API surfaces, and audit trails rather than system-to-system contracts.

Recommended action: Keep EXAMBOARD and EXTEX as human/governance actors in the actor catalogue and workflow catalogue. Only model technical integration where an external examiner platform or board pack tool exists.

## Required Baseline Corrections

Before Phase 3 proceeds, update or annotate the baseline documentation so that:

- The source reference model is described as 33 systems/actors and 69 interactions.
- F054 is explicitly documented as absent from reference model version 2.1.
- ACC and EST are classified once, under Campus & Facilities.
- ESB is optional context, not a required Revelation SRS adapter.
- Non-SIS-facing reference flows are separated from SRS-owned requirements.
