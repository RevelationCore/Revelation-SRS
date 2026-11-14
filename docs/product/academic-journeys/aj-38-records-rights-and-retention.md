# AJ-38 — A record that remains explainable after the student leaves

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Awards and documents](aj-29-awards-graduation-and-alumni.md)

**Perspective:** Sam as a former student, an information-rights officer and a records manager. **Boundary:** a scoped request through verified identity, distributed search, reviewed disclosure and separately authorised correction/restriction; retention and disposal remain distinct decisions. **Timeline:** t+160 to t+166, then a separately supplied future retention-eligibility scenario. Use the [original anchor](README.md#timeline-convention); policy deadlines govern actual scheduling.

## The story

### Leaving does not remove the right contact route — t+160

After graduation Sam requests copies of the held academic records and correspondence about an address change. The information-rights officer opens `RIGHTS-SAM-001`, records the received timestamp, scope, applicable jurisdiction and calculated deadline, and acknowledges the request through an accessible route. Under the UK default of one calendar month, a request received on 17 October 2033 is due by 17 November 2033, so the disclosure is planned for t+164 (14 November). The illustrative weeks are not a substitute for the applicable deadline or pause rules.

Sam's student login may have ended under AJ-29, so identity is verified through an authorised former-student route. Staff do not reactivate broad learning access just to deliver documents. A representative would need verified, scoped authority; knowing Sam's former student number does not confer access.

### Search the systems that actually hold the evidence — t+160 to t+162

The officer creates a search manifest covering Registry records, admissions correspondence, archive references and any relevant service-held material. Each owner records the query scope, time, responsible reviewer and result set, including justified no-results responses. Sam's request does not authorise a search of every unrelated person's data.

The transcript's archive receipt from AJ-29 is reconciled against the stored digest and retrievable document. If an archive link fails, records staff open a recovery task and consult the authoritative issue record. A blank result from one search is not proof that the university holds nothing. The response remains explicitly incomplete where a required search is outstanding, with deadline management and ownership recorded.

### Review disclosure without changing source records — t+161 to t+163

The returned correspondence includes a third party's contact information and internal discussion. The authorised reviewer evaluates disclosure, restriction or redaction under the configured policy and records a reason for each decision. The disclosure copy is separate from the authoritative source, with provenance and a manifest. Redaction does not rewrite the original email or remove it from the audit trail.

An unresolved question goes to the information-rights/privacy owner. General staff do not gain broad support-evidence access because a rights case exists. The officer explains any withheld scope and review route to Sam without revealing the information being protected.

### A correction request has its own authority — t+163 to t+166

Sam identifies that an old correspondence address is still marked current, despite an acknowledged later update. Registry checks the supplied evidence, distinguishes an inaccurate historic record from a newly changed address and records the appropriate valid and transaction times. The correction is authorised under the personal-data route, not a new academic decision.

Sam's award remains unchanged. A separate request challenging an academic mark or classification goes to AJ-27; a rights officer cannot lift an academic lock. An approved processing restriction or erasure request is decided per datum and purpose, with its authority, exceptions and receiving-service consequences. The case does not promise deletion of every academic record on demand.

The corrected contact state reaches the relevant consumers and its receipts are reconciled. The officer delivers the authorised disclosure at t+164 while the separately tracked correction, requested at t+163 with its own clock, completes at t+166; the statuses and explanation remain distinct. A complete response bundle has its own issue version, delivery evidence and accessible retrieval route.

### Retention is a governed lifecycle, not a graduation timer

The records manager reviews the applicable record-class schedule, retention trigger, period, disposition and holds. The main story makes no claim that Sam's award or transcript is due for deletion at t+166. The later disposal branch supplies an actually eligible synthetic record, a verified schedule and all dependent locations.

An active appeal, investigation or other authorised hold blocks disposal for its scope and has an owner/review date. Once the record is eligible and no hold applies, an authorised disposition addresses source records, derived copies, indexes and governed backups. A backup that cannot yet be purged needs an explicit retention/restore control and owned exception; a request sent to storage is not a completed disposal certificate.

The certificate records what class/scope was disposed, authority, execution evidence and remaining exceptions without retaining the disposed sensitive content. Restoration procedures must reapply authorised restrictions and dispositions so old data cannot silently reappear. Historic gaps in audit coverage are reported as gaps; nobody reconstructs fictitious access logs to make the record look complete.

## Starting pack and authority

Supply Sam's conferred award/document issue references, actual archive receipt/digest fixture, request and verified identity evidence, search-owning services, applicable policy/deadline calculation and scoped reviewers. Use synthetic correspondence only. The later disposal branch separately supplies a due schedule and hold/dependency inventory. The rights officer coordinates disclosure; source owners search and correct their facts; academic authorities own academic amendments; records/privacy authorities decide retention and restrictions; operators execute scoped disposition.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A38-01 | t+160 | Receive request, verify identity and calculate policy deadline. | Owned scope and accessible contact route. |
| A38-02 | t+160 to t+162 | Search sources and verify archived issue references. | Complete search manifest or owned missing responses. |
| A38-03 | t+161 to t+163 | Review disclosure/redaction and prepare response copy. | Reasoned, versioned disclosure bundle; originals unchanged. |
| A38-04 | t+163 to t+166 | Decide address correction and recipient propagation. | Separate authorised fact correction; award unchanged. |
| A38-05 | By the configured deadline, planned t+164 | Deliver response and record outstanding separate decisions. | Delivery evidence and accurate closure/review status. |
| A38-06 | Later eligible date, separate fixture | Check schedule/holds and execute approved disposition. | Scoped certificate and residual-copy controls; no assumed graduation purge. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A38-I01 / F-EWP-SIS-01; GI-17, GI-20 | Requester/authorised former-student route → rights service: identity evidence reference, scope and requested action. | Request revision; verified requester/representative. | Acknowledgement and calculated deadline; duplicate request linked, broad account access not assumed. |
| A38-I02 / GI-17; IGA-008 | Rights coordinator ↔ source owners: authorised search scope and returned manifest/results. | Request + source + search revision; scoped search authority. | Attributable complete/no-results/partial response; missing source remains owned. |
| A38-I03 / F-SIS-EDRMS-01, F-EDRMS-SIS-01 | Records owner ↔ archive: issue/digest reference, permitted retrieval and archive/access confirmation. | Document issue + retrieval/archive action. | Matching retrievable version and access record; mismatch opens recovery, not fabricated receipt. |
| A38-I04 / IGA-005/006/012; A27-I04 | Approved correction/restriction owner → affected services: datum/purpose scope, decision and effective version. | Decision + destination; source-specific authority. | Applied correction/restriction or owned exception; academic changes require AJ-27 separately. |
| A38-I05 / F-SIS-EWP-01; GI-17 | Rights service → requester: reviewed disclosure version, explanation and secure retrieval details. | Response issue + recipient; disclosure authority. | Delivery/access evidence and retained decision manifest; source documents unchanged. |
| A38-I06 / IGA-013–015; GI-17 | Records authority → storage/index/backup owners: approved disposition scope, schedule and hold check. | Disposition decision + target. | Execution evidence or controlled residual exception; no disposal certificate based only on a send. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A38-AC01 | Former student lacks an active portal account. | Accessible verified request/delivery route without unrestricted reactivation. |
| A38-AC02 | Calculated deadline precedes the illustrative t+164. | Schedule brought forward/escalated under actual policy; narrative date cannot extend the deadline. |
| A38-AC03 | One source fails to respond or archive digest differs. | Owned incomplete search/recovery; no assertion of complete disclosure. |
| A38-AC04 | Disclosure includes third-party information. | Reasoned scoped review/redaction in response copy, immutable source retained. |
| A38-AC05 | Verified address correction is requested. | Proper valid/recorded-time correction and consumer propagation; no award change. |
| A38-AC06 | Rights request seeks to change a ratified mark. | AJ-27 academic authority required; no direct unlock or silent amendment. |
| A38-AC07 | Record is overdue for disposal but an active hold applies. | Disposal blocked for hold scope; owner/review date retained. |
| A38-AC08 | Eligible disposal leaves an index or governed backup copy. | Explicit residual control/exception; completion not falsely claimed, restore protection required. |
| A38-AC09 | Audit evidence is missing or an old event is replayed. | Record the gap or reconcile version; no invented log or revived corrected data. |

## Traceability, implementation and review

BP-08-002–006 and BP-06-004 in the [process inventory](../../business-processes/process-inventory.md); EDR-001/002, GOV-004 and GOV-007 in [core requirements](../../requirements/functional-requirements.md); IGA-005–018 and XIC-006 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-17/GI-20 cover cross-service discovery, accessible delivery and representation.

The [capability matrix](../current-capabilities.md) records partial rights/retention/audit support and explicitly limits historical tamper-evidence claims. It does not establish every service search or backup-disposition contract. Review owners, unassigned: information rights/privacy, Registry, records, archive, security and service owners. Agree applicable clocks, disclosures, restrictions, schedules and hold/restore controls. Closing evidence is the verified request, complete search manifest, reviewed response, separate correction decisions and any independently eligible disposition record.
