# Frontend Component Testing

Component tests run with Vitest, jsdom and React Testing Library in each frontend workspace. Use `pnpm test:component` or include them in `pnpm test:quick`.

## Shared harness

`test/component-setup.mjs` (repo root, loaded via each workspace's `vitest.component.config.ts`) wires up three things for every component test in every workspace, so individual tests don't reimplement them:

- `@testing-library/jest-dom` matchers and `cleanup()` after each test;
- an MSW (`msw/node`) server, started once and reset between tests — import `server` from `test/msw-server.mjs` and call `server.use(http.get(url, handler))` per test to control HTTP responses;
- the `jest-axe` `toHaveNoViolations` matcher, registered globally — call `expectNoA11yViolations(container)` from `test/axe.mjs` against a rendered container.

## Conventions

- Query by role, accessible name or label. Use test IDs only when no user-facing semantic exists.
- Assert visible outcomes and enabled/disabled authority, not component internals.
- Exercise loading, empty, error, populated and success states where the component owns them.
- Use `user-event` for keyboard and pointer behaviour.
- Mock HTTP at the MSW boundary when a page needs controlled service states; use generated API types or shared contract fixtures.
- Do not use component HTTP handlers in real full-stack journeys.
- Check accessible naming, error association, live status messages and focus behaviour in every critical interactive pattern.
- Call `expectNoA11yViolations` on at least one stable rendered state per component under test. These checks supplement, but do not replace, keyboard, screen-reader and real-browser appraisal.

The first shared tests cover field/error association, dialog Escape behaviour, status announcements, empty tables and the non-dismissible Alpha/demo context in both applications — all now MSW-backed where they call the API, and axe-checked. Critical workflow coverage should grow by authoritative state and unsafe transition, not by line-percentage targets.
