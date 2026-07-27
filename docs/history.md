# Documentation History

The active `main` branch contains maintained product, process, requirements, architecture, integration and operating documentation. Superseded delivery plans, phase reviews, UAT evidence and historical release assertions were removed during documentation convergence so that collaborators are not asked to distinguish old project-management claims from the current baseline.

No historical content was discarded. The exact pre-convergence documentation is preserved at:

- tag: `pre-convergence-2026-07-27`
- branch: `archive/pre-convergence-2026-07-27`
- commit: `787af6c`

After fetching the preservation references, inspect a historical file without changing branches:

```bash
git show pre-convergence-2026-07-27:docs/project-roadmap.md
```

Browse the complete preserved tree:

```bash
git ls-tree -r --name-only pre-convergence-2026-07-27 docs
```

Historical records are evidence of prior analysis and delivery activity, not evidence that the current application implements the described capability. Use [current capabilities](product/current-capabilities.md) for implementation status.
