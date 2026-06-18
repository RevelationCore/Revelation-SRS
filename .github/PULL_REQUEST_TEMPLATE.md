## Summary

_What does this PR do? Why?_

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Infrastructure / CI

## Related issues

Closes #

## Checklist

- [ ] Tests added or updated (`pnpm test && pnpm test:int` pass)
- [ ] TypeScript compiles without errors (`pnpm typecheck`)
- [ ] Lint passes with zero errors (`pnpm lint`)
- [ ] OpenAPI spec regenerated if routes changed (`pnpm generate:openapi`)
- [ ] Bitemporal writes include correct `valid_from`/`valid_to` and `recorded_at`
- [ ] All queries carry `tenantId` — no cross-tenant data access
- [ ] All mutations are recorded in the audit log
- [ ] Commits are signed off (`git commit -s`) per the DCO

## Notes for reviewers

_Anything the reviewer should pay particular attention to._
