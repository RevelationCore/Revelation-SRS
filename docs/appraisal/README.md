# Revelation SRS Appraisal Pack

> Product maturity: Alpha
>
> Data: Fictional and resettable
>
> Recommended session: 5-minute orientation plus one 20–30 minute journey

## Five-minute orientation

Revelation SRS is designed around UK higher-education terminology, governed records, explainable decisions and replaceable integrations. The current application has substantial implemented foundations, but several capabilities remain partial. The [current capability matrix](../product/current-capabilities.md) is authoritative; an available page does not by itself mean that every surrounding business process is complete.

During appraisal:

- work toward the stated goal in your own way rather than following prescribed clicks;
- use fictional information only;
- note where terminology, authority, status or the next action is unclear;
- distinguish a broken function from a missing capability or environment problem; and
- do not treat demo regulatory exchanges as real submissions.

Start the environment using [TRY.md](../../TRY.md). Confirm that both applications show a Demo/Alpha context banner and the intended scenario before beginning.

## Journey A: Student module choice

| Item | Detail |
|---|---|
| Perspective | Enrolled student |
| Scenario | `module-selection` |
| Application | Student portal, <http://localhost:5174> |
| Persona | `alice.demo` / `Demo-2026!` |
| Goal | Understand current modules, choose an available module or prepare a selection proposal, and establish what will happen next |
| Completion condition | A request/proposal is visibly pending, or the application clearly explains why it cannot be submitted |

Do not use a click-by-click script. Begin at the dashboard and complete the goal using the navigation and language available to you.

Known limitations: timetable-clash and ranked-allocation rules are incomplete; some changes require staff approval; a request is not the same as an effective registration. Consult the capability matrix if the product boundary is unclear.

Feedback prompts:

1. What status do you believe the module choice is now in?
2. What, if anything, must another person do next?
3. Which rule, term or message was hardest to understand?
4. How confident are you that you completed the goal, from 1 (not confident) to 5 (very confident)?

## Journey B: Registry operational review

| Item | Detail |
|---|---|
| Perspective | Registry Administrator |
| Scenario | `module-selection` |
| Application | Admin console, <http://localhost:5173> |
| Persona | `registry` / `Demo-2026!` |
| Goal | Find an enrolled student, understand the authoritative record and determine whether any module-related action is waiting for staff |
| Completion condition | You can state the student's current enrolment/module position and either decide an eligible pending request or explain why no decision is available |

Known limitations: the student-detail surface combines capabilities at different maturity levels, and not all future workflow decompositions are implemented.

Feedback prompts:

1. Which information did you treat as authoritative, and why?
2. Was decision authority and the consequence of the action clear?
3. Could you recover after taking a wrong route?
4. What information would you require before making this decision in a real institution?

## Journey C: Exam-board governance review

The managed evaluator defaults to the `module-selection` scenario. Before this journey, stop it and restart on the `exam-board` scenario:

```bash
pnpm evaluate:stop
pnpm evaluate --scenario exam-board
```

| Item | Detail |
|---|---|
| Perspective | Exam Board Chair or External Examiner |
| Scenario | `exam-board` |
| Application | Admin console, <http://localhost:5173> |
| Persona | `chair` for decisions or `examiner` for read-only review; password `Demo-2026!` |
| Goal | Review a board, establish quorum/conflict/decision status and determine whether its outcomes are safe to ratify or publish |
| Completion condition | You can explain the current governance state, evidence used, available authority and next permitted action |

Known limitations: pack hashes and rule-manifest references are not yet populated by pack generation. Treat this as a material appraisal limitation, not a hidden implementation detail.

Feedback prompts:

1. Could you distinguish recommendation, decision, ratification and publication?
2. Was read-only versus decision authority evident?
3. What evidence would you expect to inspect before ratification?
4. Where could an unsafe or premature action occur?

## Record feedback

Use the [appraisal feedback template](feedback-template.md). A facilitator should classify each observation as usability, defect, missing capability, accessibility, data, or environment before triage. Exact-click regression walkthroughs remain separately under [demo scenarios](../demo-scenarios/README.md); they are not substitutes for these goal-based appraisal tasks.
