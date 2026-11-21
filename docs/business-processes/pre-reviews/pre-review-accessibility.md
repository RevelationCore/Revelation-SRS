# Pre-review: accessibility of the admin app, portal and shared UI (BL-104, BL-105)

> Date: 2026-11-21
> Items reviewed: `apps/admin`, `apps/portal`, `packages/ui`; both accessibility statements; the axe and keyboard tests in `e2e/`; the [accessibility improvement plan](../../product/accessibility-improvement-plan.md); backlog items BL-104 (manual assistive-technology testing) and BL-105 (independent audit).
> Roles taken: digital accessibility auditor (WCAG 2.2 AA; Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018).
> Status: **AI pre-review.** It is a code-reading pre-audit and approves nothing.
> - It is **not** the manual assistive-technology testing BL-104 asks for. No screen reader, browser or server was used.
> - It is **not** the independent audit BL-105 asks for. It closes neither item.

## What was checked

- Shared components: `packages/ui/src/components/` (Input, LabelledField, Dialog, Tabs, Table, Badge, Spinner, SkipLink, Button, Problem, StatusNotice, Code). The colour tokens in `packages/ui/src/theme/tokens.ts` were measured with the WCAG relative-luminance formula.
- Both `Layout.tsx` components; both `index.html` files (title, `lang`); the i18n setup.
- The pages for the seven target journeys:
  - `StudentDetailPage`, `ExamBoardDetailPage` (Board authority tab), `ModuleSelectionProposalsPage`, `CurriculumPublicationsPage`;
  - portal `LoginPage`, `ResultsPage`, `CircumstancesPage`, `AdjustmentRequestPage`, `AdjustmentCaseDetailPage`.
- Repository-wide greps for status messages, colour classes, file inputs, `aria-describedby`, `document.title`, drag interactions and sticky elements.
- The axe configuration: `e2e/admin-a11y.spec.ts`, `e2e/admin-authenticated.spec.ts`, `e2e/portal-authenticated.spec.ts` (all use `withTags(['wcag2a','wcag2aa','wcag21aa'])`, `@axe-core/playwright` ^4.14.0).
- Sign-in configuration: `infra/compose/keycloak/srs-realm.json`.

## Sources consulted

| Source | Version or date read |
|---|---|
| W3C WCAG 2.2 (Recommendation, October 2023, updated December 2024) and its Understanding documents | 2.2 |
| GOV.UK, *Understanding accessibility requirements for public sector bodies*; *Public sector website and mobile application accessibility monitoring*; *Accessibility monitoring: how we test* | Read 2026-11-21. GDS monitors against WCAG 2.2 A and AA from October 2024. |
| GOV.UK, *Sample accessibility statement* and *Model accessibility statement* | Read 2026-11-21 |
| GDS blog, *What GDS has found from public sector accessibility monitoring* | 17 December 2024 |
| Equality Act 2010, s.20 and s.91 (GB); Disability Discrimination Act 1995 and SENDO 2005 (NI) | Statutory position |

## Summary

The structural basics are sound:
- Radix dialogs and tabs;
- a skip link and `main` landmark;
- `aria-current` navigation;
- reduced-motion support;
- a jsx-a11y lint;
- axe on every route.

The statements are honest about their limits. But they are behind the legal standard: they claim WCAG 2.1, while GDS monitors against 2.2 AA. They also lack the content the regulations require.

The code shows likely failures in:
- page titles;
- reflow (admin);
- the contrast of form-field borders;
- status messages;
- linking hints and errors to their fields;
- text contrast in states the scans don't render;
- the portal's mobile menu;
- one placeholder-only field on the module-approval journey.

**Findings:** 0 Blocker, 10 Major, 9 Minor, 6 Observation. All of them still need confirming by manual testing.

## Findings

Each finding is a *likely* failure from reading the code. A human tester must confirm it.

