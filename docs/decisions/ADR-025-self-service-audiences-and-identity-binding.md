# ADR-025: Self-Service Audiences and Identity Binding

**Status**: Accepted for generic product implementation
**Date**: 2026-11-17
**Decision record**: [Phase 5 gap-closure decisions](phase-5-gap-closure-decisions.md), D-38 to D-40

## Context

The self-service portal (`apps/portal`) was built for students only. Applicants, PGR supervisors, progress-review panel members and thesis examiners had no view of their own: applicants could only be dealt with by staff, and supervisors read every PGR case through the admin app's `pgr-case:read`. External examiners hold no institutional account at all.

The `srs_person_id` JWT claim, which binds a signed-in user to their SRS person row, was documented as a student-only claim. Staff and external examiners had no binding, so a "my cases" view could only have matched on `sub` or email, which identify an account, not a person record.

## Decision

1. **One self-service portal for everyone outside the back office.** Students, applicants, supervisors, review panel members and examiners all use `apps/portal`. The admin client stays internal.
2. **`srs_person_id` names any person with an SRS person row**, not only students. IAM sets it. Self-service scoping always matches `request.user.srsPersonId` to database rows (an application's `person_id`, a `staff_assignment`, a `pgr_review_member`, an `examiner_appointment`), never `sub` or email.
3. **Two new roles**: `applicant`, and `pgr-examiner`, which is distinct from the taught `external-examiner`.
4. **Accounts are requested through the delivery ledger, not created by the SRS.** F-SIS-IAM-01 contract v2 adds `accountKind` (`student`, `applicant` or `external`) and `roles[]`. The SRS computes each person's account from everything that entitles them to one: enrolments, applications bound with a certain identity match, current supervision assignments and examiner appointments. It sends one state-sync item per person, carrying a hash of that state.
5. **Keycloak stays the identity provider (ADR-006).** The SRS never issues credentials or sign-in links. External examiners get guest accounts created by IAM; signing in with a home-institution account (UK Access Management Federation) is a Keycloak deployment setting.
6. **The portal follows the signed-in roles.** Student pages for `student`, Applications for `applicant`, Research for `research-supervisor` and `pgr-examiner`. The API, not the navigation, enforces access.

## Rationale

- Keeps the back-office client internal: external examiners and applicants never load it.
- Binding by a person id that IAM sets avoids exposing one person's record to another through a shared or reused email address.
- Keeps identity in Keycloak and account provisioning in IAM, reached through the same per-target ledger as every other outbound flow (ADR-019), rather than a second identity system.
- Narrows supervisors from reading every case to reading their own supervisees.

## Consequences

- F-SIS-IAM-01 consumers must accept contract v2; only the manual and stub modes exist today.
- Staff binding depends on an HR feed creating person rows for supervisors and examiners, and on IAM setting the claim. Until then, supervisors and examiners cannot use the portal.
- An applicant sees nothing while their identity match is `needs-review`, so a wrong match is held back by review rather than shown.
- Applicant accounts end `access.applicantAccountEndDays` (default 90) after the last application ends with no enrolment; examiner access ends `pgr.examinerAccess.graceDays` (default 30) after the examination closes.
- The institution must confirm that IAM will create applicant and guest accounts and set `srs_person_id`, whether external examiners use federated sign-in, and that an HR feed creates staff person rows.
