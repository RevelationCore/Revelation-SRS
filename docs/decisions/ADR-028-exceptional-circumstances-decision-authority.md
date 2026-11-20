# ADR-028: Exceptional-Circumstances Decision Authority and Separation of Duties

**Status**: Accepted for generic product implementation
**Date**: 2026-11-20
**Follows**: [ADR-017](ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md) (minimum-necessary outcomes, restricted evidence); [Phase 5 gap-closure decisions](phase-5-gap-closure-decisions.md), D-41
**Backlog**: BL-036; process [BP-04-005 Manage exceptional circumstances](../business-processes/04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md)

## Context

Exceptional-circumstances (EC) claims can be run in two places.

**In core** (`apps/api/src/routes/circumstances.ts`):
- A student submits a claim (`circumstances:submit`) and sees their own (`circumstances:read:own`).
- Registry records claims (`circumstances:write`).
- Since D-41, an outcome is a proposal. It is decided through a governed review (`EcDeterminationService`, workflow `ec-determination`) by a holder of `circumstances:decide` (today `registry-administrator` and `exam-board-chair`). The service refuses a decision by the proposer or by whoever recorded the claim.

**In the wellbeing module** (`modules/wellbeing/src/routes/ec-claims.ts`): staff run the case and its restricted evidence.
- **Routes.** Seven routes: record, list, read, change status, record an evidence review, determine, and withdraw.
- **Handoff.** An upheld determination goes to core through F-WELL-SIS-02 (`srs/srs-ec-client.ts`). Core turns it into a new proposal, so a core decider decides the claim a second time.
- **Permissions.** Phase 1 found that the routes checked no permission. It added `ec-claim:read` and `ec-claim:manage`, both granted to `wellbeing-advisor` and `registry-administrator` (`packages/domain/src/permissions.ts`; test `modules/wellbeing/test/ec-claim-authorisation.int.test.ts`).

The phase 1 permissions leave four gaps in the wellbeing routes:
- **One permission records, assesses and decides,** so one person can record a claim, mark its evidence sufficient and uphold it.
- **The acting user comes from the request body.** The determination's `authorisedById` and the evidence review's `reviewerId` are free text, so a caller can name someone else as the decider.
- **`PATCH /ec-claims/:id/status` accepts any status code,** `upheld` and `not_upheld` included. The EC claim has no transition rules in `domain/status-rules.ts`, so the determination route can be bypassed entirely.
- **The determination's audit row is mislabelled.** It is written with `resourceType: 'disability-case'`, not `ec-claim`.

Two other points bear on the decision:
- **BP-04-005 separates the roles.** Its actors include a Case Officer (intake, evidence, recording) and an Authorised Decision Maker. The exam board acts on the authorised outcome "rather than adjudicating the personal circumstances behind it".
- **D-41 left one question to the institution:** who decides EC, a panel or a delegated officer.

## Decision

1. **Two EC roles, named after the BP-04-005 actors.**
   - **`ec-case-officer`** runs claims: intake, evidence, status and withdrawal.
   - **`ec-decision-maker`** decides outcomes.

   An institution assigns them to whichever staff run EC, registry or wellbeing, without granting either group the other's wider special-category access.
2. **Deciding is a separate permission.** Permission mapping in `packages/domain/src/permissions.ts`:

   | Permission | Routes | Roles |
   |---|---|---|
   | `ec-claim:read` | `GET /ec-claims`, `GET /ec-claims/:id` | `ec-case-officer`, `ec-decision-maker`, `wellbeing-advisor`, `wellbeing-auditor` |
   | `ec-claim:manage` | `POST /ec-claims`, `PATCH /ec-claims/:id/status`, `POST /ec-claims/:id/evidence-reviews`, `POST /ec-claims/:id/withdraw` | `ec-case-officer`, `wellbeing-advisor` |
   | `ec-claim:determine` (new) | `POST /ec-claims/:id/determine` | `ec-decision-maker` |

   - **`registry-administrator` loses both wellbeing EC permissions.** Registry receives the minimum-necessary outcome in core (ADR-017). An institution whose registry runs EC assigns `ec-case-officer` to those staff.
   - **No student role holds an `ec-claim:*` permission.**
3. **The same two roles act in core.**
   - `circumstances:read` and `circumstances:write` add `ec-case-officer`.
   - `circumstances:decide` becomes `ec-decision-maker` only, removing `registry-administrator` and `exam-board-chair`.

   This changes D-41's role mapping, not its mechanism. Exam board chairs keep reading decided outcomes, as BP-04-005 requires.
4. **Separation of duties, enforced in the service.**
   - **Who may not decide.** `POST /ec-claims/:id/determine` returns 403 problem `separation-of-duties` when the acting user is either of these:
     - the actor on any version of the claim (recorded it or changed its status);
     - the reviewer on any of its evidence reviews (assessed it).
   - **How actors are compared.** By `sub`, and also by `srsPersonId` when both records carry it.
   - **Withdrawal.** It is not a decision, so it needs no separation.
   - **In core,** `EcDeterminationService.#assertIndependent` already refuses the proposer and the recorder. Its rule is unchanged.
