# Attendance and Engagement Contract Vocabulary

> Status: Proposed v0.1 — SME and architecture approval pending
>
> Date: 2026-07-27
>
> Applies to: migration `0037`, engagement APIs and version 1 events/integration contracts

## Naming rules

- `Expected engagement event` means an activity the student is expected to undertake. It is not evidence that the activity occurred.
- `Engagement observation` means a source assertion about an expected or recognised activity. It is not an institutional engagement judgement.
- `Observation outcome` describes the source assertion; `alert status` and `case outcome` belong to separate aggregates.
- `Authorised absence` is an operational outcome under provider policy. It must not contain medical, disability or safeguarding narrative.
- `Alternative engagement` means approved evidence appropriate to the mode or student. It must not reveal why an alternative was approved.
- `Non-engagement alert` is explainable evidence requiring triage. It is not a sanction, status decision or sponsor report.
- `Intervention case` is the authoritative SRS record of engagement follow-up. Workflow state is operational and correlated to it.
- `Referral` transfers a minimum necessary request to a service that owns its own decision and restricted evidence.
- `Attendance` is used for presence at an event. `Academic engagement` is the broader canonical concept.

API fields and database columns use `snake_case`; TypeScript properties use `camelCase`; codes use lowercase kebab-case; event subjects use `srs.engagement.<fact>.v1`.

## Source and identifier vocabulary

| Term | Contract requirement |
|---|---|
| `source_system_code` | Stable registered source, never a display label |
| `source_event_id` | Source's stable identifier for the expected activity or observation |
| `source_version` | Monotonic or otherwise comparable source assertion version |
| `idempotency_key` | Unique within tenant, contract and registered source; replay returns the existing result |
| `correlation_id` | Connects exchange, domain transaction, workflow and audit records |
| `person_id` | Canonical SRS person identifier |
| `enrolment_id` | Authoritative enrolment to which the expectation applies |
| `activity_reference` | Module, placement, supervision, assessment or other approved activity reference |
| `event_time` | When the activity/observation happened according to the source |
| `received_at` | When the SRS accepted the assertion |
| `recorded_at` | Transaction time of the authoritative SRS version |

## Core value-set proposal

`Extensible` means a tenant may add a code without redefining the semantics of platform codes. Platform-controlled lifecycle and control codes are not extensible.

### `engagement-activity-type-code` — extensible

| Code | Meaning |
|---|---|
| `lecture` | Required lecture, in person or remote |
| `seminar-tutorial` | Seminar, tutorial or equivalent small-group activity |
| `laboratory-practical` | Laboratory, studio, workshop or practical work |
| `assessment` | Submission, examination or other required assessment activity |
| `research-supervision` | Scheduled research supervision or formal research contact |
| `research-fieldwork` | Approved research or fieldwork evidence |
| `placement` | Required placement engagement |
| `online-activity` | Required asynchronous or synchronous digital activity |
| `other-recognised` | Tenant-defined recognised academic engagement activity |

### `engagement-event-mode-code` — extensible

| Code | Meaning |
|---|---|
| `in-person` | Physical attendance at a named location |
| `remote-live` | Synchronous remote participation |
| `asynchronous` | Completion is not tied to a live session |
| `hybrid` | Participation may be physical or remote |
| `off-campus` | Placement, fieldwork or other off-campus activity |

### `engagement-observation-outcome-code` — controlled

| Code | Meaning |
|---|---|
| `attended` | Evidence supports expected participation |
| `absent` | Evidence supports non-participation and no authorised outcome is recorded |
| `authorised-absence` | Provider-authorised operational absence outcome exists |
| `partial` | Evidence supports only part of the expected participation |
| `alternative-engagement` | Approved alternative evidence satisfies the expectation |
| `cancelled` | Provider cancelled the event; never a student absence |
| `not-captured` | No reliable observation is available |

### `engagement-capture-method-code` — extensible

