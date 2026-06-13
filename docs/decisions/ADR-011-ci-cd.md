# ADR-011: CI/CD Pipeline

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §21 requires all tests to run in CI on every pull request and no code to be merged with a failing test suite. The CI/CD tooling must be open source or free for open source projects, and must support container image building, vulnerability scanning, OpenAPI contract testing, and accessibility testing.

## Decision

**GitHub Actions** as the CI/CD platform.

## Rationale

- Free for public open source repositories; no infrastructure to maintain for CI.
- Native integration with GitHub pull requests, branch protection rules, and required status checks enforces the "no merge on failure" policy.
- Matrix builds for multiple Node.js versions and operating systems.
- Docker Buildx support for multi-platform image builds.
- Large ecosystem of community actions for Trivy scanning, Semgrep, k6, Playwright, and OpenAPI tooling.
- Secrets management via GitHub Actions encrypted secrets for CI-specific credentials (e.g. container registry tokens).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| GitLab CI | Excellent but requires self-hosted GitLab or GitLab SaaS; GitHub is the natural host for an open source project |
| Woodpecker CI (self-hosted) | Good open source option for self-hosted; adds operational overhead on the Mac Mini; GitHub Actions is the lower-friction choice for an open source project |
| Jenkins | Heavyweight; significant operational overhead; dated developer experience |

## Consequences

- Pipeline is defined in `.github/workflows/` as YAML; version-controlled alongside application code.
- Required status checks on the `main` branch: lint, type-check, unit tests, integration tests, contract tests, accessibility scan, container image build and vulnerability scan.
- Performance (k6) and full E2E (Playwright) tests run on a separate scheduled workflow, not on every PR.
- Container images are published to GitHub Container Registry (`ghcr.io`) on merge to `main` and on tagged releases.
