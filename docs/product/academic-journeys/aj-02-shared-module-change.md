# AJ-02 — One module, several programmes

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Programme review](aj-03-programme-review-and-improvement.md)

**Perspective:** the Statistics module leader, Aisha and a neighbouring programme director. **Boundary:** a proposed change to a shared module through impact review, rework and an approved dependency; AJ-03 owns the complete EDS publication release. **Timeline:** t+44 to t+74, followed by AJ-03's t+86 acceptance and t+156 future applicability. Use the [original anchor](README.md#timeline-convention).

## The story

### A review exposes a teaching problem — t+44

The first-year review in AJ-03 identifies difficulty interpreting statistical uncertainty. The Statistics leader opens `MCP-SCI440-002`, linking the evidence and the current `SCI440@1.0` specification. They can see its outcomes, assessment criteria, level, credits and owning school, independently of its dated class offerings.

A where-used report includes Environmental Data Science and the supplied Geography route. It also identifies current students, future offers and interrupted students who may need the old version. The leader cannot assume the module belongs only to Aisha because her programme initiated the review.

### The first solution breaks a route — t+46 to t+50

Draft `r1` proposes passed `SCI420` as a prerequisite and revised statistical-interpretation criteria. Geography teaches its programming and statistics modules concurrently in the supplied delivery plan, and EDS's first-year plan has no guaranteed prior pass either. Requiring an earlier pass makes those routes infeasible. Merely preserving the total of 120 credits would miss the problem.

Aisha and the neighbouring director return the draft for rework. The report identifies the affected dependency and a concrete failing sequence. There is no invitation to waive the new rule informally for each student. Resource owners also ask who would teach any necessary preparation and maintain legacy assessment arrangements.

### Rework changes the proposal, not its history — t+51 to t+58

In `r2` the leader removes the new prerequisite and adds a supported introductory workshop within Statistics. The revised specification states the intended learning outcome on interpreting uncertainty, the assessment criteria that demonstrate it, and the required teaching resources. Level 4 and 20 credits remain unchanged. The proposed assessment map and full component specification must be supplied before approval; a sentence in the narrative is not a publishable module specification.

Reviewers receive the diff from `r1`, the revised route checks and resource attestations. Comments and the earlier return remain linked. The revised academic content receives fresh approval rather than inheriting the signature attached to different content.

### Approve content and protect existing commitments — t+60 to t+72

The designated panel checks the route witnesses, outcome/assessment mapping, required consultation, quorum and conflicts. A blocking condition requires a funded plan for version-1 delivery and assessment from 2033/34, when both versions will run in parallel. Its independent verification precedes final approval at t+72. The approved definition becomes `SCI440@2.0`; a late response for `r1` cannot approve it.

Sam, Nina, Ben, Leah, Priya, Omar and Jo retain their assigned version-1 curriculum. Geography also retains version 1 until its own approved change. Shared teaching resources may be reused only where delivery can honour each version's criteria; a common room does not make assessment versions interchangeable. The legacy plan covers Geography and EDS students repeating or resitting under version 1 from 2033/34, including the variant in which Omar needs a further attempt. His 2032/33 return itself uses the regular version-1 offering (AJ-28), because version 2 applies to nobody before t+156.

### Hand over an approved dependency — t+74

The module owner supplies the immutable version, dependency and approval bundle to AJ-03. That programme review checks its whole release and makes the new module applicable to EDS entry 2033. The module is not made selectable merely because its approval task is complete.

An external curriculum provider must supply equivalent provenance through the canonical acceptance contract. A new annual offering of unchanged version 1 remains a delivery record; it does not create a fresh academic definition. If a material late change is needed, it returns through approval and invalidates the affected release preview.

## Starting pack and authority

