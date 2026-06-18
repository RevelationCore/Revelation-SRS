# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Send a report by email to **security@revelation-srs.org** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (where safe to share).
- The version(s) and component(s) affected.
- Any mitigations you are aware of.

### What to expect

| Milestone | Target |
|---|---|
| Acknowledgement | Within 72 hours |
| Triage and severity assessment | Within 7 days |
| Fix or mitigation plan communicated | Within 30 days for Critical/High |
| Public disclosure | After fix is available and affected users have had reasonable notice |

We follow coordinated disclosure. We will credit reporters in the release notes unless you prefer to remain anonymous.

## Severity assessment

We use the [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) base score scale:

| Score | Rating |
|---|---|
| 9.0–10.0 | Critical |
| 7.0–8.9 | High |
| 4.0–6.9 | Medium |
| 0.1–3.9 | Low |

Critical and High findings will be prioritised ahead of all other work.

## Scope

In scope:

- `apps/api` — REST API and authentication middleware
- `apps/portal` and `apps/admin` — frontend applications
- `modules/wellbeing` and `adapters/vle` — first-party modules and adapters
- `packages/` — shared domain, UI, and migration tooling
- Infrastructure configuration (`infra/k8s/`, `infra/docker/`)

Out of scope:

- Third-party dependencies (report to the upstream maintainer; we will apply patches promptly)
- Social engineering attacks against project contributors
- Physical attacks

## Security contacts

Primary: security@revelation-srs.org

For PGP-encrypted reports, a public key will be published at `docs/security-pgp-key.asc` when available.