| ID | Severity | Criterion | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| A-01 | Major | Regulations (statement), all of 2.2 | Both statements claim WCAG **2.1** AA and say WCAG 2.2 has not been evaluated. The legal monitoring standard has been WCAG 2.2 AA since October 2024. The axe scans do not use the `wcag22aa` tag. | `apps/portal/src/pages/AccessibilityStatementPage.tsx`; `apps/admin/src/pages/AccessibilityStatementPage.tsx`; the `withTags` calls in `e2e/*.spec.ts` | Target WCAG 2.2 AA. Add `wcag22aa` to every scan. Add manual checks for 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7 and 3.3.8. |
| A-02 | Major | Regulations (statement content) | The statements lack required or model content: <br>- the regulation's compliance wording (fully, partially or not compliant); <br>- non-accessible content listed against the criteria it fails; <br>- a disproportionate-burden section; <br>- how to request an accessible format, and the timescale; <br>- "preparation of this statement" (date and method). <br>They are hard-coded for the product. The contact is the project mailbox, not the institution, which is the public sector body legally responsible. | Both statement pages | Provide a statement **template** that each tenant fills from tenant configuration (institution name, contact, response times, enforcement body by nation). List known failures (this table) against the criteria. |
| A-03 | Major | 1.4.10 Reflow | The admin sidebar is fixed at `w-56` and content is offset with `ml-56` at every width. At 320 CSS px (1280 px wide at 400% zoom) the content column is about 96 px. The statement calls this an "accepted exception" because the app is desktop-first. 1.4.10 applies to desktop zoom, and the regulations allow an exemption only through a documented disproportionate-burden assessment. | `apps/admin/src/components/Layout.tsx` (`Sidebar`, `aside … w-56`); admin statement "R-A11Y-001" | Use a collapsible navigation like the portal's (with A-09 fixed). Withdraw the "accepted exception" wording. |
| A-04 | Major | 2.4.2 Page Titled | No route sets `document.title`: grep finds none in `apps/*/src` or `packages/ui/src`. Every page is titled "Revelation SRS — Student Portal" or "— Administration". A route change is also not announced and does not move focus. | `apps/portal/index.html:7`; `apps/admin/index.html:6` | Add a route title hook (page name, then app name). Move focus to the `h1`, or announce the route change. |
| A-05 | Major | 1.4.11 Non-text Contrast | Field and checkbox borders use `border-neutral-300` (#cbd5e1) on white: **1.48:1** (3:1 needed). The invalid-field border `danger-400` is 2.69:1. axe does not test non-text contrast. | `packages/ui/src/components/Input.tsx` (`FIELD_BASE`, `fieldBorder`, `Checkbox`); 29 uses of `border-neutral-300` | Use neutral-500 (#64748b, 4.76:1) or a darker border for controls, and danger-600 when invalid. |
| A-06 | Major | 4.1.3 Status Messages | About 118 inline error messages and 9 success messages are plain `<p>` elements with no live region, so screen-reader users are not told an action failed or succeeded. Examples: `SlcPage.tsx:90`, `PgrSupervisionPage.tsx:78`, the Authority tab in `ExamBoardDetailPage.tsx` (around line 128), portal `LoginPage.tsx` sign-in error, `OfsPage.tsx:110`. `StatusNotice` and `Problem` exist but are not used consistently. | grep `(error…) && <p` without `role=` in `apps/*/src/pages` | Route every async outcome through `Problem` (alert) or `StatusNotice` (status). Add a lint or check for bare error and success `<p>` elements. |
| A-07 | Major | 1.3.1, 3.3.2 | `LabelledField` renders hints with no `id`, and does not connect its error `id` to the control. Only `packages/ui/src/form/Field.tsx` sets `aria-describedby`; there are 4 uses in the whole UI. Hints such as the EC description guidance and the adjustment rationale guidance are not read with the field. Required status is shown by an `aria-hidden` asterisk unless the page also sets `required` or `aria-required`. | `packages/ui/src/components/Input.tsx` (`LabelledField`); `CircumstancesPage.tsx:114`; `AdjustmentRequestPage.tsx` (rationale) | Give `LabelledField` hint and error ids and pass `aria-describedby` and `aria-required` to its child (clone, or a render prop). |
| A-08 | Major | 1.4.3 Contrast (Minimum) | Small text below 4.5:1: <br>- `text-success-600` is **3.77:1**, used for success messages and statuses in `OfsPage:110,233`, `UcasPage:92`, `UkviPage:266,287`, `ExamBoardDetailPage:772`, `IntegrationsPage`, `GlobalisationPage`, `TenantConfigPage:104`, `WorkflowDefsPage`, `StudentDetailPage:1565`; <br>- `text-warning-600` is **3.19:1**, used for portal module-selection validation messages (`ModuleSelectionPage.tsx:266,344`) and `EnvironmentRuntimePage:106`; <br>- `text-neutral-400` is **2.56:1** for meaningful text: `NotificationsPage:144` (dates), `DisabilityPage:157,170,220`, `RightsRequestsPage:616-617`, `ModerationPage:103`, and `Code.tsx:128` while loading; <br>- the Approve button is white on `success-600` (3.77:1, `text-xs`) in `ModuleSelectionProposalsPage.tsx`. <br>The scans miss most of these because they appear only in data-dependent states. | Token measurements; files listed | Use 700-shade text tokens for status text. Add a lint that bans `text-*-400/600` on white for text. Scan the success and error states. |
| A-09 | Major | 2.4.3 Focus Order, 4.1.2, 2.1.2 | The portal mobile menu (the main navigation on phones) is not a modal: <br>- no `role="dialog"` or `aria-modal`; <br>- focus is not moved into it; <br>- focus is not contained; <br>- Escape is not handled; <br>- the page behind is not inert; <br>- focus is not returned to "Open menu"; <br>- the menu button has `aria-expanded` but no `aria-controls`. | `apps/portal/src/components/Layout.tsx:110-150` | Build the menu on the Radix `Dialog` primitive (side sheet). |
| A-10 | Major | 3.3.2, 1.3.1, 1.1.1 | On the module-approval journey: <br>- the "Decision reason" field has only a placeholder as its label. axe accepts a placeholder as an accessible name, so the scans do not catch it, and the field appears only after "Decide" is pressed. <br>- A bare "⚠" marks a module with warnings, with no text alternative or reason. | `apps/admin/src/pages/ModuleSelectionProposalsPage.tsx:109, 127-131` | Add a visible label tied to the row's student. Replace ⚠ with text ("Has warnings") or `aria-label` plus a visible list of the warnings. |
| A-11 | Minor | 2.4.7 Focus Visible | The timetable upload uses an `sr-only` file input inside a styled label with no `focus-within` style. Keyboard focus is invisible. | `apps/admin/src/pages/TimetablesPage.tsx:87-89` | Add `focus-within:outline` to the label, or use a visible button. |
| A-12 | Minor | 3.1.1, 3.1.2 | `lang` is fixed (`en-GB` on the portal, `en` on the admin app) and does not change when Welsh is shown. Translated pages contain hard-coded English strings ("Related module", "Optional", the "Module" table header, the whole `AdjustmentRequestPage` heading). The admin app offers `cy` rather than `cy-GB`. | `apps/*/index.html`; `packages/ui/src/i18n/index.ts`; `CircumstancesPage.tsx:102`; `ResultsPage.tsx`; `EngagementCasePage.tsx:88` | Set `document.documentElement.lang` when the language changes. Move the strings into i18n. |
| A-13 | Minor | 1.4.10, 2.4.11 | `DialogContent` is a fixed `max-w-md`, centred with `top-1/2 -translate-y-1/2`, with no `max-height` or `overflow-y`. Long dialogs (for example New enrolment) are cut off at high zoom, and focused fields can be off-screen. | `packages/ui/src/components/Dialog.tsx` (`DialogContent`); `StudentDetailPage.tsx:513` | Add `max-h-[calc(100vh-2rem)] overflow-y-auto` and a fallback for narrow screens. |
| A-14 | Minor | 1.3.1, 4.1.2 | `CodeLabel` exposes a value's description only through `title`, which mouse users see on hover only. It is unavailable to keyboard and touch users and is read inconsistently. | `packages/ui/src/components/Code.tsx` (`CodeLabel`) | Where the description matters, show it as visible text or a disclosure. |
| A-15 | Minor | 4.1.3 | `Spinner` names its `role="status"` with `aria-label`, which live regions do not reliably announce. | `packages/ui/src/components/Spinner.tsx` | Use visually hidden text inside the status element. |
| A-16 | Minor | 2.4.3, 3.2.2 | Forms revealed inline do not move focus to the new content: the EC form opened by "Submit", and the decision controls in a module-approval row. | `CircumstancesPage.tsx:78-94`; `ModuleSelectionProposalsPage.tsx` | Focus the revealed heading or first field. |
| A-17 | Minor | 3.3.1 | The EC Submit button stays disabled until the description has text. A disabled button is skipped by Tab and gives no reason. | `CircumstancesPage.tsx:124` | Keep the button enabled and show a linked error instead. |
| A-18 | Minor | 1.3.1, 2.1.1 | Data tables have no caption or accessible name. The `overflow-x-auto` scroll wrapper cannot be focused, so wide tables cannot be scrolled by keyboard in every browser. | `packages/ui/src/components/Table.tsx`; `ResultsPage.tsx` | Add an optional `caption` prop, and `tabIndex=0` with a label on the wrapper when it overflows. |
| A-19 | Minor | 2.5.8 Target Size (Minimum) | The portal Sign out control is `text-xs` with no padding, about 16 px high. Check whether the spacing exception applies. | `apps/portal/src/components/Layout.tsx` (user footer) | Make it at least 24 px tall with padding. |
| A-20 | Observation | 3.3.8 Accessible Authentication | The credential and MFA screens are Keycloak's own theme. There is no theme in the repository and no `loginTheme` in the realm. They are part of every sign-in journey and must be in the audit. Paste, password managers and copyable OTP codes must work. | `infra/compose/keycloak/srs-realm.json` | Add a Keycloak theme to the audit scope, or ship an accessible theme. |
| A-21 | Observation | 1.3.1 | Admin navigation groups use `<p>` labels and no list structure, so a screen-reader user hears one long run of links. | `apps/admin/src/components/Layout.tsx` (`SectionLabel`, `Sidebar`) | Use `ul`/`li`, with group headings or `aria-labelledby` groups. |
| A-22 | Observation | Test coverage | The axe scans run on mocked data at first render. They do not cover error states, open dialogs, revealed inline forms, long or empty data, a 320 px viewport, 200% or 400% zoom, or text spacing (1.4.4, 1.4.10, 1.4.12). | `e2e/admin-authenticated.spec.ts:95`; `e2e/portal-authenticated.spec.ts:69` | Add scans of those states and a reflow and text-spacing Playwright check. |
| A-23 | Observation | 2.2.1 Timing Adjustable | Access tokens last 5 minutes and refresh silently. The development realm's idle timeout is 8 hours (`srs-realm.json:15`). A tenant realm with a shorter idle timeout would end the session with no warning and lose unsaved text (for example an EC description). | `apps/portal/src/auth/AuthContext.tsx:91-115` | Warn before the session ends, with an option to extend. Keep draft text. |
| A-24 | Observation | 3.3.2, 2.4.6 (cognitive) | Staff are asked for an "Enrolment ID" (a UUID) on the exam-board conflict form, and module-approval rows show the enrolment UUID instead of the student's name. | `ExamBoardDetailPage.tsx` (Authority tab, `ba-conflict-enrol`); `ModuleSelectionProposalsPage.tsx:101` | Use a student picker and show names. |
| A-25 | Observation | Advisory (G201) | The enforcement links in both statements open a new window without warning. | Both statements | Add "(opens in new tab)". |

## Test plan for BL-104 (manual assistive-technology testing)

**Matrix.** Each combination runs every journey below.

| AT | Browser and platform | Priority |
|---|---|---|
| NVDA (current) | Firefox and Chrome, Windows 11 | Staff and student journeys |
| JAWS (current) | Chrome and Edge, Windows 11 | Staff journeys (common in university IT) |
| VoiceOver | Safari, macOS | Staff and student journeys |
| VoiceOver | Safari, iOS (phone) | Student journeys |
| TalkBack | Chrome, Android (phone) | Student journeys |
| Keyboard only, plus Windows magnifier or 400% browser zoom, plus a 1.4.12 text-spacing bookmarklet | Chrome | All journeys |
| Dragon NaturallySpeaking or Voice Control | Windows or macOS | Sign-in, EC, adjustment (2.5.3 Label in Name) |

**For every step**, record:
- the AT and browser versions;
- the announced name, role and state;
- the reading and focus order;
- any operation that failed;
- the WCAG criterion;
- the severity, and whether the journey was blocked.

Re-test findings A-04 to A-19 wherever a journey touches them.

**Staff journeys (admin app)**

1. *Student record update* (`/students` → student → identity edit; New enrolment dialog):
   - search for the student and read the results table (headers, row context);
   - open the record and confirm the page title and `h1` are announced (A-04);
   - move between tabs with the arrow keys and hear "tab, selected, n of m";
   - edit identity fields with an invalid value and submit; check the error is announced and linked to its field (A-06, A-07);
   - open New enrolment: focus moves into the dialog, focus is contained, Escape closes it and focus returns to the opener; at 400% zoom every field can be reached (A-13);
   - repeat at a 320 px width (A-03).
2. *Exam board authority* (`/exam-boards/:id` → Board authority):
   - declare a conflict, record quorum, record a decision and ratify;
   - check the quorum met or not met result is spoken, not shown only in colour;
   - check success and failure messages are announced (A-06);
   - check the "Enrolment ID" field is understandable (A-24).
3. *Module approval* (`/module-selection-proposals`; also `/curriculum-publications` for programme and module approval):
   - open a decision, then type a reason, approve, return and reject;
   - check the reason field has a label (A-10), focus moves to the controls (A-16), each row's buttons are identifiable in a links-and-buttons list, and the warnings ⚠ are announced as meaningful text (A-10).

**Student journeys (portal)**

4. *Sign in*:
   - skip link, sign-in button, then the Keycloak login and MFA pages (A-20);
   - paste the password from a password manager, and paste an OTP code;
   - get an error by mistyping and check it is announced;
   - after sign-in, check focus and the title on the dashboard;
   - on a phone, open the menu, move through it and close it with Escape or back gesture (A-09).
5. *View results* (`/results`):
   - the table is announced with a name, and headers are read with each cell;
   - the result status is conveyed as text;
   - the empty state and the error state are announced.
6. *Submit an exceptional circumstances claim* (`/circumstances`):
   - open the form and check focus moves (A-16);
   - the hint is read with the description field (A-07);
   - try to submit empty (A-17);
   - submit, and check the success status is announced;
   - read the outcome card;
   - test a session timeout mid-entry (A-23).
7. *Request an adjustment* (`/adjustments/request` → case detail):
   - required-field announcement and error linking;
   - submit, and check the "Request submitted" notice is announced on the next page;
   - upload evidence with the labelled file input and hear the result.

Also run each portal journey once with Welsh selected (when available), to check `lang` and pronunciation (A-12).

## Scope for the independent audit (BL-105)

- **Standard:** WCAG 2.2 AA in full (all 55 A and AA criteria), plus the content of the statement as the 2018 regulations require.
- **Sample:**
  - every page in the seven journeys above;
  - the Keycloak sign-in, MFA and account pages;
  - all shared components (one component library page or story per component);
  - a structured sample of at least 15 further admin routes, covering each navigation section (Regulatory, Wellbeing, Governance, Reporting, Administration, Operations);
  - the remaining portal routes (`/registration`, `/modules/select`, `/exams`, `/timetable`, `/documents`, `/graduation`, `/disability`, `/applications`, `/research`);
  - both accessibility statements;
  - generated documents students receive (award PDFs, letters) under the regulations' document rules.
- **Method:** manual expert inspection, with the AT matrix above, and testing with disabled users (at least screen-reader, magnification, voice-control and cognitive or neurodivergent participants) on the student journeys.
- **States:** errors, empty data, long data, open dialogs, Welsh language, 320 px and 400% zoom, forced colours or Windows high contrast, and reduced motion.
- **Out of scope** (record this in the audit): third-party systems the SRS hands off to (VLE, timetabling, finance).
- **Deliverables:** findings against each criterion with severity and reproduction steps; a re-test after fixes; and wording for the statements' "non-accessible content" section.
- **Independence:** an auditor with no part in building the product. Each institution deploying the product should audit its own configured tenant (its branding, content and Keycloak theme), because the legal duty is the institution's.

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| AQ-1 | Move the conformance target from WCAG 2.1 AA to 2.2 AA? | Yes, now. It is the monitoring standard. | High | Product owner |
| AQ-2 | Keep the admin reflow "accepted exception"? | No. Fix it. Only a documented disproportionate-burden assessment, made by each institution, could justify it, and it is not a strong case. | High | Product owner; accessibility lead |
| AQ-3 | Who publishes the statement? | The institution (the public sector body), from a product template held in tenant configuration. | High | Institution's digital accessibility lead |
| AQ-4 | Is the AT matrix above enough for BL-104? | Yes as a minimum. Add disabled-user sessions under BL-105. | Medium | Accessibility lead running BL-104 |
| AQ-5 | Is a Keycloak theme in product scope? | Yes. Ship an accessible default theme. | Medium | Solutions architect |

## Still needs a named person

- **Assistive-technology tester (BL-104):** run the test plan and confirm or reject A-04 to A-19.
- **Independent auditor (BL-105):** carry out the audit as scoped above.
- **Product owner:** decide AQ-1 and AQ-2, and approve the statement template (A-02).
- **Each institution's accessibility lead:** publish and own its tenant statement and its disproportionate-burden assessments, if any.

## Not checked

- Any rendered output: colours in context, actual tab order, screen-reader announcements, zoom and reflow. No browser, server or assistive technology was used, and the e2e suite was not run.
- The Keycloak login and account themes (not in the repository).
- Generated PDFs and emails, and documents students upload.
- The 80-plus admin and portal pages beyond the journeys read above. The greps covered all pages, but the findings are only as complete as the patterns searched for.
- Cognitive accessibility beyond the obvious UUID issue (A-24). Plain language was not assessed.
