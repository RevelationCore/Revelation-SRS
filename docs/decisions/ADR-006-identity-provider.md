# ADR-006: Identity Provider

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §6 requires OAuth 2.0 / OIDC integration with institutional IAM systems, a local identity provider fallback, and RBAC role management. Principle §10 requires multi-tenant isolation where each institution (tenant) has independently managed users and roles. The identity provider must be self-hosted, open source, and deployable in Docker.

## Decision

**Keycloak** as the identity provider and authorisation server.

## Rationale

- De facto open source standard for enterprise IAM; battle-tested in large-scale deployments including UK HE institutions.
- Native OAuth 2.0 / OIDC authorisation server — integrates with institutional identity federations (ADFS, Azure AD, Shibboleth) via SAML 2.0 and OIDC federation.
- Multi-realm architecture maps directly to the multi-tenancy model (principle §10): each institution is a Keycloak realm with fully isolated users, roles, clients, and identity federation configuration.
- RBAC is managed in Keycloak realm roles and client roles; role claims are included in JWT tokens and consumed by the SRS authorisation layer.
- Local identity provider fallback is built in: Keycloak itself is an identity provider; service accounts for integrations are managed as Keycloak clients with client credentials flow.
- Admin REST API enables programmatic tenant (realm) provisioning as part of the tenant onboarding workflow.
- Free and open source (Apache 2.0 licence).

## Alternatives Considered

| Provider | Reason rejected |
|---|---|
| Authentik | Lighter than Keycloak; Python/Go; excellent UI; less mature multi-realm support; smaller enterprise adoption in UK HE |
| Zitadel | Go-based, lightweight; excellent multi-tenancy model; growing rapidly but less proven in UK HE federation contexts (Shibboleth) |
| Auth0 / Okta | SaaS; not self-hosted; not free at scale; violates open source requirement |
| Rolling own (JWT + local users only) | Insufficient for institutional IAM federation; would exclude a standard OIDC integration as a core feature |

## Consequences

- Each tenant (institution) is a Keycloak realm; realm provisioning is automated via the Keycloak Admin REST API as part of the tenant onboarding workflow.
- The SRS application registers as a Keycloak confidential client per realm; tokens are validated against the realm's OIDC discovery endpoint.
- Service-to-service integrations (internal modules, external connectors) use client credentials flow with scoped Keycloak clients.
- Keycloak is resource-intensive (JVM); on the Mac Mini development environment it runs alongside PostgreSQL, NATS, Temporal, and observability services. Memory allocation must be managed — Keycloak's `quarkus` distribution is used (lower footprint than legacy WildFly).
- Institutional identity federation (connecting to a university's existing Azure AD or Shibboleth IdP) is configured per realm and is outside the SRS application code.
