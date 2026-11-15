# AJ-37 — Publishing the right information to the right audience

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Communications fixture](flexible-learning-and-service-fixture.md) · [Approved future release](aj-03-programme-review-and-improvement.md)

**Perspective:** the web editor, communications officer, course owner and a recipient using an accessible channel. **Boundary:** authorised public release or service notice through publication, targeted delivery, correction and any required acknowledgement. **Timeline:** t+86 to t+88; separate online-notice episode tX+2 to tX+4, where tX = t+104.

## The story

### An accepted academic release supplies the public facts — t+86

The editor receives the accepted 2033 EDS release from AJ-03, including approved programme/module versions, entry requirements, start year and the explicit closure of new part-time entry. Academic approval occurred at t+84; SRS acceptance at +86 is evidenced separately. The editor cannot use an unapproved proposal or infer intake closure merely because a route is absent from a draft export.

The public pack names full-time entry for 2033 and explains that existing part-time students remain supported. It preserves the difference between the programme version and the dated recruitment offering. Panel comments, cost models, personal student cases and restricted approval evidence stay out of the public payload. A public page's permission to display a course does not authorise it to expose a personalised student roster.

### Accessible versions share one approved meaning — t+86 to t+87

The content owner and editor check headings, navigation, alternative formats, links, dates and course comparisons. A translated/localised variant has a designated language reviewer and a reference to the approved source version. Machine translation or a stale downloadable prospectus cannot quietly change the conditions of an offer. If a required format is not ready, its publication gate remains owned; an equivalent accessible route is agreed rather than assumed.

The editor schedules publication for t+88 and records the embargo. An isolated negative case attempts early publication: permissions prevent it or the incident is escalated with the exposed version and scope. If content has escaped, removing the page alone does not undo external access. The owner records correction and affected-channel actions, including search/listing caches where supported.

### Reconcile what prospective students can actually see — t+88

The CMS publishes the authorised version and returns its publication reference. The team checks the visible page, approved download, course search and relevant listing destinations against the same manifest. A successful API response with a stale public page leaves that destination incomplete. [AJ-39](aj-39-integration-failure-and-reconciliation.md) handles safe recovery without reapproving the academic release.

The t+88 publication precedes the fictional 2033 recruitment cycle described in AJ-03. If a required destination cannot be corrected by that point, the corresponding recruitment activity remains held and the exception is explicit. The published 2033 full-time course must not overwrite the retained information needed by existing version-1 or part-time students. Approved, published and academically effective dates remain different facts.

### A message needs a justified recipient list — t+88

The communications officer prepares the closure/update notice using the course owner's approved wording and audience rules. Existing part-time students receive information about continuing provision, while prospective 2033 entrants receive the new-entry position. No generic bulk message tells Jo that her course has been cancelled. Offer holders, deferral requests and representatives follow the individual decisions already required by [AJ-04](aj-04-closure-and-teach-out.md).

The audience is a dated, purpose-scoped snapshot, with a final eligibility and suppression check before dispatch. Marketing preferences are handled separately from necessary service notices. A parent, sponsor or agent receives information only within verified delegated scope; paying fees does not establish permission to receive results or private support records. Public CMS content, authenticated personalised content and CRM delivery use separate permissions and payloads.

### Delivery evidence has several distinct meanings — t+88

CRM sends the approved message to the portal and any permitted alternative channel. The record distinguishes queued, sent, delivered, failed, read and explicitly acknowledged states where the channel supports them. A portal view is not proof that the student understands or accepts a policy, and an email transport receipt is not proof that the person has read it.

An undeliverable message opens an owned follow-up using a verified permitted contact route. Operators reuse the original recipient/message operation when retrying and check whether a successor has superseded it. Content is not pasted into broadly accessible diagnostic logs. The communications officer can close a delivery task only with its required evidence or an authorised unresolved-delivery disposition, not by labelling every send successful.

### A corrected notice retains its history — tX+2 to tX+4

In the separate online-course episode, `ONLINE-NOTICE@1` is published at tX+2 as a procedural explanation. It contains an incorrect example date. Farah raises the discrepancy, and the assessment owner confirms the authoritative ONL710 deadline in the fixture; the notice itself has no authority to change that deadline or grant an extension.

The editor publishes corrected version 2 at +3, links and labels the superseded version, and identifies all affected recipients. The service reissues the correction through permitted channels and reconciles cached/downloadable copies. The required acknowledgement at +4 refers to version 2. An acknowledgement of version 1 cannot close the corrected-notice task, and acknowledgement records receipt rather than agreement to changed academic terms.

