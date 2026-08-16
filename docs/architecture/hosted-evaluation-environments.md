# Hosted Disposable Evaluation Environments

> Status: Decision-ready proposal; implementation deferred

## Decision sought

Approve a disposable, fictional-data evaluation environment per release candidate or explicitly requested pull request, with a bounded lifetime and a visible Alpha/Demo identity.

## Proposed shape

- Build immutable API, admin and portal images from one commit.
- Allocate an isolated PostgreSQL database, Keycloak realm and supporting service namespace.
- Apply migrations and one named deterministic demo scenario.
- Expose HTTPS URLs through time-limited authenticated access.
- Destroy compute, database and identity state automatically after 72 hours unless renewed.
- Retain only redacted health/test evidence under the CI artifact retention policy.

## Controls

- Fictional generated data only; block migration/import tools and production integration endpoints.
- Environment and tenant IDs displayed in every application banner.
- Reset endpoint restricted to the environment owner and guarded by demo-mode assertions.
- No shared credentials with production; secrets issued per environment.
- Rate, cost and concurrency limits with an owner tag and expiry timestamp.
- Central health/usage telemetry without capturing sensitive form content.

## Options

| Option | Benefit | Cost/risk |
|---|---|---|
| Kubernetes namespace per environment | Closest to target deployment and strong isolation | Highest operational complexity |
| Compose on an ephemeral VM | Mirrors local evaluation and is easy to diagnose | Coarser isolation and slower provisioning |
| Managed preview platform plus managed PostgreSQL | Fast frontend previews | Supporting Keycloak, Temporal and NATS consistently is harder |

Recommendation: begin with an ephemeral VM/Compose proof of concept, measure provisioning time and appraisal demand, then adopt Kubernetes namespaces when repeated concurrency justifies it.

## Acceptance experiment

Provision one release-candidate environment, run the three appraisal journeys, reset it, verify no production endpoints are reachable, allow it to expire automatically, and confirm that only redacted evidence remains.
