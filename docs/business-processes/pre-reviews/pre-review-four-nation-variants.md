# Pre-review: four-nation, provider-type and mode variants (BL-157)

> Date: 2026-11-21
> Items reviewed: OQ-2, "Which national, provider-type and mode variants require configuration?", on the 44 process pages owned by "Four-nation SME" (BP-01-001 to BP-01-007, BP-04-001 to BP-04-006, BP-05-001 to BP-05-011, BP-06-001 to BP-06-006, BP-07-001 to BP-07-008, BP-08-001 to BP-08-006). Backlog item BL-157.
> Roles taken: UK four-nation higher education policy reviewer (England/OfS, Scotland/SFC, Wales/Medr, Northern Ireland/DfE), with a statutory data returns view (HESA, student finance bodies).
> Status: **AI pre-review.** It is not the Four-nation SME's sign-off and approves nothing. Every proposed answer needs the named person below to accept it.

## What was checked

- The "National and institutional variations" and "Applicability" sections of all 44 pages. The text is the same on every page in a domain (one paragraph per nation, per domain), so the pages give little process-specific variant detail.
- What the code makes configurable:
  - tenant configuration (`packages/db/src/schema/tenant.ts` and every reader of `tenants.configuration` in `apps/api/src`);
  - value sets and whether institutions can extend them (`packages/db/migrations/0000_baseline.sql`, `apps/api/src/platform/value-sets/service.ts`);
  - the rules engine (`apps/api/src/platform/rules-engine/engine.ts`);
  - the regulator-neutral collection model (`packages/db/src/schema/regulatory.ts`, `apps/api/src/platform/regulatory/*.ts`);
  - the catalogue schema (`packages/db/src/schema/catalogue.ts`);
  - globalisation and locales (`packages/db/src/schema/globalisation.ts`).
- The capability record for regulatory exchanges ([current capabilities](../../product/current-capabilities.md)) and the backlog ([backlog](../../product/backlog.csv), BL-070, BL-121, BL-157).

## Sources consulted

