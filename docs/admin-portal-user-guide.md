# Revelation SRS — Administration Portal User Guide

> Version: Phase 4  
> Application: `apps/admin`  
> Default URL (development): `http://localhost:5173`

---

## Overview

The Revelation SRS Administration Portal is the staff-facing web interface for managing student identity records and enrolment lifecycles. It communicates exclusively with the Revelation SRS REST API; all data changes are recorded in the audit trail and, where applicable, published as domain events.

This guide covers the features available in Phase 4. Later phases will add assessment management, regulatory return tooling, and tenant administration screens.

---

## Getting started

### Prerequisites

The API must be running and reachable. For local development the API defaults to `http://localhost:3000`. If you are running the API on a different host or port, create `apps/admin/.env` containing:

```
VITE_API_BASE_URL=http://your-api-host:port
```

### Starting the portal

```bash
pnpm --filter @revelation-srs/admin dev
```

Open `http://localhost:5173` in your browser.

---

## Signing in

The portal uses JWT Bearer authentication. Obtain a token from your institution's Keycloak instance or, in development, generate one using the API's development JWT helper.

1. Navigate to `http://localhost:5173`. You will be redirected to the **Sign in** page automatically if you are not authenticated.
2. Paste your JWT into the **Bearer Token** field.
3. Click **Sign in**.

The token is stored in your browser's local storage and attached to every subsequent API request. It is not transmitted to any third party.

**Session expiry**: if the API returns a `401 Unauthorised` response (expired or invalid token), you will be redirected to the Sign in page automatically. Your previous token is cleared.

**Signing out**: click **Sign out** in the navigation bar at any time. Your stored token is removed and you are returned to the Sign in page.

### Required roles

Different actions require different roles. Contact your system administrator if you receive a `403 Forbidden` error.

| Action | Required role |
|---|---|
| View student list and detail | Registry Administrator |
| Create students, update identity | Registry Administrator |
| Record disability declarations | Registry Administrator, Wellbeing Advisor |
| Create and manage enrolments | Registry Administrator |
| View module registrations | Registry Administrator |

---

## Student management

### Viewing the student list

After signing in you are taken to the **Students** page, which lists all students in your institution in pages of 20.

Each row shows:
- **Student number** — the institution-assigned identifier
- **Name** — legal first and family name

Use the **Previous** and **Next** buttons at the bottom of the table to move between pages.

Click **View →** on any row to open that student's detail record.

### Creating a new student

1. Click **New student** (top right of the Students page).
2. Complete the form:
   - **Legal first name** *(required)*
   - **Legal family name** *(required)*
   - **Preferred name** *(optional)* — displayed name if different from legal name
   - **Personal email** *(optional)*
3. Click **Create**.

On success the dialog closes and the list refreshes. The new student starts with a lifecycle status of **prospective** and no enrolment. Navigate to the student's detail record to add identity data and create their first enrolment.

---

## Student detail record

Click **View →** on any student in the list to open their detail page. The page is divided into two tabs: **Identity** and **Enrolments**.

