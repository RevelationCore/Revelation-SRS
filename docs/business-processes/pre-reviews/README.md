# AI pre-reviews

> Status: AI pre-reviews, 2026-11-21. Not sign-off.

[SME review register](../sme-review-register.md) · [Backlog](../../product/backlog.md)

Each record below is an **AI pre-review**. An AI reviewer took on the expert roles the review needs. It checked the process pages, decision records and code against current regulation and sector guidance, and recorded:
- findings;
- proposed answers to the open questions;
- recommended defaults;
- exactly what a named person must still confirm.

It is a starting point for the named reviewers, not their review. Nothing here approves, signs off or confirms anything. Each record also lists what its reviewer could not check.

The work the reviews found is in the [backlog](../../product/backlog.md), with each row's Source pointing at the record. Each open process question in a reviewed range points at the record that proposes its answer.

| Record | Backlog item | Findings (Blocker / Major / Minor / Observation) | Headline |
|---|---|---|---|
| [BP-01-001 to 007](pre-review-bp-01-001-007.md) | BL-123 | 0 / 11 / 10 / 4 | Admissions chain built; gaps in condition separation, offer changes, identity matching and sensitive declarations |
| [BP-02-001 to 005](pre-review-bp-02-001-005.md) | BL-113 | 0 / 5 / 6 / 3 | No identity check before registration; fee liability not historical; pre-registration access not enforced |
| [BP-02-006 to 009](pre-review-bp-02-006-009.md) | BL-114 | 0 / 12 / 8 / 2 | Decisions sound; future-dated changes apply at once; UKVI, SLC and Finance not told |
| [BP-02-010](pre-review-bp-02-010.md) | BL-115 | 0 / 2 / 7 / 3 | Built; page stale; some students dropped silently |
| [BP-02-011 to 012](pre-review-bp-02-011-012.md) | BL-116 | 0 / 5 / 6 / 3 | Non-registration built; leaver closure thin |
| [BP-03-001 to 007](pre-review-bp-03-001-007.md) | BL-117 | 0 / 6 / 3 / 2 | Most July gaps built; pages stale; eligibility check proves nothing |
| [BP-04-001 to 006](pre-review-bp-04-001-006.md) | BL-118, BL-174 | 0 / 6 / 4 / 1 | Built but pages contradict code; no UKVI 60-day guard; EC decision-maker defaults proposed |
| [Reasonable adjustments, D-44](pre-review-adjustments-d-44.md) | BL-124 | 1 / 11 / 6 / 2 | **Blocker:** the deployed wellbeing service uses stub SRS clients, so nothing reaches core |
| [BP-05-001 to 011](pre-review-bp-05-001-011.md) | BL-119 | 1 / 13 / 8 / 3 | **Blocker (fixed, BL-177):** any student could read any other student's results |
| [BP-06-001 to 006](pre-review-bp-06-001-006.md) | BL-120 | 0 / 11 / 7 / 2 | Conferment and verification strong; progression edge cases, post-conferment changes and document content weak |
| [BP-07-001 to 008](pre-review-bp-07-001-008.md) | BL-121 | 1 / 9 / 3 / 1 | **Blocker (production):** the HESA return is not Data Futures |
| [BP-08-001 to 006](pre-review-bp-08-001-006.md) | BL-122 | 1 / 9 / 3 / 2 | **Blocker:** the retention sweep ignores holds, restrictions and open access requests |
| [Evidence boundary](pre-review-evidence-boundary.md) | BL-158 | 0 / 2 / 2 / 1 | Mostly follows ADR-017; the student's EC narrative is stored in core |
| [Four-nation variants](pre-review-four-nation-variants.md) | BL-157 | 0 / 9 / 6 / 4 | No tenant nation, regulator or provider type; four variants need code, not configuration |
| [Accessibility](pre-review-accessibility.md) | BL-104, BL-105 | 0 / 10 / 9 / 6 | Basics sound; WCAG 2.1 target, missing statement content, likely reflow, title, contrast and status-message failures |
| [Institution confirmations](pre-review-institution-confirmations.md) | BL-125 | 0 / 5 / 8 / 3 | Defaults mostly sound; five shipped behaviours unsafe for production |

A theme across the reviews: most process pages are still the July v0.1 drafts and describe gaps that have since been closed. Each area has a backlog row to refresh its pages before the named review, so reviewers sign the text that matches what is built.
