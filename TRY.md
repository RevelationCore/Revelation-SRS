# Try Revelation SRS

Revelation SRS is an Alpha open-source student records system for UK higher education. This evaluation environment uses fictional data and is intended for product appraisal, accessibility review and functional exploration. It is not a production deployment.

## Start locally

You need Node.js 22+, pnpm 9+ and a running Docker-compatible engine.

```bash
cp .env.example .env
pnpm install
pnpm evaluate
```

The command checks prerequisites, starts essential services, migrates the database, loads a deterministic scenario, provisions demo personas and prints the application links. If it cannot prepare a safe environment, it stops with an actionable diagnosis.

Useful lifecycle commands:

```bash
pnpm evaluate:status
pnpm evaluate:reset
pnpm evaluate:stop
```

`evaluate:reset` works only for the evaluator-managed fictional demo environment and refuses production-like environments.

By default `pnpm evaluate` loads the `module-selection` scenario. To use a different one (some appraisal journeys need this — see the appraisal pack), stop the environment first and restart with `--scenario <slug>`, e.g. `pnpm evaluate:stop && pnpm evaluate --scenario exam-board`. Run `pnpm demo:list` to see available scenario slugs.

## Appraise the product

Open the [appraisal pack](docs/appraisal/README.md) and choose one goal-based journey:

- student module choice and request;
- registry review of student records and pending work; or
- governance review of an exam-board decision.

All demo accounts use `Demo-2026!`. The appraisal pack supplies the appropriate username, starting state, completion condition, known limitations and feedback questions.

Before reporting a problem, check the [current capability matrix](docs/product/current-capabilities.md). Report environment failures separately from product defects. Never enter real student or institutional data.

For developer-oriented setup and test evidence classes, see the [developer setup guide](docs/developer-setup.md).
