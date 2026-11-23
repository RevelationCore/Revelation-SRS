# SME Delegate Decisions, 2026-11-23

> Status: Decided (2026-11-23); open to ratification
> Date: 2026-11-23
> Context: the policy confirmations still pending on [ADR-030](ADR-030-malware-scanning-of-uploaded-documents.md), [ADR-031](ADR-031-governed-identity-merge-and-propagation.md) (backlog BL-363) and [ADR-033](ADR-033-authority-for-recording-a-core-adjustment.md), and the built-in rule defaults of [Phase 5 D-35](phase-5-gap-closure-decisions.md#d-35-every-calculation-records-the-rule-versions-it-used) (backlog BL-179, pre-review [F-2 and D-35](../business-processes/pre-reviews/pre-review-institution-confirmations.md))
> Made by: the AI SME delegate (`~/.claude/agents/sme-decision-maker.md`), under the product owner's delegation. No named person has approved, signed off or confirmed anything in this record. Each decision names the role that may ratify or overturn it.
> Numbering: SME-1 to SME-10. It does not continue the D-numbers of the gap-closure records.

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
| Code | Branch `phase-1-security-isolation` at ad1e8b3, read 2026-11-23 | All; files cited in each decision |

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

## Effect on the ADRs

- **ADR-030, ADR-031 and ADR-033:** their status lines record that the policy confirmations were decided here. Their engineering decisions are unchanged.
- **One permission row departs from ADR-033 item 8:** `adjustment:propose` is not given to `wellbeing-advisor`, and a new role `adjustment-proposer` holds it (SME-6). The architect may fold this into the ADR when BL-378 is built.
- **ADR-030 item 9:** the image line remains for the architecture owner (SME-3).

## Not decided here

- **The ClamAV image line** (SME-3). It is an architectural position, for the architecture owner.
- **Each institution's facts:** who holds the roles, its security receiver, its regulations and values, whether it turns on the manual path, its migration figures, its lawful basis and privacy notice. These are in the [adoption checklist](../product/institution-adoption-checklist.md).
- **Nothing in this batch needs a professional's judgement on an individual case.** A DPO still decides each breach assessment that SME-4 opens.

## Reversibility

All cheap. Each is a default, a permission row, a value set or a guard. SME-9 can be relaxed by removing the refusal, though no reason to do so is known.
