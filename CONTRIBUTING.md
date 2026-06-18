# Contributing to Revelation SRS

Thank you for your interest in contributing to Revelation SRS. This document covers everything you need to know to get started.

---

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22
- [pnpm](https://pnpm.io/) ≥ 9 (`npm install -g pnpm`)
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL, NATS, and integration tests)

See [docs/developer-setup.md](docs/developer-setup.md) for a full setup walkthrough.

---

## Getting started

```bash
git clone <repository-url>
cd revelation-srs
pnpm install
docker compose up -d
pnpm migrate
pnpm test
pnpm test:int
```

---

## Code style

- TypeScript throughout. Run `pnpm typecheck` before pushing.
- ESLint enforced. Run `pnpm lint` before pushing. Zero errors required; warnings are tolerated.
- No per-file copyright headers (see `LICENSE` in the root).
- No `new Date()` in `apps/api/src/**` except in `clock.ts` — use `clockNow()`.
- Comments only where the *why* is non-obvious. No narration of what the code does.

---

## Branching and pull requests

1. Fork the repository and create a feature branch from `main`.
2. Keep branches focused: one logical change per PR.
3. Write or update tests to cover your change.
4. Run the full test suite locally (`pnpm test && pnpm test:int`).
5. Open a PR against `main` using the PR template.

---

## Sign-off (DCO)

All commits must carry a Developer Certificate of Origin sign-off. Add `-s` to every commit:

```bash
git commit -s -m "feat: add student profile edit endpoint"
```

This appends `Signed-off-by: Your Name <email@example.com>` to the commit message, certifying you have the right to submit the contribution under the AGPL v3 licence. See the `DCO` file in the root of this repository for the full text of the certificate.

PRs containing unsigned commits will not be merged. Amend and force-push if you forgot:

```bash
git commit --amend -s
git push --force-with-lease
```

---

## Test requirements

| Suite | Command | Required to pass |
|---|---|---|
| Unit tests | `pnpm test` | Yes |
| Integration tests | `pnpm test:int` | Yes (needs Docker) |
| TypeScript | `pnpm typecheck` | Yes |
| Lint | `pnpm lint` | Yes |
| E2E golden | `pnpm test:e2e:playwright:golden` | CI only |

Integration tests use [Testcontainers](https://node.testcontainers.org/) and spin up ephemeral PostgreSQL instances automatically. Docker must be running.

---

## Domain logic and NFRs

Revelation SRS is a UK Higher Education domain model. Contributions that touch:

- **Regulatory fields** (HESA, UCAS, SLC codes): cite the published coding manual reference.
- **Bitemporal records**: all writes must preserve `valid_from`/`valid_to` and `recorded_at` correctly.
- **Multi-tenancy**: all queries must carry `tenantId` RLS context. Never cross tenant boundaries.
- **Audit trail**: all state changes go through the audit log. Mutations that bypass audit are rejected.

---

## Reporting bugs

Use the [bug report issue template](.github/ISSUE_TEMPLATE/bug_report.yml). Please include steps to reproduce, expected behaviour, actual behaviour, and the relevant log output.

---

## Security vulnerabilities

Do not open a public issue for security vulnerabilities. Follow the responsible disclosure process in [SECURITY.md](SECURITY.md).

---

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). By participating you agree to uphold its standards.