If an actual academic policy change were proposed, it would first need its own approval, applicability and existing-student protections. The editor would then communicate that authoritative decision. Changing public text is not an alternative route to curriculum or assessment governance. The story closes with versioned publication and recipient evidence, including any still-owned exceptions.

## Starting pack and authority

Supply `NOTICE-2032@1`, the AJ-03 accepted release and closure instruction, public-field manifest, content/format approvals, audience rules, preferences/delegations and isolated channel responses. For Farah, supply the unchanged authoritative deadline and each notice version as published. Academic/policy owners authorise meaning, editors publish approved content, communications owns targeting/delivery and source owners verify recipient context. Required notice does not mean unrestricted disclosure.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A37-01 | t+86 | Verify accepted release, closure scope and public fields. | Exact publishable manifest; restricted governance evidence excluded. |
| A37-02 | t+86 to t+87 | Review accessible/localised versions and embargo. | Approved equivalent content and controlled publication time. |
| A37-03 | t+88 | Publish and verify public destinations. | Applied public version or owned destination/recruitment hold. |
| A37-04 | t+88 | Authorise recipient-specific wording and audience. | Separate existing-student and future-entry notices. |
| A37-05 | t+88 | Deliver, reconcile channel status and handle failures. | Attributed delivery states; no inferred reading/consent. |
| A37-06 | tX+2 to tX+4 | Correct online notice, reissue and acknowledge version 2. | Supersession history and corrected-recipient evidence. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A37-I01 / GI-01 | Accepted-release/publication owner ↔ CMS/listings: authorised public fields, applicable dates and publication status. | Release + content/format version + destination. | Verified visible version; this extends beyond reference personalisation flow F-SIS-CMS-01. |
| A37-I02 / F-SIS-CMS-01 | SRS → restricted personalisation service: minimum cohort/programme eligibility for authorised content. | Audience purpose + source snapshot; source/privacy authority. | Scoped content selection; no individual roster in public CMS/search. |
| A37-I03 / F-CMS-SIS-01 | CMS/policy owner → SRS: published policy/notice version, applicability and required record association. | Document + publication version. | Correct affected-record annotation; publication cannot approve underlying policy. |
| A37-I04 / F-SIS-CRM-01, F-CRM-EWP-01; GI-20 | SRS/communications → CRM → portal/permitted channels: eligible audience, approved message and delivery operation. | Message version + recipient + channel. | Reconciled delivery/failure; CRM-to-portal remains ecosystem-owned. |
| A37-I05 / GI-20; F-EWP-SIS-01 extension | Recipient/channel → notice owner: version-specific acknowledgement or delivery failure; owner → corrected recipients. | Notice version + recipient + acknowledgement/correction operation. | Reading, explicit acknowledgement and supersession distinct; portal contract needs agreement. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A37-AC01 | Public pack contains an unapproved route or panel/private evidence. | Publication blocked or restricted fields removed under authorised review. |
| A37-AC02 | Publish before embargo or with a stale translation/download. | Relevant gate blocks; any exposure receives an owned correction incident. |
| A37-AC03 | CMS acknowledges while the visible page still shows the old version. | Destination remains unresolved; no false recruitment readiness. |
| A37-AC04 | Apply the 2033 intake closure message to Jo as a current student. | Audience/content corrected; continuing provision remains explicit. |
| A37-AC05 | Parent or sponsor lacks delegated permission. | No private recipient disclosure solely on relationship or payment status. |
| A37-AC06 | Email is sent, bounces or portal content is opened. | Record supported state only; never infer understanding, consent or acknowledgement. |
| A37-AC07 | Retry a failed message after version 2 supersedes it. | Reconcile recipient/version and avoid resending obsolete advice. |
| A37-AC08 | Farah acknowledged version 1 before its date correction. | Version-2 acknowledgement remains required; actual academic deadline unchanged. |

## Traceability, implementation and review

CMS-001/002, CRM-001/002, EWP and EDR requirements in [core requirements](../../requirements/functional-requirements.md); XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-01 covers public curriculum publication and GI-20 channel, delegation and acknowledgement contracts. The catalogue's F-SIS-CMS-01 concerns personalisation, not the full prospectus-release boundary.

The [capability matrix](../current-capabilities.md) does not establish the complete CMS/CRM multichannel journey. Review owners, unassigned: academic quality, web/content, communications, Admissions, Registry, accessibility/language reviewers, students and privacy. Closing evidence joins authorised meaning, visible publication, purpose-scoped targeting and separately evidenced recipient states.
