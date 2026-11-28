# SME Delegate Decisions, 2026-11-23

> Status: Decided (2026-11-23); open to ratification
> Date: 2026-11-23
> Context: the policy confirmations still pending on [ADR-030](ADR-030-malware-scanning-of-uploaded-documents.md), [ADR-031](ADR-031-governed-identity-merge-and-propagation.md) (backlog BL-363) and [ADR-033](ADR-033-authority-for-recording-a-core-adjustment.md), and the built-in rule defaults of [Phase 5 D-35](phase-5-gap-closure-decisions.md#d-35-every-calculation-records-the-rule-versions-it-used) (backlog BL-179, pre-review [F-2 and D-35](../business-processes/pre-reviews/pre-review-institution-confirmations.md)); second batch: the confirmations of [ADR-034](ADR-034-authority-for-withdrawing-a-core-adjustment.md) (backlog BL-414)
> Made by: the AI SME delegate (`~/.claude/agents/sme-decision-maker.md`), under the product owner's delegation. No named person has approved, signed off or confirmed anything in this record. Each decision names the role that may ratify or overturn it.
> Numbering: SME-1 to SME-15 (SME-11 to SME-15 in the second batch, [below](#second-batch-withdrawing-a-core-adjustment-adr-034)). It does not continue the D-numbers of the gap-closure records.

These are **product defaults**. Where an adopting institution may differ, the decision names the configuration point. Facts only an institution holds (who holds a role, its alert receiver, its regulations, its migration figures) are not decided here. Each has a safe default and an item in the [institution adoption checklist](../product/institution-adoption-checklist.md).

Work may proceed on every decision before ratification.

## Sources consulted

| Source | Version read | Used for |
|---|---|---|
| ClamAV, *End of Life Policy* (docs.clamav.net/faq/faq-eol.html) | Read 2026-11-23; undated page, support matrix latest entry 1.5 (7 Oct 2025) | SME-3 |
| NCSC, *Macro security for Microsoft Office* | Version 3.0, last reviewed 11 October 2023, read 2026-11-23 | SME-1 |
| ICO, *Personal data breaches: a guide* | Updated 20 August 2025, read 2026-11-23 | SME-4, SME-5 |
| OfS, regulatory framework guidance on condition B4 (assessment and awards), and *Bachelors' degree classification algorithms* | Pages read 2026-11-23 (search summaries and guidance page) | SME-9, SME-10 |
| UKSCQA, *Principles for effective degree algorithm design* (July 2020) | Summary read 2026-11-23; full text not re-read | SME-10 |
| QAA, *Frameworks for Higher Education Qualifications* (FHEQ, 2024) | From knowledge, not re-read. The FHEQ sets levels, not pass marks | SME-10 |
| Equality Act 2010, s.20 and s.91 and Schedule 13 (duty to make reasonable adjustments, education providers) | From knowledge, not re-read | SME-1, SME-7 |
| Pre-reviews: [institution confirmations](../business-processes/pre-reviews/pre-review-institution-confirmations.md) (F-2, D-35), [BP-08-001 to 006](../business-processes/pre-reviews/pre-review-bp-08-001-006.md) (R08-9, BP-08-001 OQ-1), [adjustments D-44](../business-processes/pre-reviews/pre-review-adjustments-d-44.md) (F5, P-1) | 2026-11-20 and 2026-11-21 | All |
| Code | Branch `phase-1-security-isolation` at ad1e8b3, read 2026-11-23 | SME-1 to SME-10; files cited in each decision |
| Code | Branch `phase-1-security-isolation` at 88cd03b (BL-406 to BL-410 built), read 2026-11-23 | SME-11 to SME-15 |
| Equality Act 2010, s.20, s.91 and Schedule 13 (reasonable adjustments by education providers; the duty is anticipatory and continuing) | From knowledge, not re-read | SME-11 to SME-15 |
| EHRC, *Technical guidance on further and higher education* (published 1 April 2014), and its July 2024 note to the HE sector after *University of Bristol v Abrahart* | Publication details read 2026-11-23 (search results); text from knowledge, not re-read | SME-13, SME-14, SME-15 |
| OIA, *Good Practice Framework: Supporting disabled students*, "Providing support", paragraphs 43, 47, 48 and 50 | Page read 2026-11-23; undated, footer 2026 | SME-11, SME-12, SME-14, SME-15 |
| OfS condition B2 (resources, support and student engagement), and the QAA UK Quality Code (2024) principle on supporting students to achieve their potential | From knowledge, not re-read | SME-14, SME-15 |

## Summary

| ID | Question | Decision | Kind |
|---|---|---|---|
| SME-1 | ADR-030 item 6: refuse encrypted files and files with Office macros? | Yes to both (`AlertEncrypted yes`, `AlertOLE2Macros yes`); a production exception needs a recorded risk acceptance, checked by `check:k8s` | Product decision |
| SME-2 | ADR-030 item 8 (BL-344): who receives `DocumentMalwareDetected` and `DocumentScannerUnavailable`? | Both go to the platform operator's on-call; `DocumentMalwareDetected` also goes to the institution's security receiver, which the institution supplies | Product decision (routing); organisation fact (the receiver) |
| SME-3 | ADR-030 item 9: the ClamAV image line | The line (1.5 feature line versus 1.4 LTS) is the architect's. Operational policy: refresh the digest at least every 30 days and within 7 days of a ClamAV security release; move to a new feature line within 3 months of its release | Architecture (line); product decision (cadence) |
| SME-4 | ADR-031: who holds `identity-resolution-officer`, and the unmerge policy | Nobody by default; the institution names at least two senior registry staff, not IAM administrators. Unmerge is always allowed, governed, with no time limit; a "different people" unmerge opens a DPO breach assessment | Organisation fact (holders); product decision (policy) |
| SME-5 | ADR-031 item 9 and OQ-1/R08-9: self-service at the moment of the merge, and the two-accounts confirmation | Accepted: tokens resolve to the survivor at once. Two accounts need a recorded confirmation method, and the merged account ends with no grace period | Product decision |
| SME-6 | ADR-033: who holds `adjustment-approver`; does `wellbeing-advisor` keep `adjustment:propose`? | Nobody by default; the institution names disability-service staff with delegated authority. `wellbeing-advisor` does **not** get `adjustment:propose`; a narrow `adjustment-proposer` role is added instead | Organisation fact (holders); product decision (mapping) |
| SME-7 | ADR-033: manual proposals on by default? The manual reason codes | Off by default. Before go-live a tenant must have at least one route to record an adjustment. The four seed reason codes stand | Product decision; organisation fact (whether to turn it on) |
| SME-8 | ADR-033: the migration release reconciliation | Exact count match (already enforced), plus a required reference to the legacy report. The figures are the institution's | Organisation fact (figures); product decision (control) |
| SME-9 | D-35/BL-179: may a production tenant set `rules.builtInDefaults = 'allow'`? | No. The product refuses `allow` outside demo tenants and development or test | Product decision |
| SME-10 | D-35: default pass marks and boundaries | Shipped only as an explicit **starter rule set** an administrator applies per programme, never as a silent fallback: pass 40 (FHEQ 4 to 6) and 50 (taught level 7); UG 70/60/50/40; PGT distinction 70, merit 60. No algorithm, discretion zone, integrated-masters or Scottish values | Product decision (starter values); organisation fact (its regulations) |
| SME-11 | ADR-034: does `adjustment-approver` decide withdrawals as well as grants? | Yes. The same role decides both, holders as A-8; no separate withdrawal role | Product decision (mapping); organisation fact (holders) |
| SME-12 | ADR-034: may `wellbeing-advisor` propose withdrawals of case-less adjustments? | Yes, and the difference from SME-6 stands: a withdrawal proposal cannot bypass a case (wellbeing-case adjustments return 409), and it changes nothing without a second person | Product decision |
| SME-13 | ADR-034: does a student's own request to stop need a second person? | Yes. The approver checks that the request is the student's; a verified request is not refused on its merits. Decide within 5 working days and before the next assessment it affects | Product decision |
| SME-14 | ADR-034: end adjustments automatically on withdrawal and graduation, not on interruption or suspension? | Yes. Add prompts to re-record after a reinstatement or for another current enrolment, and to review on return from interruption | Product decision |
| SME-15 | ADR-034 / BL-412: is the student told of an early withdrawal, and what does the notice say? | Yes, for every early withdrawal (case and proposal paths) and for a refused student request; not for enrolment end. The portal holds the detail; the email says only that support has changed. Plain reason label, no clinical detail or free text, how to ask for a review | Product decision (rule); organisation fact (contact and review route) |

## SME-1: Refuse encrypted files and files with Office macros

**Question.** ADR-030 item 6 and Consequences: confirm `AlertEncrypted yes` and `AlertOLE2Macros yes`.

**Role.** Information security lead.

**Kind.** Product decision.

**Decision.** Both stay `yes` in every environment. A production overlay may set either to `no` only with an annotation on the `srs-clamav-config` ConfigMap that cites the institution's recorded risk acceptance. `check:k8s` fails a production build that turns either off without one.

**Rationale and evidence.**
- An encrypted PDF or archive cannot be scanned, so accepting it means storing content nobody has checked. That contradicts ADR-030's fail-closed position, which already refuses content that cannot be fully scanned (`AlertExceedsMax yes`).
- NCSC: "The only effective way to protect your systems against malicious macros is to disable macros", and do not rely on users clicking to enable them. Staff open uploaded evidence on institutional desktops, whose Office settings the SRS cannot see.
- Students and applicants have no legitimate need to send macros in a medical letter or a support plan.
- The refusal message already says how to fix the file (`packages/documents/src/adapter.ts`: "save a copy without them and upload it again").
- Equality Act: a refused file must not become a barrier to an adjustment or an EC claim. A student who cannot remove the password from a third-party letter needs another way to send it. That route is the institution's (checklist item A-5), and the message should point to it (BL-346).
- What `clamav.yaml` holds today matches: `infra/k8s/base/clamav.yaml` lines 35 and 36. `check:k8s` checks `AlertExceedsMax` but not these two (`scripts/check-k8s.mjs`, around line 80).
- One gap: the allow-list accepts `.doc` and `.docx` (`packages/documents/src/document-store.ts`), but not by content. Until BL-348 checks magic bytes, a macro-enabled `.docm` declared as `.docx` reaches clamd. Whether `AlertOLE2Macros` catches VBA in an OOXML container must be tested against the live image, not assumed.

**Options rejected.**
- Accept encrypted files and mark them "unscanned". This stores unscanned content, which ADR-030 forbids.
- Accept macros and rely on desktop policy. The SRS cannot verify that policy, and NCSC advises against relying on it.
- Make it a per-tenant setting. clamd is a shared cluster service, so the setting is deployment-wide.

**Configuration point.** An overlay patch of `clamd.conf`, with the risk-acceptance annotation.

**Consequences (engineering).**
- `check:k8s`: require `AlertEncrypted yes` and `AlertOLE2Macros yes` in the production overlay unless the exception annotation is present.
- A live clamd test that a password-protected PDF, a `.doc` with a macro and a `.docm` declared as `.docx` are each refused.

**Ratifiable by.** The institution's information security lead.

## SME-2: Alert receivers for document scanning

**Question.** ADR-030 item 8 and backlog BL-344: the receiver for `DocumentMalwareDetected` and `DocumentScannerUnavailable`.

**Role.** Information security lead.

**Kind.** Product decision (how alerts are routed); organisation fact (who the institution's receiver is).

**Decision.**
- `DocumentScannerUnavailable` (severity `warning`) goes to the platform operator's on-call only. It is an availability problem.
- `DocumentMalwareDetected` (severity `security`) goes to the platform operator's on-call **and** to a contact point named `srs-security`. The institution supplies the address for `srs-security` (its information security team or SOC).
- Until the institution supplies it, `srs-security` points at the platform operator's on-call. A production build in which `srs-security` has no address fails `check:k8s`.
- A detection is a security event, not a personal-data breach: the content is never stored. A `documents.rescan.infected` on a document that may already have been downloaded is handled under the [security incident runbook](../runbooks/08-security-incident.md).

**Rationale and evidence.**
- Nothing receives any alert today. `infra/k8s/base/observability.yaml` has `alertmanagers: targets: []`, and BL-370 records that the Prometheus rules can never fire. BL-344 builds the two alerts on Loki.
- The operator can act on the scanner. Only the institution can judge whether a malware upload is part of a campaign against its students or staff, so it must be told.

**Options rejected.**
- Wait for the institution before building BL-344. The alerts would have no receiver at all.
- Send `DocumentMalwareDetected` to the DPO. There is no personal-data breach, and the event carries no content.

**Safe default and checklist item.** A-3: the institution supplies the `srs-security` receiver before go-live. Until then the platform operator receives it.

**Consequences (engineering).** BL-344 builds the `srs-security` contact point with the platform on-call as its fallback address, and `check:k8s` checks that production sets an address.

**Ratifiable by.** The institution's information security lead.

## SME-3: The ClamAV image line, and its refresh cadence

**Question.** ADR-030 item 9: tracking the ClamAV 1.5 feature line by monthly digest updates, rather than the 1.4 LTS line.

**Role.** Information security lead, for the operational part only.

**Kind.** The line itself is an **architectural position**: it sets the upgrade model and support window of a cluster service. It belongs to the architecture owner, and this record does not decide it. The refresh cadence is a product decision.

**Decision (cadence).**
- Refresh the pinned digest at least every 30 days, as BL-347 states.
- Refresh within 7 days of a ClamAV release that fixes a security vulnerability.
- When a new ClamAV feature release ships, move to it within 3 months. The architect may instead move to an LTS line.
- Never let the deployed patch version fall more than 3 months behind the newest patch of its line.
- A scheduled CI check fails when the digest pin is more than 35 days old.

**Rationale.**
- ClamAV's policy: older patch versions may be blocked from signature downloads "4 months after the release of a newer patch version". A non-LTS feature release gets critical patches for at least 4 months after the next feature release.
- So a pin left alone for more than 4 months can silently stop receiving signatures. The scanner would still answer `OK` with stale signatures, which is worse than an outage. 3 months leaves a month's margin.

**Options rejected.** Refresh quarterly, which is too close to the 4-month block. Refresh only on a vulnerability, which misses the patch-blocking rule.

**Consequences (engineering).** The age check on the digest pin (with BL-347).

**Ratifiable by.** The institution's information security lead (cadence). The architecture owner decides the line.

## SME-4: Who decides identity merges, and the unmerge policy

**Question.** ADR-031 Consequences and BL-363, for the registry process owner: who holds `identity-resolution-officer` (at least two per institution), and the unmerge policy (default: always allowed, governed).

**Role.** Academic registrar (registry process owner).

**Kind.** Organisation fact (who holds the role); product decision (the unmerge policy, and what the role must not be combined with).

**Decision (role).**
- In production, nobody holds `identity-resolution-officer` until the institution assigns it. No merge can then be decided, which fails closed.
- The role is not a composite of any other role, and the product realm export assigns it to nobody. Today `infra/compose/keycloak/srs-realm.json` only defines it, and `packages/domain/src/permissions.ts` gives `identity-resolution:decide` to this role only.
- Recommended holders: at least two senior student-records (registry) staff, so that a case can be decided when one is away.
- The role should not be held by IAM or Keycloak administrators. They can change their own tokens and accounts, and a merge moves account bindings (ADR-031 item 9).
- The product does not count the role's holders. It enforces the control that matters: two different people for every case (opener, candidate adders and proposer may not decide). That check is built (BL-353).

**Decision (unmerge).**
- An unmerge is always allowed, through the governed unmerge case, with no time limit. It is refused only when the restored person has since been anonymised or disposed of, as ADR-031 item 10 says.
- The unmerge case records a reason code from a new value set `identity-unmerge-reason-code`: `different-people` (the merge joined two humans) or `merge-reversed-other`.
- `different-people` means one person's record was disclosed to another, which the ICO counts as a personal-data breach ("sending personal data to an incorrect recipient"). The unmerge decision therefore opens a DPO breach-assessment task in the same transaction. The ICO's 72-hour clock runs from when the institution becomes aware, and the ICO expects every breach to be recorded, whether reported or not.

**Options rejected.**
- A time limit on unmerge. A wrong merge found late is still wrong, and the governed case plus move records make a late reversal exact.
- Requiring the unmerge decider to differ from the merge decider. With two officers it would need a third person to reverse a mistake, which slows the breach response.
- Letting `registry-administrator` decide. ADR-031 separates preparing from deciding on purpose.

**Safe default and checklist item.** A-6: the institution names at least two holders before it enables identity merges. Until then nobody holds the role.

**Consequences (engineering).** The unmerge reason value set and the breach-assessment task (with BL-359). A demo persona holding `identity-resolution-officer`, distinct from the registry persona.

**Ratifiable by.** The registry process owner (academic registrar), and the DPO for the breach-assessment step.

## SME-5: Students' own access at the moment of a merge, and two accounts

**Question.** ADR-031 item 9 (self-service resolves to the survivor from the moment of the merge) and the two-accounts confirmation (pre-review BP-08-001 OQ-1, R08-9), for the DPO.

**Role.** Data protection officer.

**Kind.** Product decision. The institution's own lawful-basis assessment and privacy notice remain its facts (checklist A-14).

**Decision.**
- **Accepted.** From the moment of the merge, a token whose `srs_person_id` is the merged-away id resolves to the survivor, with both ids in the audit trail.
- **Two accounts.** When both people have accounts, the proposal must record how the student confirmed that both accounts are theirs, as a code from a new value set `identity-two-accounts-confirmation-code`:
  - `student-confirmed-in-person`;
  - `student-confirmed-from-both-accounts`;
  - `student-confirmed-by-verified-contact`.

  A bare `two_accounts_confirmed: true` without a method returns 422.
- **The merged person's account ends at once** (IAM `ended`, reason `merged`), with no leaver grace period. The survivor's account gives the same human access, and two live credentials should not reach one record. The institution's IAM tells the student which account to use (checklist A-7).

**Rationale.**
- After the merge, the merged person's rows have moved to the survivor (ADR-031 item 5). A token left unresolved would show the student an empty or partial record, and its writes would be refused with 409. That is worse for the student and does not protect anyone.
- The risk is a wrong merge, which discloses one person's record to another (R08-9). The controls belong on the decision: two independent people, survivor and candidate checks, identifier conflicts, the `restricted` refusal for safeguarding and identity-theft cases, and the recorded confirmation. Delaying self-service would only delay the disclosure.
- An unmerge ends the redirect at once (ADR-031 item 10), so a wrong merge stops disclosing on the next request.
- Ending the account loses a human's login. The recorded confirmation method shows the decider why that is safe.

**Options rejected.**
- Wait for IAM to rebind before self-service follows. The student is locked out of a correct record for an unknown time.
- A cooling-off period before the merge takes effect for self-service. It leaves a half-merged state, which ADR-031 rejects.
- Keep both accounts until the student signs in. Two credentials on one record, with no end date.

**Consequences (engineering).**
- The confirmation-method value set, and the 422 when it is missing (proposal and admin screen, with BL-360).
- `ended` with reason `merged` is applied with no grace period (with BL-357).

**Ratifiable by.** The institution's DPO.

## SME-6: Who approves manual adjustments, and who proposes them

**Question.** ADR-033 "To confirm": who holds `adjustment-approver`, and whether `wellbeing-advisor` keeps `adjustment:propose`.

**Role.** Head of disability services, with the academic registrar.

**Kind.** Organisation fact (who holds the role); product decision (which roles hold `adjustment:propose`).

**Decision.**
- **`adjustment-approver`:** nobody by default. Until the institution assigns it, no manual adjustment can be approved and no migration batch released, which fails closed (ADR-033 Consequences). Recommended holders: the head of the disability service, or disability advisers with delegated authority who did not prepare the proposal (pre-review P-1). Not registry staff, who are usually the proposers.
- **`wellbeing-advisor` does not get `adjustment:propose`.** This departs from the ADR-033 item 8 table, on that one row only.
- **A new role `adjustment-proposer`** holds `adjustment:propose` and nothing else. It is for disability-service administrators in a tenant that does not run the wellbeing module.
- **`adjustment:propose`** is then held by `registry-administrator` and `adjustment-proposer`.

**Rationale.**
- Where the wellbeing module runs, a wellbeing adviser has the governed case (`adjustment-case:manage`). A manual proposal would let them skip the case's assessment and panel steps, and record `external-case-system` for a case that is in fact in the module.
- Disability advisers are the people most likely to hold both `wellbeing-advisor` and `adjustment-approver`. ADR-033's test that no role holds both permissions is per role, and Keycloak can still give both roles to one person. The service check (proposer is not decider) still protects each proposal, but removing the overlap keeps the role-level separation the ADR intended.
- Without a narrow proposer role, a disability service outside the wellbeing module could only propose by being given `registry-administrator`, which is far too broad.

**Options rejected.**
- Keep `adjustment:propose` on `wellbeing-advisor`. It is a bypass of the governed case for the role that has the case.
- Remove it and add no proposer role. Only registry could enter a manual adjustment.

**Configuration point.** Role assignment in the institution's IAM. The permission mapping is code (`packages/domain/src/permissions.ts`), not tenant configuration.

**Safe default and checklist items.** A-8 (approvers) and A-9 (proposers): nobody holds either role until the institution assigns it.

**Consequences (engineering).** In BL-378: give `adjustment:propose` to `registry-administrator` and `adjustment-proposer` only; add the realm role and its `srs-role-code` value; extend the permissions test so that neither `wellbeing-advisor` nor `adjustment-approver` holds `adjustment:propose`.

**Ratifiable by.** The head of disability services and the academic registrar, through the BP-04-004 review.

## SME-7: The manual path flag, and its reason codes

**Question.** ADR-033: whether `adjustments.manual-proposals.enabled` is on by default, and the `adjustment-manual-reason-code` list.

**Role.** Head of disability services.

**Kind.** Product decision (the default and the seed list); organisation fact (whether a tenant turns it on).

**Decision.**
- **The flag is off by default**, as ADR-033 item 4 has it.
- **Before go-live, every tenant must have at least one way to record an adjustment:** either the wellbeing module is connected (its service client is registered), or the flag is on. A tenant with neither has no route at all, and the go-live readiness check fails.
- **The four seed codes stand:** `external-case-system`, `paper-record`, `prior-provider-plan`, `migration-correction`. The value set stays extensible. A tenant may add codes with the disability service lead's agreement. No code may describe a condition or a diagnosis.

**Rationale.**
- Off by default gives a tenant that runs the wellbeing module the strictest setting.
- The Equality Act duty to make reasonable adjustments is anticipatory, and an education provider must be able to put adjustments in place. A tenant with no wellbeing module and the flag off could not record one. That must be caught before go-live, not after a student is affected.
- The four codes cover the legitimate cases ADR-033 found. Each says where the decision is held, never why the student needs it (ADR-017).

**Options rejected.**
- On by default. Tenants running the wellbeing module would carry an unneeded second path.
- A fixed, non-extensible list. Institutions' disability services work in different ways.

**Configuration point.** `adjustments.manual-proposals.enabled` (feature flag); value set `adjustment-manual-reason-code`.

**Safe default and checklist item.** A-10: the institution says which route it uses before go-live. Until then the flag is off.

**Consequences (engineering).** A go-live readiness check that fails when a tenant has neither a registered wellbeing service client nor the flag on.

**Ratifiable by.** The head of disability services and the academic registrar.

## SME-8: Releasing migrated adjustments

**Question.** ADR-033: the migration release reconciliation (counts against the legacy report).

**Role.** Data migration lead.

**Kind.** Organisation fact (the counts and the legacy report); product decision (the control on release).

**Decision.**
- The release keeps ADR-033's controls: an `adjustment-approver`, `expectedCount` equal to the current rows in the batch, 409 `migration-count-mismatch` otherwise.
- The release body also requires `reconciliationReference` (1 to 100 characters, an identifier, never narrative): the reference of the legacy report the count was checked against. It is stored in the audit record with the counts.
- The cut-over plan records, for each batch, the legacy report, its count, and who released it.

**Rationale.** A count alone shows that two numbers matched, not what was compared. The reference makes the reconciliation auditable afterwards, at the cost of one field.

**Options rejected.** Re-deciding each migrated adjustment, which ADR-033 already rejects. Releasing on count alone, which leaves no trace of the evidence.

**Safe default and checklist item.** A-12: until the data migration lead supplies the figures, no batch is released, so migrated adjustments are live for late penalties and board indicators but are not sent to the VLE or exams.

**Consequences (engineering).** `reconciliationReference` in the release route and its audit row (with BL-379).

**Ratifiable by.** The data migration lead, in the cut-over plan.

## SME-9: Built-in rule defaults in production

**Question.** D-35 and BL-179: should a production tenant ever set `rules.builtInDefaults = 'allow'`? If not, should the product refuse it outside demo tenants?

**Role.** Academic registrar, with the academic quality and standards officer.

**Kind.** Product decision.

**Decision.**
- **No.** A production tenant never uses the built-in defaults.
- **The product refuses `allow` outside demo tenants:**
  - `PATCH /tenant/configuration` returns 422 when it would set `rules.builtInDefaults` to `allow` on a tenant with `demo_mode = false`;
  - the engine honours `allow` only on a demo tenant, or when `NODE_ENV` is `development` or `test`. Elsewhere it treats `allow` as `refuse` and logs a warning naming the tenant.
- `refuse` stays valid everywhere, including on a demo tenant.

**Rationale and evidence.**
- The built-in values are level-blind: pass mark 40 for every programme (`module-result-service.ts`, `#getDefaultPassMark`), undergraduate boundaries and `weighted-average` for every award (`award-service.ts` around line 478), resit cap 40 (`mark-service.ts` line 605), compensation 0 and progression credit equal to all credits (`progression-service.ts` lines 392 to 395). With `allow`, an unconfigured level 7 programme passes students at 40 (F-2).
- OfS condition B4 requires awards to be credible and assessed reliably against the provider's own regulations. A result calculated from a value the institution never chose cannot be traced to its regulations, even though D-35 records it as `built-in-default`.
- Since BL-179 an unset value already refuses (`engine.ts`, `#refusesBuiltInDefaults`), but nothing stops a tenant administrator setting `allow` through `PATCH /tenant/configuration` (`apps/api/src/routes/tenant-admin.ts`), and the only record would be the audit row.
- The tests' shared tenant sets `allow` (`apps/api/test/helpers/test-app.ts` line 71). It runs under `NODE_ENV=test`, so it keeps working.

**Options rejected.**
- Allow `allow` with conditions, for example during a parallel run. A parallel run must use the real rules, or it proves nothing; a rehearsal belongs on a demo or test tenant.
- Leave it as a tenant choice, refused by default. It is the one setting that silently produces wrong results, and the only person who would set it is someone trying to make a calculation stop failing.

**Configuration point.** None for production. `demo_mode` and `NODE_ENV` decide where `allow` is honoured.

**Consequences (engineering).** The 422 on the configuration route, the engine change and the warning, with tests for a non-demo tenant (refused), a demo tenant (allowed) and the test environment.

**Ratifiable by.** The academic registrar and the academic standards committee.

## SME-10: Default pass marks and classification boundaries

**Question.** D-35: the default pass mark, boundaries and algorithm, as far as they are a product default. The pre-review proposes pass 40 for FHEQ levels 4 to 6 and 50 for level 7, undergraduate boundaries 70/60/50/40, and postgraduate taught distinction 70 and merit 60.

**Role.** Academic registrar, with the academic quality and standards officer.

**Kind.** Product decision (the starter values); organisation fact (the institution's own regulations).

**Decision.**
- **The values are a starter rule set, never a fallback.** A tenant administrator applies it explicitly, per programme. Applying it writes ordinary versioned programme rules with a valid-from date, attributed to that administrator, so each calculation cites a `versionId` (D-35), not `built-in-default`.
- **The starter values:**

  | Programme kind | Pass mark | Classification boundaries | Resit cap |
  |---|---|---|---|
  | Undergraduate (awards at FHEQ levels 4 to 6) | 40 | first 70, upper-second 60, lower-second 50, third 40 | equal to the pass mark |
  | Postgraduate taught (level 7) | 50 | distinction 70, merit 60, pass 50 | equal to the pass mark |
- **No starter value for:**
  - the classification algorithm. Algorithm design is the institution's, against the UKSCQA principles, and OfS has found B4 breaches in algorithm changes. A programme with no algorithm rule is refused at calculation;
  - a discretion zone. None, unless the institution configures one;
  - integrated masters, which institutions classify and pass in different ways;
  - Scottish programmes (SCQF), and postgraduate research.
- The demo data applies the starter set, so a demo shows the right level 7 behaviour.

**Rationale.**
- The values are the common UK practice the pre-review proposes. The FHEQ sets levels, not marks, so they are conventions, not law.
- The resit cap equal to the pass mark addresses F-3: a cap of 40 on a programme passed at 50 makes the reassessment impossible to pass.
- Applying them explicitly means a person in the institution chose them, and the rule history shows who and when. A silent fallback shows neither.

**Options rejected.**
- Make the built-in fallback level-aware. It is still a value nobody at the institution chose, and SME-9 refuses fallbacks in production anyway.
- Ship no values. Every institution would type the same common values, with more room for error.

**Configuration point.** The starter set is optional; any programme rule can be changed afterwards through the existing academic rules routes.

**Safe default and checklist item.** A-2: until a programme's rules are configured, calculation for it is refused (422 `RuleNotConfiguredError`), and the BL-390 readiness report lists what is missing.

**Consequences (engineering).** The starter rule set (an admin action and route, per programme, with a dry-run preview), and demo data applying it.

**Ratifiable by.** The academic registrar and the academic standards committee.

## Second batch: withdrawing a core adjustment (ADR-034)

These record the five confirmations of [ADR-034](ADR-034-authority-for-withdrawing-a-core-adjustment.md) "To confirm" (backlog BL-414). Items 1 to 4 are already built as product defaults (BL-406 to BL-410), so they are decided here as built, with any additions noted. Item 5 is not built (BL-412).

**Role for the batch.** Head of disability services, with the academic registrar.

## SME-11: The approver for withdrawals

**Question.** ADR-034 "To confirm" (BL-414): whether `adjustment-approver` is the right authority for withdrawals as well as grants.

**Kind.** Product decision (which role holds `adjustment:approve-withdrawal`); organisation fact (who holds the role, already checklist A-8).

**Decision.**
- **Yes.** `adjustment-approver` decides withdrawal proposals, as it decides manual grants and migration releases. There is no separate withdrawal-approver role.
- The holders are those named under A-8: the head of the disability service, or disability advisers with delegated authority. A-8 now covers withdrawals too.
- Until the role is assigned, no manual, migrated or legacy adjustment can be withdrawn early. It stays in force until it ends naturally or the enrolment ends, which fails towards the student (ADR-034 Rationale).

**Rationale and evidence.**
- A withdrawal removes the same Equality Act entitlement a grant creates (s.20, s.91, Schedule 13). The judgement is the same one, in reverse: does this student still need this adjustment? It belongs with the same people.
- The OIA Good Practice Framework ("Providing support", paragraph 47) expects a record of the reasons for each adjustment decision and whose advice was obtained. A disability-service approver can give those reasons; registry staff, who usually propose, cannot.
- Built: `packages/domain/src/permissions.ts` line 87 gives `adjustment:approve-withdrawal` to `adjustment-approver` only. The decision route checks that the decider is neither the proposer nor the subject (`apps/api/src/platform/adjustments/adjustment-withdrawal-service.ts`; matrix in `apps/api/test/adjustment-withdrawal-authority.int.test.ts`, BL-410).

**Options rejected.**
- Registry decides withdrawals. Registry has no disability expertise, and it proposes them.
- A separate `adjustment-withdrawal-approver` role. It adds administration and no control. An institution that wants different people can give the role to fewer of them; the split can be added later if one asks.
- One approver for grants and the wellbeing panel for withdrawals of case-less adjustments. There is no case for the panel to decide.

**Configuration point.** Role assignment in the institution's IAM. The mapping is code, not tenant configuration.

**Safe default and checklist item.** A-8 (extended): nobody holds `adjustment-approver` until the institution assigns it.

**Consequences (engineering).** None. Built.

**Ratifiable by.** The head of disability services and the academic registrar.

## SME-12: Wellbeing advisers proposing withdrawals of case-less adjustments

**Question.** ADR-034 "To confirm": whether `wellbeing-advisor` may propose withdrawals of adjustments that have no wellbeing case (provenance `manual-approved`, `migrated` or `legacy-direct`). This differs from SME-6, which keeps `adjustment:propose` (grants) off `wellbeing-advisor`.

**Kind.** Product decision.

**Decision.**
- **Yes, as built.** `adjustment:propose-withdrawal` stays with `registry-administrator`, `adjustment-proposer` and `wellbeing-advisor` (`permissions.ts` line 86).
- **The difference from SME-6 stands.**

**Rationale.**
- SME-6 removed grant proposals from advisers because a manual grant would let them skip the governed case they already have. A withdrawal proposal cannot do that. Against a wellbeing-case adjustment it returns 409 `withdrawal-through-case` (ADR-034 item 1, tested in BL-410), and the case remains the only early way out.
- A case-less adjustment has no case to bypass. The adviser is usually the person who learns it is no longer needed, for example at an annual review (OIA paragraph 48: "keep adjustments under review"). Without this permission the adviser would have to ask registry to propose, which adds a step and moves the proposal to someone with no disability knowledge.
- A proposal changes nothing on its own: no version, no distribution change and no event until an approver decides (ADR-034 item 5). The harm SME-6 guarded against is a one-person route; there is none here.
- The overlap SME-6 worried about (one person holding both `wellbeing-advisor` and `adjustment-approver`) is covered by the service check: the proposer cannot decide their own proposal. No role holds both withdrawal permissions (`apps/api/test/architecture/adjustment-permissions.test.ts`).

**Options rejected.**
- Apply SME-6 here too and remove the permission from advisers. The bypass it prevents does not exist on this path, and the cost is a slower, less informed proposal.
- Let advisers propose withdrawals only of migrated adjustments. Manual and legacy-direct adjustments have the same lack of a case.

**Configuration point.** Role assignment. The mapping is code.

**Consequences (engineering).** None. Built.

**Ratifiable by.** The head of disability services and the academic registrar.

## SME-13: A student's own request to stop

**Question.** ADR-034 item 2 and "To confirm": whether a student's request to stop an adjustment needs a second person.

**Kind.** Product decision.

**Decision.**
- **Yes, as built.** Staff propose with reason `student-request` and an `externalReference` to the student's written request; an `adjustment-approver` decides. When BL-413 lets the student propose from the portal, an approver still decides.
- **The approver's question is narrower than for other reasons.** It is whether the request is genuinely the student's, and whether the student understands what stops (for example, extra time in the next exam). A disabled student may decline an adjustment. A verified request is not refused because the approver thinks the student still needs it; the approver may instead offer a conversation, and the student may ask again at any time.
- **A refusal of a `student-request` proposal is for an unverified request only,** and the decision reason says so in plain words. The student is told (SME-15).
- **Decide within 5 working days, and before the next assessment the adjustment applies to.** While the request waits, the adjustment stays in force; the student may simply not use it, but a separate room or a scheduled arrangement is not imposed against their stated wish if it can be undone in time.

**Rationale and evidence.**
- A staff-recorded "the student asked" is one person's unverified claim, and a false one removes an entitlement before an exam (ADR-034 item 2). A second person costs a short delay.
- The duty to make adjustments exists for the student's benefit; it does not oblige a student to accept one. So the second person checks the request, not its wisdom. Disability services already confirm a decline with the student before acting (sector practice).
- The time limit matters because the wait is the one cost of the control. Without it a student who asked to stop could find the arrangement still scheduled at their next exam.

**Options rejected.**
- One person, with the reason and the reference recorded (ADR-034 option (c)). Audit after the event does not stop a false claim.
- No second person for the portal route, since the student authenticated. A compromised account removes the entitlement, and the approver also checks the student understands the effect. The cost is the same short delay.
- Let the approver refuse a verified request on its merits. That overrides the student's own choice.

**Configuration point.** None today. The 5 working days should become a due date on the `decide-withdrawal` task for `student-request` proposals, overdue in the approver worklist (BL-417). A tenant setting for the number of days is not needed yet.

**Consequences (engineering).** BL-417: the due date and the worklist flag; approver guidance on the decision screen (with BL-411).

**Ratifiable by.** The head of disability services and the academic registrar.

## SME-14: Automatic end on withdrawal and graduation only

**Question.** ADR-034 item 7 and "To confirm": whether adjustments end automatically when the enrolment ends by withdrawal or graduation, but not on interruption or suspension.

**Kind.** Product decision.

**Decision.**
- **Yes, as built.** The sweep ends current adjustments whose enrolment's current version is `withdrawn` or `graduated` and already in effect (`adjustment-withdrawal-service.ts`, `withdrawForEndedEnrolments`, around line 189), in the worker loop and after the transition. A future-dated end waits. Statuses `intermitting` and `suspended` do not end adjustments (`apps/api/src/platform/enrolment/service.ts`, `ALLOWED_TRANSITIONS` line 150: both may return to `enrolled`).
- **Two additions, so that the automatic end does not become a gap later:**
  - when an enrolment is reinstated or corrected after a withdrawal, or when a student whose adjustments ended with `enrolment-ended` has another current enrolment, the disability service gets a task listing those adjustments, so it can re-record them through their authority before the next assessment;
  - when a student returns from interruption or suspension, the disability service gets a task to review the student's current adjustments with them.

**Rationale and evidence.**
- Withdrawal and graduation are terminal (`ALLOWED_TRANSITIONS`), and each follows a governed decision taken by someone other than the opener, or award conferral. Ending adjustments by hand for thousands of leavers would invite rubber-stamping (ADR-034 Options).
- Interruption and suspension expect a return. Ending adjustments then would make the student's return depend on re-recording each one, which is a barrier the anticipatory duty asks providers to avoid. The OIA (paragraph 48) says it is not good practice to make students reapply for the same adjustments without reason.
- A return is still the moment to check the arrangements are right (OIA paragraphs 48 and 50), hence a review task, not an automatic change.
- ADR-034 Consequences records that a reinstated enrolment does not restore adjustments. Without a prompt, a student reinstated on appeal could sit a reassessment without the time they are owed; the task closes that gap without making the restore automatic, which would bypass the authority for a grant.

**Options rejected.**
- End adjustments on suspension, since the student is not studying. The student returns, and a suspension is often itself disputed.
- Restore ended adjustments automatically on reinstatement. It writes a grant with no authority, against ADR-033.
- Make the ending statuses a tenant setting. The statuses are product codes with fixed meanings; no institution is known to need a difference.

**Configuration point.** None. The status list is code.

**Consequences (engineering).** BL-418: the re-recording and review tasks.

**Ratifiable by.** The head of disability services and the academic registrar.

## SME-15: Telling the student when an adjustment is withdrawn early

**Question.** ADR-034 "To confirm" and BL-412: whether the student must be told when an adjustment is withdrawn early, and what the notice says.

**Kind.** Product decision (that a notice is sent, and its content rule); organisation fact (the disability service's contact and review route).

**Decision.**
- **A notice is always sent** when an adjustment is withdrawn early by the case path (`wellbeing-case`) or the proposal path (`approved-withdrawal`), including at the student's own request (it confirms the request was acted on). It is also sent when a `student-request` proposal is refused (SME-13).
- **No notice for `enrolment-ended`.** The student has already been told of the withdrawal or award, and each adjustment ends with the student's studies. The institution's withdrawal letter may say that support arrangements end (checklist A-15).
- **No notice for a natural end at `valid_to`.** The end date is already shown in the portal.
- **Core sends it, once.** It is sent after the withdrawal commits, from core, for both early paths. The wellbeing module (BL-240) tells the student about its review outcome but does not send a second notice about the entitlement ending.
- **Not a tenant option.** There is no flag to turn it off. The tenant may edit the wording of the template, within the content rule.
- **Content rule.**
  - The **portal notification** holds the detail: the adjustment's type label (for example "extra time in examinations"), the date it ended, and the plain label of the reason from `adjustment-withdrawal-reason-code` (for example "A review found it is no longer needed"). For `superseded`, it names the type of the replacement. It says that assessments already taken are not affected.
  - The **email** says only that there is a change to the student's support arrangements and asks them to sign in to the portal. An email can reach a shared or forwarded mailbox, and an adjustment's type can itself reveal a disability.
  - **Never included:** a condition, diagnosis or any clinical detail; evidence; case notes; the approver's free-text `decision_reason`; the `externalReference`; the names of the proposer or approver.
  - **How to ask for a review:** contact the disability service (the institution's contact, A-15), and the institution's complaints procedure if that does not resolve it. It asks the student to get in touch before their next assessment if they think the change is wrong.
  - For a refused `student-request`: the adjustment is still in place, the institution could not confirm the request was the student's, and how to contact the disability service.

**Rationale and evidence.**
- A student whose extra time is removed without being told finds out in the exam hall. That is the harm the whole ADR guards against, and the anticipatory duty is not met by a record the student never sees.
- The OIA expects decisions and their reasons to be recorded and discussed with the student (paragraphs 47 and 50), and good practice is to explain when a recommended adjustment is not provided. A plain reason and a review route give the student what they need to challenge a mistake in time.
- Minimum necessary (ADR-017): targets learn nothing new from a withdrawal, and the notice follows the same rule. The reason label is coded and already non-clinical (ADR-034 item 9); free text is excluded because it is the one place clinical detail could enter.
- Leavers: a notice per adjustment after withdrawal or graduation adds nothing the student needs, and goes to an address that may no longer be monitored.
- Built ground: the communications dispatch log and tenant-editable templates exist (`apps/api/src/routes/communications.ts`, `/communication-templates`), and `apps/api/src/platform/adjustments/task-notices.ts` already sends adjustment notices through them with counts and a link only. `NotificationService.deliver` (`apps/api/src/platform/notifications/notification-service.ts`) gives the portal notification.

**Options rejected.**
- No notice, leaving it to the disability service. Nothing then guarantees it, and the proposal path has no case to send from.
- Full detail in the email. An email is the wrong channel for disability information.
- A notice on enrolment end. Noise to a leaver, about something already implied by the outcome they were sent.
- A tenant flag to turn the notice off. The notice is the student's protection against a mistaken withdrawal.

**Configuration point.** The template wording (tenant-editable, within the content rule) and the disability service contact (A-15).

**Safe default and checklist item.** A-15: until the institution supplies its contact and review route, the notice names "your disability service" and "the complaints procedure in your student handbook", and is still sent.

**Consequences (engineering).** BL-412 (detail updated with this rule): the notice on both early paths and on a refused student request, the portal and email templates, and a test that the rendered notice contains no free text, reference or clinical field. BL-240: no second notice from the wellbeing side.

**Ratifiable by.** The head of disability services and the academic registrar.

## Effect on the ADRs

- **ADR-030, ADR-031 and ADR-033:** their status lines record that the policy confirmations were decided here. Their engineering decisions are unchanged.
- **One permission row departs from ADR-033 item 8:** `adjustment:propose` is not given to `wellbeing-advisor`, and a new role `adjustment-proposer` holds it (SME-6). The architect may fold this into the ADR when BL-378 is built.
- **ADR-030 item 9:** the image line remains for the architecture owner (SME-3).
- **ADR-034:** its status line records that its confirmations were decided here (SME-11 to SME-15). Items 1 to 9 stand as built. SME-14 and SME-15 add work (BL-417, BL-418, BL-412) but change no engineering decision.

## Not decided here

- **The ClamAV image line** (SME-3). It is an architectural position, for the architecture owner.
- **Each institution's facts:** who holds the roles, its security receiver, its regulations and values, whether it turns on the manual path, its migration figures, its lawful basis and privacy notice. These are in the [adoption checklist](../product/institution-adoption-checklist.md).
- **Nothing in either batch needs a professional's judgement on an individual case.** A DPO still decides each breach assessment that SME-4 opens, and an `adjustment-approver` still decides each withdrawal (SME-11, SME-13).

## Reversibility

All cheap. Each is a default, a permission row, a value set, a template rule or a guard. SME-9 can be relaxed by removing the refusal, though no reason to do so is known.