Supply the accepted `SCI440@1.0`, exact EDS and Geography route dependencies, current/future/returner scopes, review evidence, academic-change policy and resource snapshots. The Geography dependency is a synthetic fixture, not an assertion of implemented programme data. The module owner authors; each programme owner assesses its impact; resource owners attest deliverability; the panel approves; the publisher separately authorises the complete release. Reviewers may not approve their own changes.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A02-01 | t+44 | Open change against the shared version and review evidence. | Owned proposal and complete where-used scope. |
| A02-02 | t+46 to t+50 | Test r1's new prerequisite against concurrent routes. | Concrete incompatibility; return for rework. |
| A02-03 | t+51 to t+58 | Submit r2 with workshop, mapping and resource evidence. | New revision and fresh route/assessment checks. |
| A02-04 | t+60 to t+68 | Panel review and verify legacy-delivery condition. | Attributable review and discharged blocking condition. |
| A02-05 | t+72 | Approve exact module version and dependencies. | Frozen `SCI440@2.0`; existing bindings unchanged. |
| A02-06 | t+74 | Deliver approved dependency to AJ-03. | Programme-release input receipt; not yet selectable. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A02-I01 / CM-QUAL-002; GI-21 | CM → programme owners: proposed revision, where-used paths and failing route witnesses. | Revision + impact scope; curriculum ownership. | Attributable review responses; unknown dependency coverage blocks completeness. |
| A02-I02 / GI-10, GI-14 | CM ↔ delivery/resource owners: workshop and legacy-offering requirements, dated staff/resource commitments. | Proposal revision + attestation version; resource owner. | Verified feasibility or owned condition; a missing reply is not approval. |
| A02-I03 / CM-WF-003, CM-WF-005 | Author ↔ review workflow: exact revision/diff, criteria map, conditions and decisions. | Revision + review action; scoped reviewer/panel authority. | Frozen approval and condition evidence; stale decisions rejected. |
| A02-I04 / A03-I03; CM-PUB-001 | Module owner → programme release owner: approved definition, dependency manifest and legacy constraints. | Module version + bundle digest; module publisher. | Release-input receipt; changed content requires a new version and renewed checks. |

The eventual F-CM-SIS-01 publication is owned by AJ-03 and uses AJ-01's canonical acceptance semantics. AJ-18/19/20 later consume exact accepted definitions and offerings; this proposal creates no student roster.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A02-AC01 | Discover all supplied uses of `SCI440@1.0`. | EDS, Geography and returner dependencies included; no author-school-only review. |
| A02-AC02 | Add passed `SCI420` before concurrently taught Statistics. | Failing sequence explained; unchanged credit total cannot make it valid. |
| A02-AC03 | Submit r2 after rework. | Previous comments retained, revised criteria/resources reviewed afresh. |
| A02-AC04 | Legacy-delivery condition lacks verification. | Final approval/release gate blocked with owner and evidence request. |
| A02-AC05 | Approve version 2 while version-1 students exist. | Original bindings and criteria remain; no silent student migration. |
| A02-AC06 | Replay old revision decision or alter content after approval. | Stale decision rejected; changed content needs new governed revision. |
| A02-AC07 | Create next year's offering of unchanged version 1. | New dated delivery record only; academic version unchanged. |
| A02-AC08 | Programme release omits an approved module dependency. | Atomic acceptance blocked; module approval alone creates no selectable course. |

## Traceability, implementation and review

CAT-002–009 in [core requirements](../../requirements/functional-requirements.md); CM-MOD-001–009, CM-OUT-003, CM-WF-003–010, CM-VER-008/009 and CM-QUAL-002 in [curriculum requirements](../../requirements/curriculum-management-system.md). GI-10/GI-14/GI-21 cover operational resources and governance. The process inventory's study-selection processes consume the outcome; they do not stand in for the proposed curriculum-authoring workflow.

The [capability matrix](../current-capabilities.md) records catalogue and selection capabilities as partial; the comprehensive curriculum module remains proposed. Review owners, unassigned: module and programme leaders, quality panel, students, timetabling and resource owners. Closing evidence is the impact report, failing/passing routes, exact approved specification and verified legacy commitments accepted into the later release.