| Source | Version or date read | Used for |
|---|---|---|
| Medr, *Regulatory framework for tertiary providers* (Medr/2026/13) and news item "Wales' first register of higher education providers comes into force" — medr.cymru | March 2026 publication; register in force 1 August 2026, some conditions from August 2027 | Wales regulatory position |
| The Welsh Language Standards (No. 6) Regulations 2017 (SI 2017/90), legislation.gov.uk | Text up to date to 5 February 2026 | Welsh-language duties on Welsh universities |
| DfE, *Franchise arrangements for higher education providers* (gov.uk) and OfS pages on subcontracting and validating HE | Read 2026-11-21; registration threshold of 300 franchised students in 2025-26, designation from 2028-29 | Partnership and franchise variants |
| OfS conditions of registration (B3, E-series, the new subcontracting oversight condition) | As described on officeforstudents.org.uk, read 2026-11-21 | England-only features |
| HESA Student Record and Data Futures coding (national field views; the platform's own `hesa-mode-of-study` set, labelled "HESA Student Record 2024-25") | 2024-25 coding as held in the repository; the current Data Futures specification was not available | HESA mapping |
| Equality Act 2010 (extent: Great Britain); Disability Discrimination Act 1995 and the Special Educational Needs and Disability (NI) Order 2005 (Northern Ireland) | Statutory extent, from the reviewer's knowledge | Equality law variant for Northern Ireland |
| Public Records (Scotland) Act 2011; FOI (Scotland) Act 2002 | Statutory position, from the reviewer's knowledge | Scottish records and FOI |

The SFC, Medr and DfE-NI field specifications, the SAAS provider guidance, and the current ILR, FES, LLWR and CSR specifications were **not** read. Answers that depend on them have medium or low confidence.

## Summary

The platform is built for one English university. Most institutional policy differences can be configured (value sets, programme rules, workflows, retention schedules, the working-day calendar). But the code has **no tenant setting for nation, regulator or provider type**. The only nation-aware setting is `calendar.division`. Four structural variants are code, not configuration:

- Scottish and Welsh credit levels (SCQF, CQFW);
- the weighting used to classify honours degrees;
- apprenticeships;
- franchise and delivery-partner provision.

The HESA mode crosswalk contradicts the platform's own HESA value set. Northern Ireland's disability law is not the Equality Act.

**Findings:** 0 Blocker, 9 Major, 6 Minor, 4 Observation. **OQ-2:** 21 proposed for closing (on the Four-nation SME's acceptance), 23 to stay open.

## What the code makes configurable (evidence)

| Ref | Fact | Evidence | Configuration or code |
|---|---|---|---|
| E-01 | A tenant has one free-form `configuration` jsonb. The keys the API reads are `rules.builtInDefaults`, `registrationTermsVersion`, `registration.financialHoldBlocks`, `financialRegistration.slcCountsAsArranged`, `rightToStudy.*` and `calendar.division`. There is no nation, regulator or provider-type key. | `packages/db/src/schema/tenant.ts`; `rules-engine/engine.ts:280`; `registration-periods/service.ts:310`; `registration/financial-registration-service.ts:249`; `registration/right-to-study-service.ts:283`; `calendar/working-days.ts:15` | Code to add |
| E-02 | Bank-holiday division `england-and-wales` / `scotland` / `northern-ireland`, used by every statutory deadline | `apps/api/src/platform/calendar/working-days.ts:7-17` | Configuration |
| E-03 | `regulator-code` is extensible: HESA, OFS, SFC, MEDR, DFE-NI. The SFC, Medr and DfE-NI collections are generic, with no field specifications (BL-070). | `0000_baseline.sql:8627-8641`; `regulatory-collection-service.ts:22-26` | Configuration for the codes; code for the specifications |
| E-04 | `mode-of-study-code` is **not extensible**: full-time, part-time, distance, sandwich. It has no apprenticeship value. | `0000_baseline.sql:260, 482-492` | Code |
| E-05 | `fheq-level` is **not extensible** (levels 4 to 8). `programme.fheq_level` and `module.fheq_level` are smallint columns. | `0000_baseline.sql:262, 384-396`; `catalogue.ts` (`fheqLevel`) | Code |
| E-06 | The extensible sets institutions can add to are `credit-framework-code` (cats, ects, institutional), `award-classification-code`, `fee-status-code` (home, overseas, islands, not-assessed), `funding-source-code` (slc, …), `qualification-type-code` (a-level, btec-extended-diploma, ib-diploma), `application-channel-code`, `delivery-mode-code` and `adjustment-type-code`. | `0000_baseline.sql:13252, 13379, 14293, 14308-14309, 261` | Configuration |
| E-07 | Institutions can only add values to extensible sets, relabel values and hide values. They cannot create a value set. Offer-condition matching needs a `grade-scale-*` set, and only `grade-scale-a-level` exists. | `value-sets/service.ts:474-552`; `admissions/application-service.ts:548-554`; `0000_baseline.sql:13380-13403` | Code (a platform migration for each grade scale) |
| E-08 | Rule types are a fixed TypeScript union of 21 types | `rules-engine/engine.ts:7-28` | Configuration for the values; code for any new rule type |
| E-09 | Only two classification algorithms, `weighted-average` and `best-of-two-years`. The second actually takes the best 50% of credit, not the best two years. Neither weights by level or year. | `progression/award-service.ts:477-520` | Code |
| E-10 | HESA `mapMode` maps part-time to `'02'` and distance to `'03'`, but the platform's own `hesa-mode-of-study` set has `31` = part-time and `63` = flexible/distance. The fields use legacy Student Record names: `SBJCA` is taken from `owning_school`, and `YEARPRG` is hard-coded to 1. | `regulatory/hesa-service.ts:829-848, 956-964`; `0000_baseline.sql:322-333` | Code (a defect) |
| E-11 | One student finance exchange, SLC. There is no SAAS. | `regulatory/slc-service.ts`; no "saas" anywhere in `apps/api/src` or the migrations | Code |
| E-12 | Partnership is modelled only as `awarding_body` and `programme.awarding_body_id`. There is no teaching or delivery partner on a programme, enrolment or offering. | `packages/db/src/schema/catalogue.ts:12-43` | Code |
| E-13 | Welsh: a `cy-GB` locale pack, Welsh translations of value-set labels, and `person.communication_locale_code`. Neither app offers a language choice yet (current capabilities). `EngagementCasePage` offers `cy`, not `cy-GB`. | `globalisation.ts`; `identity.ts:52`; `apps/admin/src/pages/EngagementCasePage.tsx:88` | Partly built; the rest is code |
| E-14 | Retention schedules are tenant rows, set per entity type, period and trigger | `packages/db/src/schema/rights.ts:79-102` | Configuration |
| E-15 | The contextual-admissions fields are `polar4Quintile` and `imdDecile`, with no field saying which nation's deprivation index the decile comes from | `regulatory.ts:225-236` | Code |
| E-16 | The FOI deadline is 20 working days on the tenant's division calendar. This fits both FOIA 2000 and FOISA 2002. | `regulatory/foi-service.ts:75` | Configuration |

## Findings

| ID | Severity | What is wrong | Evidence | What to change |
|---|---|---|---|---|
| F-01 | Major | No tenant nation, regulator or provider-type setting. Every "must be configurable" nation statement on the 44 pages has nothing in the code to switch it. | E-01 | Add `jurisdiction.nation`, `jurisdiction.regulators[]` and `providerType` (and `degreeAwardingPowers`) to the tenant configuration. Use them to gate regulator features and default value sets. |
| F-02 | Major | Levels are fixed to FHEQ 4 to 8, so SCQF 7 to 12 cannot be held. SCQF 9 (ordinary) and SCQF 10 (honours) both map to FHEQ 6, so they cannot be told apart. CQFW cannot be stated either. | E-05 | Store levels as framework plus level (FHEQ, SCQF, CQFW, and the RQF/CQFW crosswalk for NI). Rename `fheq_level` or add alongside it, with a crosswalk. |
| F-03 | Major | Classification cannot express common English level weightings (for example level 5 : level 6 at 1:2 or 1:3), nor Scottish honours computed only on the honours years. `best-of-two-years` is mislabelled. | E-09 | Add configurable level and year weights, credit inclusion rules and discounting. Rename or fix `best-of-two-years`. |
| F-04 | Major | No apprenticeship model: no mode value, employer, standard, end-point assessment, or off-the-job training evidence. Degree apprenticeships are a main HE mode in England (ILR return), Scotland (Graduate Apprenticeships) and Wales (Medr degree apprenticeships). `mode-of-study-code` is not extensible, and it conflates location (distance) with mode. | E-04 | Treat apprenticeships as a scoped feature (code). Split mode from study location. Make mode extensible or add a regulator crosswalk. |
| F-05 | Major | The HESA mode crosswalk is wrong against the platform's own set (part-time `02` against `31`; `03` is not a code). Several fields are placeholders. The model is legacy Student Record, not Data Futures. | E-10 | Drive HESA codes from a value-set crosswalk. Add a contract test that every emitted code is a member of the HESA set. Fold into BL-121 or BL-070. |
| F-06 | Major | Student finance is SLC only. Scottish-domiciled students are funded by SAAS, which needs its own attendance and registration confirmation, both for Scottish providers and for English, Welsh and NI providers with SAAS students. `funding-source-code` cannot tell SFE, SFW, SFNI and SAAS apart without configuration. | E-11, E-06 | Configuration: add funding-source values. Code: a SAAS exchange (delivery-ledger flow first, as for the other untracked systems). |
| F-07 | Major | There is no delivery-partner or franchise model. The OfS subcontracting oversight condition and DfE's requirement that large franchise partners register (over 300 franchised students in 2025-26; designation from 2028-29) need partner-level student data. So does HESA's collaborative provision reporting. | E-12; DfE franchise guidance | Add a teaching or delivery partner (and a partnership-arrangement type) to programme, offering and enrolment. This is code. |
| F-08 | Major | Northern Ireland disability law differs. The Equality Act 2010 extends to Great Britain only. NI uses the DDA 1995 and SENDO 2005, with the Equality Commission NI. The pages' "Equality Act" framing of reasonable adjustments (BP-04-004) is wrong for NI tenants. | Statutory extent | Make the legal-basis wording and statement text depend on the nation (configuration, once F-01 exists). Correct the process pages. |
| F-09 | Major | FE colleges with HE return different datasets: ILR in England, FES in Scotland, LLWR in Wales and the Consolidated Student Record in NI, instead of, or as well as, HESA. Nothing supports them. Confidence: medium. | E-03 | Decide the provider-type scope (see the open questions). If in scope, these returns are code. |
| F-10 | Minor | Applicant qualification types can be configured (Highers, Advanced Highers, Welsh Baccalaureate, Irish Leaving Certificate, Scottish Baccalaureate), but grade scales cannot (E-07), so a Higher A to D condition cannot be matched. | E-06, E-07 | Ship platform grade-scale sets for the main UK and Irish qualifications, or let institutions create grade-scale sets. |
| F-11 | Minor | Contextual admissions are England-centric. `imdDecile` has no index identifier (IMD, SIMD, WIMD, NIMDM), and POLAR is not used in Scotland, which uses SIMD20/40 for widening access. | E-15 | Add an index code to the deprivation measure. Add SIMD and WIMD. This is code. |
| F-12 | Minor | Welsh-language service is not complete for Welsh tenants. There is a locale pack and labels, but no language choice in either app, no rule that correspondence goes in the recorded language, and a `cy`/`cy-GB` mismatch. Welsh universities are bound by the Welsh Language Standards (No. 6) Regulations 2017. | E-13 | Make this code for Welsh tenants: a language switcher, bilingual or preferred-language correspondence, and bilingual award documents (BP-06-004). |
| F-13 | Minor | OfS features (OfS page, B3 extracts) appear to every tenant. A Scottish, Welsh or NI tenant should not see them. | `apps/admin/src/components/Layout.tsx` Regulatory section | Gate them on F-01 (configuration once F-01 exists). |
| F-14 | Minor | Ombudsman routing is not modelled. The OIA covers England and Wales; Scotland uses the SPSO and NI the NIPSO. It affects completion-of-procedures for BP-05-006 and BP-05-011. | No ombudsman references in `apps/api/src` | Make it a tenant setting plus letter template (configuration once F-01 exists). |
| F-15 | Minor | Scottish progression decisions (leave with an ordinary degree, or go on to honours at the end of year 3) need decision values. `decision-code` is not extensible. | `0000_baseline.sql` (`decision-code`, `is_extensible` false) | Add the values in a platform migration, or make the set extensible. |
| F-16 | Observation | The page variant text is the same for every process in a domain. BP-01-005 (CAS) carries admissions-qualification text. BP-07-003 (sponsor) carries SFC/SAAS text, but immigration is reserved and the same across the UK. | Variation sections of the 44 pages | Rewrite each page's variations section from the table below. |
| F-17 | Observation | Medr's new regulatory system and Register took effect on 1 August 2026, with conditions phased in to August 2027. The Wales text on the pages predates it. | Medr/2026/13 | Review Medr's conditions for data and reporting duties, under BL-121. |
| F-18 | Observation | Some variants already work as configuration: the bank-holiday division (Wales correctly shares England-and-Wales), FOI deadlines for both FOIA and FOISA, tenant retention schedules (which can hold a Public Records (Scotland) Act 2011 records-management plan schedule), the UKVI attendance threshold rule, fee-status values (add `ruk` for Scottish and NI providers), and award classification values (ordinary, unclassified). | E-02, E-06, E-14, E-16 | None. Record these as configuration in the pages. |
| F-19 | Observation | Data protection is UK-wide (UK GDPR, DPA 2018, Data (Use and Access) Act 2025), so the BP-08 processes have no nation-specific data rules. A Welsh-language communication preference is the only nation-dependent behaviour there. | — | None |

## Answer to OQ-2, by process

Key:
- **Config** = can be set today, or once F-01 exists, without new code.
- **Code** = needs new code or schema.
- "Propose close" means the answer is ready for the Four-nation SME to accept.
- "Stay open" means a named specialist must confirm it.

| BP | Variants that need configuration | Which are code changes, not configuration | Confidence | OQ-2 |
|---|---|---|---|---|
| [BP-01-001](../01-recruitment-and-admissions/bp-01-001-receive-an-application.md) | Channels (UCAS, direct, agent, partner); qualification types (Highers, Welsh Bacc, Irish LC); Welsh communication locale | Tenant nation (F-01); grade scales (F-10); partner-routed applications (F-07) | Medium | Stay open |
| [BP-01-002](../01-recruitment-and-admissions/bp-01-002-assess-an-application.md) | Assessment types; contextual-offer policy per tenant | Deprivation index by nation (F-11); grade scales (F-10) | Medium | Stay open |
| [BP-01-003](../01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md) | Offer and condition types; fee-status basis (add `ruk`); mode on the offer | Grade-scale matching (F-10); apprenticeship offers that need an employer (F-04) | Medium | Stay open |
| [BP-01-004](../01-recruitment-and-admissions/bp-01-004-confirm-offer-conditions.md) | Results-day windows (Scottish results in early August; A level in mid-August) as calendar and period settings | Scottish and Irish grade scales (F-10); results feeds for direct, non-UCAS applicants (not built) | Medium | Stay open |
| [BP-01-005](../01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md) | None by nation (immigration is reserved). Eligibility check types; rules for part-time and below-degree-level courses as sponsor policy | Part-time Student-route eligibility (PG only) is not enforced in code; franchise-taught sponsored students (F-07) | High (nation); Medium (mode) | Propose close (nation: none) |
| [BP-01-006](../01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md) | Clearing windows and authority (UCAS is UK-wide; Scottish timing differs) | None found | Medium | Propose close |
| [BP-01-007](../01-recruitment-and-admissions/bp-01-007-convert-an-accepted-applicant-to-a-prospective-student-record.md) | Mode, fee status, funding source (add SAAS, SFW, SFNI) | SCQF and CQFW level on the programme (F-02); apprenticeship (F-04); delivery partner (F-07) | Medium | Stay open |
| [BP-04-001](../04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) | Engagement policies; UKVI attendance threshold rule; capture methods | Off-the-job training evidence for apprentices (F-04); SAAS attendance confirmation (F-06) | Medium | Stay open |
| [BP-04-002](../04-learning-engagement-and-support/bp-04-002-investigate-and-respond-to-non-engagement.md) | Thresholds, referral targets, contact channels; Welsh correspondence | Correspondence in the recorded language for Welsh tenants (F-12) | Medium | Stay open |
| [BP-04-003](../04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) | Milestone and review types; funder conditions | None by nation | High | Propose close |
| [BP-04-004](../04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) | Adjustment types; DSA bodies (SFE, SFW, SFNI through SLC; SAAS for Scotland) as values; legal basis text by nation | None, once F-01 exists, apart from correcting the NI legal basis (F-08) | High | Propose close (with F-08 recorded) |
| [BP-04-005](../04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md) | EC policy, deadlines on the division calendar, decision authority (ADR-028) | None | High | Propose close |
| [BP-04-006](../04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md) | Distribution targets and visibility scopes | None | High | Propose close |
| [BP-05-001](../05-assessment-and-results/bp-05-001-establish-assessment-structures.md) | Component types; credit framework (add SCQF credit as a value); pass marks | SCQF and CQFW levels (F-02); any grading scale that is not a percentage (for example 22-point schemes) | Medium | Stay open |
| [BP-05-002](../05-assessment-and-results/bp-05-002-create-examination-entries-and-accommodations.md) | Accommodations, exam timings | None | High | Propose close |
| [BP-05-003](../05-assessment-and-results/bp-05-003-receive-or-enter-marks.md) | Late-penalty rules, mark statuses | Grading scales that are not percentages (as BP-05-001) | Medium | Stay open |
| [BP-05-004](../05-assessment-and-results/bp-05-004-moderate-and-confirm-marks.md) | Sampling reasons and policy (QAA Quality Code is UK-wide) | None | High | Propose close |
| [BP-05-005](../05-assessment-and-results/bp-05-005-determine-a-module-result.md) | Pass mark, compensation and condonement rules per programme | Rules that depend on level under SCQF (F-02) | Medium | Stay open |
| [BP-05-006](../05-assessment-and-results/bp-05-006-investigate-academic-misconduct.md) | Penalty codes, policy; ombudsman named on outcome letters | Ombudsman routing by nation (F-14, configuration once F-01 exists) | Medium | Stay open |
| [BP-05-007](../05-assessment-and-results/bp-05-007-prepare-an-exam-board-and-data-pack.md) | Board types, membership, quorum | None | High | Propose close |
| [BP-05-008](../05-assessment-and-results/bp-05-008-complete-external-examiner-review.md) | Examiner roles and reports (UK-wide practice) | None | High | Propose close |
| [BP-05-009](../05-assessment-and-results/bp-05-009-ratify-and-publish-results.md) | Publication rules; Welsh-language publication | Welsh-language student view (F-12) | High | Propose close |
| [BP-05-010](../05-assessment-and-results/bp-05-010-submit-and-examine-a-pgr-thesis.md) | Examiner roles, thesis formats | Submitting and examining a thesis in Welsh (no language field on the thesis) (F-12) | Medium | Stay open |
| [BP-05-011](../05-assessment-and-results/bp-05-011-correct-a-ratified-academic-outcome.md) | Error categories, authority; ombudsman reference | Ombudsman routing (F-14) | Medium | Stay open |
| [BP-06-001](../06-progression-awards-and-graduation/bp-06-001-determine-progression.md) | Progression credit and pass rules | Scottish ordinary-or-honours decision values (F-15); SCQF levels (F-02) | Medium | Stay open |
| [BP-06-002](../06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) | Resit caps, reassessment plan types | None by nation | High | Propose close |
| [BP-06-003](../06-progression-awards-and-graduation/bp-06-003-determine-and-confer-an-award.md) | Boundaries; classification values (ordinary, unclassified); awarding body | Level and year weighting (F-03); SCQF levels (F-02); validated or franchised awards (F-07) | Medium | Stay open |
| [BP-06-004](../06-progression-awards-and-graduation/bp-06-004-issue-award-documentation-and-hear.md) | Document types and channels; HEAR or transcript per institution | Bilingual (Welsh) certificates and transcripts (F-12) | Medium | Stay open |
| [BP-06-005](../06-progression-awards-and-graduation/bp-06-005-determine-graduation-eligibility-and-attendance.md) | Ceremony cycles, eligibility rules | None | High | Propose close |
| [BP-06-006](../06-progression-awards-and-graduation/bp-06-006-record-successful-pgr-completion.md) | Completion rules, award type | None | High | Propose close |
| [BP-07-001](../07-regulatory-and-statutory-reporting/bp-07-001-prepare-and-submit-hesa-student-data.md) | Regulator codes; which collections a tenant makes | Data Futures alignment and the mode crosswalk (F-05); nation-specific fields; FE-college returns (F-09) | Low | Stay open |
| [BP-07-002](../07-regulatory-and-statutory-reporting/bp-07-002-exchange-registration-attendance-and-changes-with-student-finance-bodies.md) | Funding-source values; `slcCountsAsArranged` | SAAS exchange (F-06); part-time and distance eligibility rules by funder | Medium | Stay open |
| [BP-07-003](../07-regulatory-and-statutory-reporting/bp-07-003-manage-student-sponsor-reporting-and-compliance.md) | Attendance threshold; reporting contacts (UKVI is UK-wide) | None by nation | High | Propose close |
| [BP-07-004](../07-regulatory-and-statutory-reporting/bp-07-004-produce-ofs-regulatory-extracts.md) | England only, shown only to OfS-registered tenants (F-13); OfS registration category | Tenant nation (F-01); subcontracted-provision data (F-07) | Medium | Stay open |
| [BP-07-005](../07-regulatory-and-statutory-reporting/bp-07-005-produce-scottish-funding-council-returns.md) | Collection types under `SFC` | SFC field specifications (BL-070); SCQF (F-02); college FES (F-09) | Low | Stay open |
| [BP-07-006](../07-regulatory-and-statutory-reporting/bp-07-006-produce-medr-regulatory-and-funding-returns.md) | Collection types under `MEDR` | Medr specifications under the August 2026 framework (BL-070, F-17); Welsh-medium data | Low | Stay open |
| [BP-07-007](../07-regulatory-and-statutory-reporting/bp-07-007-produce-department-for-the-economy-returns.md) | Collection types under `DFE-NI` | DfE-NI specifications (BL-070); FE-college CSR (F-09) | Low | Stay open |
| [BP-07-008](../07-regulatory-and-statutory-reporting/bp-07-008-resolve-a-statutory-submission-data-quality-issue.md) | Validation severities; sign-off roles | Validation rule sets for each regulator (with BL-070) | Medium | Stay open |
| [BP-08-001](../08-record-governance-and-lifecycle/bp-08-001-resolve-a-duplicate-or-uncertain-identity.md) | Match thresholds; Welsh communication preference | None (UK-wide law) | High | Propose close |
| [BP-08-002](../08-record-governance-and-lifecycle/bp-08-002-correct-personal-or-enrolment-data.md) | Authority and evidence rules | None | High | Propose close |
| [BP-08-003](../08-record-governance-and-lifecycle/bp-08-003-fulfil-a-data-subject-access-request.md) | Deadline calendar (division); request types | None (UK GDPR one month is UK-wide) | High | Propose close |
| [BP-08-004](../08-record-governance-and-lifecycle/bp-08-004-assess-restriction-rectification-or-erasure-rights.md) | Restriction types, decision authority | None | High | Propose close |
| [BP-08-005](../08-record-governance-and-lifecycle/bp-08-005-retain-archive-and-dispose-of-student-records.md) | Retention schedules (tenant rows), including a Public Records (Scotland) Act 2011 records-management plan for Scottish providers | None | High | Propose close |
| [BP-08-006](../08-record-governance-and-lifecycle/bp-08-006-audit-access-and-material-record-changes.md) | Audit review cadence and scope | None | High | Propose close |

**Provider type, across all pages.**
- An English university, or an alternative provider on the OfS register, can be supported with configuration once F-01 exists. The OfS category (Approved, or Approved (fee cap)) sets fee limits, which are held as fee bands.
- FE colleges with HE need F-09.
- Lead providers with franchise or validation partners need F-07.

**Mode, across all pages.**
- Full-time, part-time and sandwich: configuration.
- Distance: configuration, but HESA maps it wrongly (F-05).
- Apprenticeship: code (F-04).
- Collaborative provision: code (F-07).

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BL-157 / OQ-2 (44 pages) | Which variants need configuration? | As the table above | As per row | Four-nation SME |
| Q-1 | Which nations and provider types does the product support at Beta? | England university and alternative provider first. Scotland, Wales and NI universities next, behind F-01, F-02 and BL-070. FE colleges with HE and apprenticeships out of scope until decided. **Institutional and product policy.** | Medium | Product owner, with the Four-nation SME |
| Q-2 | Should levels move to a framework-neutral model now (F-02)? | Yes, before any Scottish tenant. It is a schema change that gets more expensive with every migration. | High | Solutions architect |
| Q-3 | Does SAAS get a delivery-ledger flow like the other external systems? | Yes. Track the hand-off first and add a live connector later. | Medium | Solutions architect; student finance SME |
| Q-4 | Is a Welsh-language service a launch requirement for Welsh tenants? | Yes. The Standards are statutory for Welsh universities. | High | Product owner; Welsh-language compliance officer at a Welsh provider |

## Still needs a named person

- **Four-nation SME:** accept or amend each OQ-2 answer, especially the 23 left open.
- **HESA and Data Futures specialist (BL-121):** confirm F-05 against the current Data Futures coding manual, and the nation-specific fields.
- **SFC, Medr and DfE-NI data leads:** supply the field specifications (BL-070). Confirm F-09 (FES, LLWR, CSR, ILR) and F-17.
- **Student finance SME:** confirm the SAAS confirmation-of-attendance obligations, and the eligibility differences for part-time and distance students by funder (F-06).
- **Equality and legal adviser (NI):** confirm the NI disability framework wording for BP-04-004 (F-08).
- **Partnerships or quality lead:** confirm the data needed for the OfS subcontracting condition and DfE franchise registration (F-07).

## Not checked

- The SFC, Medr and DfE-NI specifications, the current HESA Data Futures specification, SAAS guidance, and the ILR, FES, LLWR and CSR specifications. None of them is in the repository, and they were not fetched.
- Fee limits for each nation for 2026-27. These are figures for each institution, not platform behaviour.
- Any institution's own regulations.
- Runtime behaviour. This is a code-reading review: no tests were run and no servers were started.
