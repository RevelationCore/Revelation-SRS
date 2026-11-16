# Phase 1 Gap-Closure Decisions

> Status: Accepted
> Date: 2026-11-16
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md), Phase 1 (screens over existing APIs)
> Made by: the project's solutions-architect agent (`.claude/agents/solutions-architect.md`), adopted for implementation

Each decision lists what an institution must confirm before go-live.

## D-1: Retire the direct enrolment status change

**Decision.** Remove the staff-facing routes `POST /enrolments/:id/{intermit,suspend,withdraw,graduate,reinstate}` and the Enrolments-tab buttons that call them. Every legal transition already has a governed path: interruption, suspension, withdrawal and return are status cases; graduation is award conferment. `EnrolmentService.transitionStatus` stays, for internal callers only (status-case decisions, award conferment). A status recorded in error is corrected through an institution-initiated case decided by a second registry administrator. There is no break-glass override.

**Why.** A direct change bypasses the separation of duties that status cases enforce (the opener cannot decide). Core principles: governed workflow; BP-02-007/009 step 5.

**Institution must confirm.** At least two people hold `status-case:decide`.

## D-2: Students request interruption, return, withdrawal and transfer

**Decision.** Keep the four student-requestable types; suspension and leaver closure stay institutional. The portal offers only the types the enrolment's status allows, offers a return only after an approved interruption (showing its outstanding conditions), takes a transfer's destination from the published catalogue and says both programmes must agree, and shows a confirmation step before withdrawal or interruption with a funding notice. Students with a Student-route visa or CAS see a visa notice before a withdrawal, interruption or transfer: the university must report the change to UKVI within 10 working days and their permission may be cancelled. The portal learns only that the student is sponsored, not their visa details. The student can withdraw their own open request. Reasons come from the value set only; no free text or evidence upload (ADR-017).

**Institution must confirm.** The wording of the funding and visa notices; whether students may request a transfer at all.

## D-3: Progression lives on the Awards tab

**Decision.** A Progression section at the top of the student record's Awards tab: the current decision, credits counted, recognised credit and rule exceptions applied, and history. Registry administrators (`progression:write`) run an evaluation; exam-board chairs and members see it read-only. A ratified (locked) decision cannot be re-run. No run action on the exam board in Phase 1.

## D-4: Documents and graduation

**Decision.** Registry administrators issue and revoke documents (revocation needs a reason and a confirmation step) and run graduation cycles. Students see their issued documents (read-only; no download until rendering in Phase 3) and respond to graduation invitations in the portal. Staff get an audited verification lookup by code; account-free third-party verification waits for Phase 3.

**Institution must confirm.** Whether revocation should need a second approver (Phase 3).

## D-5: Misconduct outcomes have their own permissions

**Decision.** A Misconduct outcomes section on the student record shows the opaque case reference, status, penalty and its effects, and records an outcome. It never collects allegation text or evidence. The routes move from `mark:write`/`mark:read:all` to `misconduct:record` (integrity officer, registry administrator) and `misconduct:read` (integrity officer, registry administrator, exam-board chair).

**Why.** Module tutors could record outcomes and external examiners could read them; ADR-017 limits outcomes to those who act on them.

**Institution must confirm.** Which roles see misconduct history.

## D-6: Identity verification has its own read permission

**Decision.** A Verification checks section on the Identity tab. Registry administrators request and complete checks; marking a check fraud-flagged needs a confirmation step. No document images. Reading moves from `student:read:all` to `identity-verification:read` (registry administrator, DPO, regulatory officer). The section covers identity only; right to study stays with UKVI until the model records it separately.

**Institution must confirm.** Who may mark a check fraud-flagged.

## D-7: A manual curriculum publication is applied by someone else

**Decision.** Applying a publication needs `curriculum-publication:apply`, narrowed to registry administrators. When a person (not the curriculum connector) received a publication, a different person must apply it. A publication from the connector carries the source system's approval and one person applies it.

## Risk taken up: advice before a status decision

The architect noted that a transfer could be approved without the destination programme's support, and a sponsored student's case without UKVI compliance advice (BP-02-006 steps 3–4). Phase 1 adds both guards to the case decision.
