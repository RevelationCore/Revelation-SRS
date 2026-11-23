# Backlog

> Status: Authoritative list of outstanding work
> File: [`backlog.csv`](backlog.csv) (opens directly in Excel)
> Started: 2026-11-19

[Product documentation](README.md) · [Current capability matrix](current-capabilities.md) · [Enterprise readiness audit](enterprise-readiness-audit.md)

[`backlog.csv`](backlog.csv) is the one list of outstanding work: defects, features, technical debt, tests, operations work, decisions and questions waiting on someone, and reviews. Other documents still describe the work in detail (the readiness plan, the capability matrix, the process pages, ADRs), but anything still to do is a row here. When a document finds a gap, the gap gets a backlog row and the document refers to its ID. The gap does not live only in a sentence of prose.

## Using it in Excel

Open `backlog.csv`, select the header row and choose **Data → Filter**. Each classification column has a fixed set of values, so the filter drop-downs stay short. Some useful views:

- **What blocks go-live:** Priority `P0` or `P1`, and Status anything except `Done` and `Won't do`.
- **Which go-live blockers matter most:** filter `Go-live tier` to `Tier 1`. The tiers rank open engineering P1s by what goes wrong if the SRS goes live without them (ranked 2026-11-23).
- **What is waiting on someone else:** Owner `Institution`, `SME` or `DPO`, or Status `Awaiting decision` or `Awaiting review`.
- **One domain:** filter on Area.
- **Not yet prioritised:** Priority `Triage`.

If you save from Excel, keep the file as **CSV UTF-8**. Keep dates as `YYYY-MM-DD`; the check also accepts Excel's day/month/year when it re-saves them.

## Columns

| Column | Meaning |
|---|---|
| ID | `BL-` and a number. Never reused or renumbered; new rows take the next number |
| Title | What the work is, in a few words |
| Detail | What to do, what "done" means, and any context needed to start |
| Type | The kind of work (values below) |
| Area | The product domain or concern it belongs to (values below) |
| Quality | The quality it mainly improves (values below) |
| Root cause | Why the item exists (values below) |
| Pattern | For a root cause of `Missing pattern` or `Principle not enforced`: the ID (`P-01` to `P-22`) of the design pattern that would have prevented it, in the maintainers' engineering patterns catalogue |
| Priority | `P0` before real institutional data is loaded; `P1` before go-live; `P2` planned after go-live; `P3` worth doing, no date; `Triage` not yet prioritised |
| Go-live tier | P0 and P1 only. `Tier 1` a real go-live gate: a statutory or legal breach, harm to students' data, wrong or corrupted records, or running blind; `Tier 2` fix before go-live, with a smaller blast radius (hardening, notices, assessment rules, consumer law, accessibility); `Tier 3` needed for go-live but conditional (scale, Temporal when enabled, other nations) or low risk (screens, docs). Empty for reviews, questions and decisions, which wait on people |
| Size | `S` under a day, `M` 1 to 3 days, `L` 3 to 8 days, `XL` more than 8 days, `?` not estimated |
| Status | `Open`, `In progress`, `Blocked`, `Awaiting decision`, `Awaiting review`, `Done`, `Won't do` |
| Owner | Who acts next: `Engineering`, `Architecture`, `Product`, `Institution`, `SME`, `DPO` |
| Waiting on | For blocked or awaiting rows: what or whom it waits for |
| Milestone | The plan stage it belongs to, if any (for example `Readiness phase 2`, `Temporal stage 5`) |
| Source | The document that describes the work in detail |
| Source ref | The item's reference in that document (`Readiness 3.7`, `BP-02-004 OQ-1`, a capability ID). Several references are separated by `;` |
| Added | When the row was added |
| Updated | When the row last changed |

**Type:** `Defect` (something behaves wrongly), `Feature` (new capability), `Improvement` (an existing capability made better: safer, faster, more robust), `Integration` (a link to an external system), `Tech debt`, `Test`, `Docs`, `Operations`, `Decision` (a choice someone must make), `Question` (an open business-process question), `Review` (an independent or SME review).

**Area:** `Platform`, `Tenancy & data`, `Auth & access`, `Workflow`, `Integrations`, `Infrastructure`, `Admissions`, `CAS & sponsor`, `Registration & status`, `Curriculum`, `Module selection`, `Engagement`, `Adjustments & EC`, `Wellbeing`, `Assessment`, `Exam boards`, `Progression & awards`, `PGR`, `Regulatory`, `Identity & rights`, `Communications`, `Reporting`, `Globalisation`, `Admin & portal UI`, `Accessibility`, `Demo & migration`, `Testing`, `Documentation`.

**Quality:** `Security`, `Availability`, `Performance`, `Scalability`, `Maintainability`, `Extensibility`, `Accessibility`, `Usability`, `Compliance`, `Functionality`.

**Root cause:**
- `Principle not enforced`: a written principle covered it (for example [core principles](../core-principles.md) §6 on row-level security), but nothing checked the code against it.
- `Missing pattern`: it could have been designed in from the start, but no rule asked for it.
- `Planned scope`: known work deliberately left for later.
- `External`: it waits on an institution, SME, DPO, regulator or third party.
- `Not assessed`: not yet classified.

The first two need a Pattern. Filtering on them shows which lessons the next project should design in from day one.

## Keeping it up to date

- **Found a gap?** Add a row. If a document mentions the gap, cite the row's ID there rather than describing it as a loose follow-up.
- **Finished something?** Set Status to `Done` and update the date. Leave the row in place; done rows are the history.
- **Answered a process question?** Mark it answered on its process page. On a row that lists several pages, remove that reference from Source ref; on a row for one question, close the row. If part of the question is still open, cite it as `BP-xx-yyy OQ-n (remainder)` and say what is open in Detail.
- **Changed the readiness plan?** Every plan item needs a row with Source ref `Readiness N.M`.
- **Fixed a defect a design rule should have prevented?** Set Root cause and Pattern, and update the pattern's entry in the catalogue (its evidence, or its guard).

`pnpm check:backlog` (part of CI's documentation checks) fails on:

- an unknown column value or a duplicate ID;
- a root cause of `Missing pattern` or `Principle not enforced` with no Pattern;
- a missing source document;
- a readiness plan item with no row;
- an open process question with no row;
- a row still citing a question its page has closed.

## How it was started

The first 158 rows (2026-11-19) were collected from:

- the [enterprise readiness plan](enterprise-readiness-audit.md#remediation-plan): every item and the open decisions, plus what phase 1 found;
- the "material limitation" column of the [capability matrix](current-capabilities.md);
- stage 5 of the [live Temporal plan](../architecture/temporal-integration-plan.md);
- the [domain-events backlog](../architecture/domain-events.md#backlog--not-yet-implemented);
- the accessibility plan's [deferred items](accessibility-improvement-plan.md#explicitly-deferred);
- the open gates in the [testing and appraisal status](testing-appraisal-implementation-status.md);
- the [SME review register](../business-processes/sme-review-register.md);
- the open questions on every business-process page;
- deferrals noted in delivery records.

Three questions appear, worded the same, on almost every process page: the owner and boundary, the four-nation variants, and which evidence stays in a specialist system. Each is one row listing its pages.

Two kinds of starting value are proposals, not decisions:

- **Priorities that no source plan set.** The plan items keep the plan's own priorities.
- **Notes that delivered work "may answer" a process question.** The question's owner confirms and closes it.

The [change backlog derived from business processes](../business-processes/revelation-change-backlog.md) (July 2026) remains the record of the BPR requirements and their acceptance evidence. Their delivery is rated in the capability matrix, and what is left of them is in this backlog.
