# Institution Adoption Checklist

> Status: Current (2026-11-23)
> Sources: [SME delegate decisions, 2026-11-23](../decisions/sme-delegate-decisions-2026-11-23.md); [ADR-030](../decisions/ADR-030-malware-scanning-of-uploaded-documents.md), [ADR-031](../decisions/ADR-031-governed-identity-merge-and-propagation.md), [ADR-033](../decisions/ADR-033-authority-for-recording-a-core-adjustment.md); [Phase 5 D-35](../decisions/phase-5-gap-closure-decisions.md)

An institution adopting Revelation SRS must supply these facts and settings itself. No one outside the institution can know them, so the product does not invent them.

Each row gives:
- who supplies the item, and when: before go-live, or before a feature is enabled;
- the safe default the product uses until it is supplied;
- how the product enforces it, if it can.

"Planned" means the enforcement is a backlog item that is not yet built. Outstanding engineering work is tracked in the [backlog](backlog.md), not here.

## Deployment and security

| ID | What the institution supplies | Who | When | Safe default until then | How the product enforces it |
|---|---|---|---|---|---|
| A-1 | The secret key for the public-verification IP hash: OpenBao `kv/srs/api/public-verify`, field `ip_key`, at least 32 characters (BL-184). The [security incident runbook](../runbooks/08-security-incident.md) shows how to generate it | Platform operator | Before go-live | None. Outside development and test there is no fallback key | The API refuses to start in production without a key of at least 32 characters. If the worker's copy of the routes has no key, they answer 503 |
| A-3 | The address of the `srs-security` alert receiver for `DocumentMalwareDetected`: the institution's information security team or SOC (SME-2, BL-344) | Information security lead | Before go-live | The platform operator's on-call receives it | Planned: `check:k8s` fails a production build with no `srs-security` address |
| A-4 | Only if the institution wants to accept encrypted files or files with Office macros: a recorded risk acceptance (SME-1). Not recommended | Information security lead | Before the change is deployed | Both are refused (`AlertEncrypted yes`, `AlertOLE2Macros yes`) | Planned: `check:k8s` fails a production build that turns either off without the risk-acceptance annotation |
| A-5 | Another way for a student to send evidence the upload refuses, for example a password-protected letter from a third party, and the contact to name in the message (SME-1) | Head of disability services; EC and appeals owners | Before go-live | The message tells the student to remove the password or macros and upload again | Not enforced. The portal message is BL-346 |
| A-13 | The retention period for the public verification log, stated in the privacy notice (BL-389) | DPO | Before go-live | Rows are kept, holding only the IP HMAC | Planned: a scheduled job clears older rows (BL-389) |

## Academic rules

| ID | What the institution supplies | Who | When | Safe default until then | How the product enforces it |
|---|---|---|---|---|---|
| A-2 | The academic rules for each programme from its own regulations: pass mark, classification boundaries, classification algorithm, resit cap, progression and compensation rules, and any discretion zone (BL-179, BL-390, SME-9, SME-10). An administrator may apply the starter rule set (UG pass 40 and 70/60/50/40; PGT pass 50 and distinction 70, merit 60; resit cap at the pass mark), then adjust it. The starter set has no algorithm and no values for integrated masters, Scottish or research programmes | Academic registrar; academic standards committee | Before any result is calculated for that programme | Calculation for an unconfigured programme is refused (422 `RuleNotConfiguredError`). Built-in defaults are refused for every tenant that is not a demo tenant | Built: the refusal, and `rules.builtInDefaults = 'allow'` refused outside demo tenants (SME-9, BL-391). Planned: the starter rule set (SME-10, BL-392); a rule-readiness report and go-live check (BL-390) |

## Identity resolution

| ID | What the institution supplies | Who | When | Safe default until then | How the product enforces it |
|---|---|---|---|---|---|
| A-6 | The people who hold `identity-resolution-officer`: at least two senior student-records staff, not IAM administrators (SME-4) | Registry process owner | Before identity merges are used | Nobody holds the role, so no merge can be decided | Built: each case needs two different people (BL-353). The number of holders is not checked |
| A-7 | How its IAM handles a merged account: binding it to the survivor, or ending it at once, and telling the student which account to use (SME-5, F-SIS-IAM-01) | IAM owner | Before identity merges are used | The ledger items wait as manual tasks for the IAM target | Planned: the `rebind` and `ended`/`merged` instructions (BL-357) |
| A-14 | Its lawful-basis assessment for resolving duplicate records, and a line in the student privacy notice saying that duplicate records are merged and how a student can query a merge | DPO | Before identity merges are used | Not applicable | Not enforced |

## Reasonable adjustments

| ID | What the institution supplies | Who | When | Safe default until then | How the product enforces it |
|---|---|---|---|---|---|
| A-8 | The people who hold `adjustment-approver`: the head of the disability service, or disability advisers with delegated authority (SME-6) | Head of disability services | Before the manual path is enabled, or before migrated adjustments are released | Nobody holds the role, so no manual adjustment is approved and no migration batch is released | Built: the role and `adjustment:approve-manual` (BL-378); release with BL-379 |
| A-9 | The people who hold `adjustment-proposer`, if disability-service administrators outside registry will enter manual adjustments (SME-6) | Head of disability services | Before the manual path is enabled | Only `registry-administrator` may propose | Built (BL-378) |
| A-10 | Which route records adjustments: the wellbeing module, or the manual path (`adjustments.manual-proposals.enabled`), or both (SME-7) | Head of disability services; academic registrar | Before go-live | The manual path is off | Planned: the go-live check fails when a tenant has neither a registered wellbeing service client nor the flag on |
| A-11 | Any manual reason codes beyond the four seeded, none of which may describe a condition (SME-7) | Head of disability services | Before the manual path is enabled | The four seed codes | The value set validates every code |
| A-12 | For each migrated adjustment batch: the legacy system's report, its reference and its count, recorded in the cut-over plan (SME-8) | Data migration lead | Before a batch is released | Migrated adjustments apply to late penalties and board indicators, but are not sent to the VLE or exams | Built (BL-379): `POST /adjustment-migration-batches/:batchId/release` refuses a count that does not match (409 `migration-count-mismatch`) and requires `reconciliationReference`, recorded in the audit row; the importer prints the batch id |