The header shows:
- The student's legal name (or their ID if no identity has been recorded)
- Their student number in monospace beneath the name
- A **lifecycle status badge** (see [Lifecycle statuses](#lifecycle-statuses))

### Identity tab

The Identity tab is divided into two panels.

#### Personal identity panel

Displays the current bitemporal identity snapshot: legal name, preferred name, date of birth, institutional email, personal email, and mobile phone number. The date the record was last updated is shown at the bottom.

**Editing identity**

Click **Edit** (top right of the panel) to enter edit mode. All fields are pre-filled with the current values.

- Change any field you need to update.
- Fields you leave blank are not changed — only fields with a value are sent in the update.
- Click **Save** to commit. The new values take effect immediately and a new bitemporal version is recorded in the audit trail.
- Click **Cancel** to discard changes.

> **Note**: identity updates create a new bitemporal version. The prior version is preserved and can be retrieved via the API's `/identity-history` endpoint for audit and correction purposes.

#### HESA identifier panel

Displays the HESA student identifier, if one has been assigned.

- Click **Add** (or **Update** if one exists) to edit.
- Enter the HESA identifier and click **Save**.

#### Lifecycle status panel

Shows the current person lifecycle status and provides controls to change it.

| Status | Meaning |
|---|---|
| **prospective** | Student record created; no active enrolment yet |
| **student** | Has at least one active enrolment (enrolled, intermitting, or suspended) |
| **alumnus** | All enrolments completed; at least one graduated |
| **deceased** | Marked as deceased by an administrator |
| **merged** | Duplicate record; merged into another student record |

The statuses **student**, **alumnus**, and **prospective** are updated automatically when enrolment status transitions are recorded (see [Enrolment transitions](#enrolment-transitions)). You should only need to use the manual controls for **deceased** and **merged**.

To change the status manually, click the target status name displayed below the current status badge. The change takes effect immediately.

> **Important**: once a student is marked **deceased** or **merged**, enrolment transitions will no longer automatically update their person status. Manual changes are still possible.

---

### Enrolments tab

Lists all enrolments on record for the student. Each enrolment is shown as a collapsible card.

#### Enrolment card (collapsed)

Shows:
- Academic year of entry and mode of study
- Enrolment ID (truncated, in monospace)
- Current enrolment status badge

Click anywhere on the card to expand it.

#### Enrolment card (expanded)

The expanded view shows:
- **Details**: start date, expected end date, funding source, fee band, and (for terminal statuses) actual end date
- **Actions**: transition buttons appropriate to the current status (see [Enrolment transitions](#enrolment-transitions))
- **Active registrations**: a list of the student's currently registered modules for this enrolment, showing module code, title, and academic period

#### Creating an enrolment

Click **New enrolment** (top right of the Enrolments tab).

| Field | Required | Notes |
|---|---|---|
| Mode of study | Yes | Must be a configured value (e.g. `full-time`, `part-time`) |
| Academic year | Yes | Format `YYYY-YY` (e.g. `2025-26`) |
| Start date | Yes | Format `YYYY-MM-DD` |
| Expected end date | No | Format `YYYY-MM-DD` |
| Funding source | No | Must be a configured value (e.g. `slc`, `self-funded`) |
| Fee band | No | Must be a configured value (e.g. `home-undergraduate`) |

Click **Create**. On success:
- The enrolment is created with status **enrolled**
- A fee liability ledger record is generated
- If the student's person status was **prospective** it advances to **student**
- Downstream trigger records are created for UCAS, SLC, and UKVI where applicable (based on enrolment details)

---

## Enrolment transitions

An enrolment's status follows a defined lifecycle. The portal shows only the actions that are valid from the current status.

| Current status | Available transitions |
|---|---|
| enrolled | Intermit, Suspend, Withdraw, Graduate |
| intermitting | Reinstate, Withdraw |
| suspended | Reinstate, Withdraw |
| withdrawn | *(none)* |
| graduated | *(none)* |

**How to trigger a transition**

1. Expand the enrolment card.
2. Click the transition button (e.g. **Intermit**, **Withdraw**).
3. A confirmation dialog opens. Optionally enter:
   - **Reason code** — a short code classifying the reason (e.g. `health`, `academic`, `financial`)
   - **Reason note** — a free-text description
4. Click the action button to confirm, or **Cancel** to abort.

The transition is recorded bitemporally: the previous enrolment version is closed and a new version reflecting the new status is created. The reason code and note are preserved in the transition ledger.

**Effect on person status**

| Transition | New enrolment status | Person status effect |
|---|---|---|
| Intermit | intermitting | Remains **student** (still enrolled) |
| Suspend | suspended | Remains **student** (still enrolled) |
| Reinstate | enrolled | Remains **student** |
| Withdraw | withdrawn | If all enrolments are now withdrawn: remains **student** |
| Graduate | graduated | If all enrolments are now graduated or withdrawn and at least one graduated: advances to **alumnus** |

---

## Module registrations

The expanded enrolment card shows all active (registered) module registrations for that enrolment, including:

- Module code and title
- Academic period code (e.g. `SEM1`, `FULL-YEAR`)

This view reflects confirmed registrations; withdrawn or completed registrations are not shown. Registrations are managed by students through the student self-service portal or by registry staff via the API directly.

---

## Lifecycle status reference

### Person lifecycle statuses

| Badge | Status | Set by |
|---|---|---|
| grey | prospective | Creation (automatic) |
| green | student | Enrolment creation (automatic) |
| purple | alumnus | Final enrolment graduation (automatic) |
| red | deceased | Administrator (manual) |
| grey | merged | Administrator (manual) |

### Enrolment statuses

| Badge | Status |
|---|---|
| green | enrolled |
| yellow | intermitting |
| orange | suspended |
| red | withdrawn |
| blue | graduated |

### Module registration statuses

| Badge | Status |
|---|---|
| green | registered |
| blue | completed |

---

## Error messages

| Message | Meaning |
|---|---|
| Session expired — please log in again | Your token has expired or is invalid. Sign in again. |
| Request failed (422) | The data you submitted failed validation. The detail message explains which field is incorrect or which configured value is not recognised. |
| Request failed (409) | A conflict exists — for example, a duplicate module registration for the same offering. |
| Request failed (403) | Your role does not have permission for this action. |
| Request failed (404) | The record was not found, or belongs to a different institution. |

All validation error details from the API are shown directly beneath the relevant form or action. Correct the indicated value and try again.

---

## Keyboard and accessibility notes

- All interactive elements (buttons, inputs, modals) are keyboard-accessible via Tab and Enter/Space.
- Modals trap focus while open. Press **Cancel** or **Escape** (where supported) to close without saving.
- Status badges use colour only as a secondary indicator; the status text is always present.

---

## Appendix: quick reference

### Create a new student

Students → **New student** → fill legal name → **Create**

### Edit a student's name or contact details

Students → *student row* → **View →** → Identity tab → **Edit** → change fields → **Save**

### Update a student's HESA ID

Students → *student row* → **View →** → Identity tab → HESA identifier → **Add/Update** → enter value → **Save**

### Mark a student as deceased

Students → *student row* → **View →** → Identity tab → Lifecycle status → click **→ deceased**

### Create an enrolment

Students → *student row* → **View →** → Enrolments tab → **New enrolment** → fill fields → **Create**

### Intermit a student

Students → *student row* → **View →** → Enrolments tab → expand enrolment → **Intermit** → (optional reason) → **Intermit**

### Graduate a student

Students → *student row* → **View →** → Enrolments tab → expand enrolment → **Graduate** → (optional reason) → **Graduate**

### View a student's registered modules

Students → *student row* → **View →** → Enrolments tab → expand the relevant enrolment → scroll to **Active registrations**
