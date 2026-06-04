# ADR-010: Secrets Management

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §6 requires that credentials, certificates, and API keys are managed through a dedicated secrets store and never baked into container images or committed to source control. A pragmatic approach is needed that works on the Mac Mini development environment while scaling to a hardened production deployment.

## Decision

**Development**: `.env` files (gitignored) with Docker Compose `env_file` injection.
**Production**: **OpenBao** as the secrets management service.

## Rationale

**Development (.env + Docker Compose)**
- Simple, zero-infrastructure-overhead approach for local development on a Mac Mini.
- `.env` files are explicitly gitignored; a `.env.example` file documents required variables without values.
- Docker Compose `env_file` injects secrets into containers at runtime without baking them into images.
- Sufficient for a single-developer or small-team local environment where secrets are not sensitive production values.

**Production (OpenBao)**
- OpenBao is the open source fork of HashiCorp Vault under the Mozilla Public Licence 2.0, created after Vault's licence change to BSL. It maintains API and operational compatibility with Vault.
- Provides dynamic secrets (database credentials with automatic rotation), PKI certificate management, and transit encryption.
- Kubernetes-native injection via the OpenBao Agent sidecar pattern; Docker Compose injection via the Vault/OpenBao CLI.
- Audit log of all secret access satisfies the audit requirements for credential access.
- Free and open source (MPL 2.0).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| HashiCorp Vault | BSL licence introduced in 2023 restricts use in competing products; OpenBao is the community continuation under MPL 2.0 |
| Doppler / Infisical (SaaS) | Not self-hosted; introduces an external dependency for a security-critical function |
| Kubernetes Secrets (base64 only) | Insufficient alone; no rotation, no audit, no dynamic secrets; acceptable as the injection mechanism downstream of OpenBao |
| AWS Secrets Manager | Cloud-specific; not self-hosted |

## Consequences

- All secrets are referenced by environment variable name in application code; the source of those values (`.env` file vs OpenBao) is transparent to the application.
- `.env.example` is committed to the repository; `.env` and all files matching `*.env*` (except `.example`) are gitignored.
- Production deployments use OpenBao with database secret engines configured for PostgreSQL credential rotation.
- The development Docker Compose stack does not include OpenBao; it is introduced in the production deployment configuration (Phase 11).
- Container images contain no secret values; the CI pipeline includes a secret-scanning step (Trivy + `git-secrets`) to prevent accidental commits.
