# Test Notes

## Local Commands Attempted

```text
pnpm typecheck
```

Result:

```text
zsh:1: command not found: pnpm
```

`node`, `npm`, and `corepack` are available locally, but `pnpm` is not currently installed or activated in this shell, and no `node_modules` directories were present. Because network access is restricted in this environment, this review did not attempt to install dependencies.

## Review Method

The review therefore used static inspection of:

- package manifests and TypeScript source under `packages/*` and `apps/api`
- database schema/helper/test files under `packages/db`
- CI workflow under `.github/workflows/ci.yml`
- local infrastructure under `infra/compose` and `infra/docker`
- Phase 3 roadmap criteria in `docs/project-roadmap.md`
- architecture expectations in `docs/architecture/*`

## Verification Gap

Before accepting Phase 3 as complete, run at minimum:

```text
corepack enable
corepack prepare pnpm@9 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
docker compose -f infra/compose/docker-compose.yml up -d
pnpm migrate
```

The most important missing test is a clean-database migration test that proves the production schema contains the same RLS and bitemporal constraints currently applied only in test bootstrap SQL.

