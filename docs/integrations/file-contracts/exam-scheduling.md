# Exam Scheduling Exchange

> Contract ID: `exam-scheduling.v1`
> Flows: F061 (exam entries outbound), F062 (exam schedule inbound)
> Direction: Bidirectional
> Pattern: REST API (JSON)
> Data classification: sensitive (contains candidate numbers and accommodations)
> Statutory body: None (institutional exam scheduling system or vendor)

---

## Overview

The exam scheduling exchange connects Revelation SRS to the institution's exam scheduling and invigilation system (e.g. Scientia Exam Scheduling, or an in-house system). It covers two directions:

1. **Outbound** — SRS generates exam entry records for all module registrations that require a formal exam sitting. These include approved physical accommodations. The exam scheduling system uses this data to assign candidate numbers, schedule rooms, and publish the timetable.

2. **Inbound** — Once the exam timetable is finalised, the exam scheduling system returns the candidate numbers, room assignments, and scheduled times, which SRS stores against each module registration and makes available to students via the portal.

The exchange is scoped per exam board. All entries for a board are generated and received together.

---

## Outbound: Exam Entry Batch

### Endpoint

`POST /api/v1/exam-boards/{boardId}/exam-entries/generate`

### Permission

`regulatory:write`

### Description

Generates exam entry records for all module registrations attached to the given exam board that require a formal exam sitting. Returns the batch for transmission to the exam scheduling system.

### Payload schema

`schemas/file-contracts/exam/entry-outbound.v1.json`

### Response

```json
{
  "entryCount": 347,
  "entries": [
    {
      "examEntryId": "uuid",
      "moduleRegistrationId": "uuid",
      "examBoardId": "uuid",
      "candidateNumber": null,
      "scheduledDate": null,
      "roomReference": null,
      "statusCode": "pending",
      "accommodations": {
        "extra-time-25pc": { "duration": "75 minutes", "approvedAt": "2025-09-01" },
        "separate-room": { "reason": "medical", "approvedAt": "2025-09-01" }
      },
      "validFrom": "2025-10-01T00:00:00Z",
      "recordedAt": "2025-10-01T09:00:00Z"
    }
  ]
}
```

### Accommodations

The `accommodations` field contains all currently approved physical exam accommodations for the student, derived from the SRS adjustments records. The exam scheduling system must apply these when assigning rooms and scheduling. Keys are accommodation type codes; values contain approval metadata.

**Important:** The exam scheduling system receives accommodation data directly from SRS. The Wellbeing module does not send accommodation data to the exam scheduling system directly.

### Entry status codes

| Code | Meaning |
|---|---|
| `pending` | Entry generated; awaiting candidate number and schedule |
| `scheduled` | Candidate number and timetable slot assigned |
| `cancelled` | Entry withdrawn (student withdrew or module deregistered) |

### Idempotency

Each entry has a unique `examEntryId`. Calling `generate` again for the same board regenerates fresh entries from current data. The exam scheduling system should use `moduleRegistrationId` to reconcile with previously received entries.

---

## List Exam Entries

`GET /api/v1/exam-boards/{boardId}/exam-entries`

**Permission:** `regulatory:read`

Returns all exam entries for the board, including their current status and candidate numbers once assigned.

---

## Student View

`GET /api/v1/module-registrations/{moduleRegistrationId}/exam-entry`

**Permission:** Student's own data or `regulatory:read`

Returns the exam entry for a single module registration, including candidate number and scheduled date once assigned.

`GET /api/v1/module-registrations/{moduleRegistrationId}/exam-timetable`

Returns the full timetable details once the schedule has been received.

---

## Inbound: Exam Schedule

### Endpoint

`POST /api/v1/exam-boards/{boardId}/exam-schedule`

### Permission

`regulatory:write`

### Description

Receives the finalised exam schedule from the exam scheduling system. Updates each exam entry with the assigned candidate number, scheduled date/time, and room reference. Publishes `srs.governance.exam-schedule-received`.

### Payload schema

`schemas/file-contracts/exam/schedule-inbound.v1.json`

### Body

```json
{
  "candidates": [
    {
      "moduleRegistrationId": "uuid",
      "candidateNumber": "0001",
      "scheduledDate": "2025-11-15T09:00:00Z",
      "room": "B-101"
    }
  ]
}
```

### Validation

- Every `moduleRegistrationId` in the payload must match an existing exam entry for the given `boardId`.
- `candidateNumber` must be non-empty.
- `scheduledDate` must be a valid ISO 8601 date-time.
- `room` must be non-empty.

Unknown `moduleRegistrationId` values result in `422 Unprocessable Entity` for the entire payload. Partial success is not supported.

### Idempotency

Re-POSTing the schedule for the same board overwrites existing candidate numbers and scheduled times. This allows the exam scheduling system to publish corrections.

---

## Exam Board Data Pack (Governance — Not a System Adapter)

The exam board data pack is a governance artefact used by exam board members, not an integration with an external system. It is accessed via:

- `POST /api/v1/exam-boards/{boardId}/data-pack` — generate (trigger); returns `dataPackId`
- `GET /api/v1/exam-boards/{boardId}/data-pack` — read current data pack with candidate profiles
- `GET /api/v1/exam-boards/{boardId}/data-packs/{dataPackId}/candidates/{enrolmentId}` — read individual candidate profile

Access requires exam board member role. The data pack contains candidate results, flags, marks, and EC/misconduct notes — it is `sensitive` / `special-category` data and must not be transmitted outside the secure exam board portal.

---

## Audit and Events

| Action | Audit entity | Domain event |
|---|---|---|
| Generate exam entries | `exam_entry.create` | `srs.governance.exam-entry-submitted` |
| Receive exam schedule | `exam_timetable_receipt.create` | `srs.governance.exam-schedule-received` |
| Generate data pack | `exam_board.update` | `srs.governance.exam-board-data-pack-ready` |