| Code | Meaning |
|---|---|
| `staff-entry` | Authorised member of staff records the observation |
| `student-check-in` | Student self-check-in with the configured assurance method |
| `device-scan` | Card, token or device scan |
| `vle-activity` | Evidence supplied by a virtual learning environment |
| `assessment-submission` | Evidence supplied by an assessment/submission service |
| `source-import` | Versioned batch or API assertion from another authorised source |
| `specialist-confirmation` | Minimum-necessary confirmation from an authorised specialist service |

### `engagement-data-quality-code` — controlled

| Code | Meaning |
|---|---|
| `valid` | Assertion passed contract and domain validation |
| `missing` | Expected source evidence has not arrived |
| `duplicate` | Assertion duplicates an accepted source version |
| `disputed` | Accuracy is challenged and requires reconciliation |
| `conflicting` | Authorised sources assert incompatible outcomes |
| `quarantined` | Contract, identity or provenance validation failed |
| `corrected` | A later authorised version supersedes the assertion |

### `engagement-alert-status-code` — controlled

| Code | Meaning |
|---|---|
| `open` | Awaiting triage |
| `suspended-reconciliation` | Data issue prevents escalation |
| `triaged-no-action` | Human triage found no intervention necessary |
| `intervention-opened` | A linked intervention case exists |
| `superseded` | Re-evaluation replaced the alert |
| `closed` | Alert handling is complete |

### `engagement-case-status-code` — controlled

| Code | Meaning |
|---|---|
| `open` | Case created and awaiting action |
| `contact-in-progress` | Accessible contact attempts are under way |
| `review-due` | New evidence or actions require review |
| `referred` | Minimum-necessary referral has been accepted for separate decision |
| `closed` | Authorised case outcome recorded |

### `engagement-case-outcome-code` — controlled

| Code | Meaning |
|---|---|
| `data-corrected` | Source or identity issue resolved the concern |
| `no-concern` | Human review found no engagement concern |
| `engagement-restored` | Agreed action restored engagement |
| `support-continuing` | Support continues without an adverse status decision |
| `no-response` | Contact attempts completed with no response; further decision is separate |
| `referred-wellbeing` | Minimum-necessary wellbeing referral created |
| `referred-safeguarding` | Restricted safeguarding referral created |
| `referred-academic-status` | Separate authorised academic-status review requested |
| `referred-sponsor-compliance` | Separate sponsor-compliance review requested |

### `engagement-referral-status-code` — controlled

| Code | Meaning |
|---|---|
| `pending` | Referral recorded but not acknowledged |
| `acknowledged` | Target accepted responsibility |
| `rejected` | Target rejected the referral with a sanitised reason |
| `reconciled` | Source and target agree final referral state |
| `cancelled` | Authorised cancellation sent and reconciled |

## Prohibited contract fields

General engagement APIs, events, logs and dead-letter payloads must not contain:

- diagnosis, disability category or medical narrative;
- safeguarding allegation, concern narrative or third-party identity;
- immigration-document images or detailed immigration history;
- free-text exceptional-circumstances evidence;
- predictive labels presented as facts; or
- a field that combines observation, intervention, academic status and sponsor decision.

Use opaque specialist case references and permitted-purpose checks where a role must follow a referral.

## Versioning and compatibility

1. Adding an optional field or tenant value is backward compatible only when consumers safely ignore it.
2. Changing a code's meaning, required field, identifier semantics or privacy classification requires a new contract version.
3. Corrections identify both the superseded source version and replacement version.
4. A contract acknowledgement proves receipt; an application acknowledgement or reconciliation proves applied state.
5. Historical policies and values remain resolvable at the event/observation effective time.

## Open approval items

- Confirm whether `authorised-absence` is a source observation or a derived operational outcome in every institution; the model may need a separate authorisation reference.
- Confirm the controlled core needed for PGR, placements and collaborative provision.
- Confirm whether biometric or location-derived capture is prohibited by default or supported only behind a separate DPIA and adapter approval.
- Map each accepted code set to `value_set` and `field_value_set` only after Increment A approval.