5. **The acting user comes from the token.**
   - `authorisedById` (determine) and `reviewerId` (evidence review) are removed from the request bodies. The service sets them from the authenticated user.
   - The routes return 400 if either field is sent, so that old clients fail loudly rather than being silently ignored.
6. **Only the determination sets a determined status.**
   - Add `EC_CLAIM_TRANSITIONS` to `modules/wellbeing/src/domain/status-rules.ts`:

     | From | Allowed next |
     |---|---|
     | `active`, `submitted` | `evidence_pending`, `under_review`, `closed` |
     | `evidence_pending` | `under_review`, `closed` |
     | `under_review` | `evidence_pending`, `closed` |
     | `upheld`, `not_upheld` | `closed` |
     | `closed` | none (final) |

   - `PATCH` returns 409, with the allowed next statuses, for anything else, `upheld` and `not_upheld` included. Those two are set only by `/determine`. Withdrawal stays a move to `closed` through `/withdraw` (as today), with its reason recorded.
7. **Decision body: a delegated officer by default, a panel if configured.**
   - **Setting.** The tenant setting `ec.decisionAuthority` is `delegated-officer` (the default) or `panel`.
   - **On the record.** The determination records `decisionBodyCode`, from a new value set `ec-decision-body` (`delegated-officer`, `panel`).
   - **In panel mode,** the decision maker records the panel's decision and must give `panelMeetingRef`. Separation of duties applies to the person recording it.
   - **In core,** a panel's quorum is configured in the `ec-determination` governed-review workflow definition.
8. **A wellbeing determination is decided once, not twice.**
   - When the wellbeing module is a tenant's EC case system, core records its upheld outcome as decided, not as a new proposal.
   - F-WELL-SIS-02 v2 carries `determinationId`, `decidedBy`, `decisionBodyCode` and `decidedAt`.
   - Core accepts it only from the wellbeing module's service client, checked by `azp`, with a new permission `circumstances:record-determined` held by `integration-service`.
   - Core stores the provenance and does not re-adjudicate.
   - Until this ships, core's second decision stays in place. It is stricter, not weaker.
9. **Students are unchanged.** They submit and see their own claims in core (`circumstances:submit`, `circumstances:read:own`) and see the decided outcome, never the evidence reviews or the rationale held in the wellbeing module.
10. **Audit.** Determination audit rows use `resourceType: 'ec-claim'`.

## Rationale

- **It follows the process.** BP-04-005 separates the Case Officer from the Authorised Decision Maker. Separate permissions, and a service-level refusal of the same person, make that separation hold whatever the screen does (pattern P-22).
- **Least privilege.** Dedicated roles avoid giving registry staff wellbeing case access, or wellbeing staff registry write access, just to run EC (core principle 6). Removing `exam-board-chair` from deciding keeps the board on the outcome, not the circumstances (ADR-017).
- **Separation must hold everywhere.** It means nothing while the decider is self-declared in the body or `PATCH` can set `upheld`, so both are closed.
- **One authority for each decision.** Deciding twice gives two answers and a confusing audit trail.

## Options considered

| Option | Verdict |
|---|---|
| Keep phase 1's mapping (`read` and `manage` for advisers and registry) | Rejected. One person can record, assess and uphold |
| Add `ec-claim:determine` to the existing roles (`wellbeing-panel-chair`, `registry-administrator`) | Rejected. It bundles EC authority with adjustment panels and broad registry rights; institutions organise EC differently |
| Separate permission and dedicated roles, with separation of duties in the service | **Chosen** |
| Require a panel (several deciders) for every claim | Rejected as the default. Many providers delegate routine claims to an officer; panel mode is configuration |

## Consequences

- **Accounts must be assigned.** IAM must assign the two new realm roles, and the demo personas and seed data need them. Until they are assigned, no one can decide a wellbeing EC claim or a core EC proposal (fail closed).
- **Old clients break.** Clients sending `authorisedById` or `reviewerId`, or using `PATCH` to set a determined status, get 400 or 409. The admin EC screens change accordingly. The project is Alpha, so breaking this now is acceptable.
- **Two people are needed.** A small institution where one officer runs and decides every claim must now involve a second person. This is deliberate.
- **The institution must confirm:**
  - who holds `ec-decision-maker`: a panel or a delegated officer (closes the D-41 open question);
  - whether `wellbeing-advisor` should keep `ec-claim:manage` by default;
  - the panel quorum if `panel` is chosen.

  The process owner and the academic registrar confirm, through the BP-04-005 review.

## Guard

- **`ec-claim-authorisation.int.test.ts` becomes a role matrix:** each of the seven routes against each role above, and against `student`, `registry-administrator` and `exam-board-chair`, expecting 403.
- **New separation tests:**
  - the recorder determines: 403;
  - an evidence reviewer determines: 403;
  - a third user determines: 201 or 204;
  - `PATCH` to `upheld`: 409;
  - `authorisedById` in the body: 400.
- **Core:** a `circumstances:decide` test for `exam-board-chair` (403) and for `ec-decision-maker` (200).
- **Pattern P-22's governed-steps table** gains rows `ec-claim / determine / differs from recorder and evidence reviewer` and `ec-determination / decide / differs from proposer and recorder`, each pointing at its test.
