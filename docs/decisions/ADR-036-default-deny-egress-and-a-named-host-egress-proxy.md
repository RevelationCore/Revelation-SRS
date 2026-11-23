# ADR-036: Default-Deny Egress, and a Named-Host Egress Proxy

**Status**: Accepted. The engineering decision is final. The hosts each deployment may reach, and the cluster's network facts, are the institution's to supply (adoption checklist A-21 and A-22). Until then only the two product-known hosts below are allowed, and a production build with placeholder network facts is refused.
**Date**: 2026-11-23
**Follows**: [ADR-030](ADR-030-malware-scanning-of-uploaded-documents.md) (ClamAV and its signature downloads); [ADR-032](ADR-032-tenant-bound-service-identity-for-the-vle-connector.md) (the VLE connector); [ADR-035](ADR-035-service-metrics-and-alerts-that-can-fire.md) (the observability pods and the `EgressDenied` rule); [ADR-010](ADR-010-secrets-management.md) (OpenBao)
**Backlog**: BL-335; subsumes BL-350 (wellbeing egress); constrains BL-079 (email transport)
**Patterns**: P-09 (bound every outbound call), P-03 (deny by default), P-05 (refuse insecure configuration), P-06 (one configuration schema, checked against the deployment), P-19 (sensitive content), P-01 (test with production privileges)

## Context

What the repository shows (read 2026-11-23):

- **The API cannot reach GOV.UK in Kubernetes.**
  - `POST /calendar/non-working-days/import` (`apps/api/src/routes/non-working-days.ts:48`) fetches `https://www.gov.uk/bank-holidays.json` when the tenant's `calendar.bankHolidays.source` is `gov-uk`.
  - `allow-ingress-to-api` (`infra/k8s/base/network-policies.yaml`) declares `Egress` and lists only:
    - ClamAV 3310;
    - PostgreSQL, as `0.0.0.0/0:5432`;
    - NATS 4222 and Temporal 7233;
    - Keycloak, as `0.0.0.0/0:8080`;
    - wellbeing 3002 and attendance 3004;
    - OpenBao 8200;
    - DNS.

  So the call times out (BL-335, found in ADR-029 stage C).
- **Most pods have no egress control at all.** The only namespace-wide policy is `default-deny-ingress`. Egress is restricted only for `srs-api`, `srs-worker`, `srs-temporal`, `srs-temporal-ui` and `srs-clamav`. Every other workload can open a connection to any address on any port:
  - `srs-wellbeing`, which holds special-category data (BL-350);
  - `srs-attendance` and `srs-vle-adapter`;
  - both BFFs;
  - the SPAs;
  - NATS and the observability stack.
- **A wide 443 rule already exists.** `allow-ingress-to-clamav` allows `0.0.0.0/0:443` for freshclam's signature downloads. Its comment says NetworkPolicy cannot select by DNS name.
- **Every outbound call goes through one helper.** `fetchWithTimeout` (`packages/service-client/src/http.ts`), enforced by ESLint (P-09). Its call sites, from a grep of `apps/*/src`, `modules/*/src`, `adapters/*/src` and `packages/*/src`:

  | Caller | Destination | Where | External? |
  |---|---|---|---|
  | API bank-holiday import | `https://www.gov.uk/bank-holidays.json` | GOV.UK (CDN-fronted) | **yes** |
  | VLE connector, Moodle and Canvas drivers (`adapters/vle/src/vle-platforms/*-driver.ts`) | `VLE_ENDPOINT_URL`, set per deployment | the institution's VLE, often SaaS-hosted | **yes** |
  | API engagement proxy, health JWKS check; BFF API and wellbeing proxy, OIDC token and revoke; wellbeing reconciliation; attendance clients; VLE connector's SRS client; service token provider | `srs-api`, `srs-wellbeing`, `srs-attendance`, `keycloak:8080` | in cluster, or the institution's Keycloak | no (see A-22 for Keycloak) |
  | API progression document signer | OpenBao Transit, 8200 | the `openbao` namespace | no |
  | Wellbeing EDRMS adapter | `edrms-simulator.local`, a placeholder | simulator only; BL-102 is undecided | not yet |

  Outside the code:

  | Caller | Destination | Notes |
  |---|---|---|
  | ClamAV `freshclam` (`infra/k8s/base/clamav.yaml`) | `database.clamav.net:443` | |
  | Alertmanager (ADR-035) | the institution's webhook receivers | |
- **Email has no real transport yet.** `apps/api/src/config.ts` accepts only `EMAIL_TRANSPORT=fake` (BL-079). When it is built, both the API (staff email) and the worker (`adjustmentTaskNoticeService.sendAll()` in `worker.ts`) send mail.
- **There are no regulator endpoints.** HESA, UCAS, UKVI SMS, SLC and SAAS flows are delivery-ledger items, fulfilled as `manual`, `file` or as a NATS event for a connector (`apps/api/src/platform/delivery/delivery-service.ts`, `docs/integrations/outbound-delivery.md`). Live links (BL-045, BL-047) are future, separate connectors.
- **Kubernetes NetworkPolicy has no host names.** It matches IP blocks, pods and namespaces only. Domain-name egress exists only in CNI-specific resources:
  - Cilium's FQDN policies;
  - GKE's `FQDNNetworkPolicy`;
  - EKS's VPC CNI;
  - Calico's own policy resources.

  The upstream FQDN selector (NPEP-133) is experimental and limited to `AdminNetworkPolicy`. `www.gov.uk` and hosted VLEs sit behind CDNs whose addresses change, so an `ipBlock` per host is not workable.
- **Node can use a proxy, but not by default.** Node's built-in `fetch` honours `HTTPS_PROXY` only with `NODE_USE_ENV_PROXY=1`, from Node 22.21.0. The images use the floating `node:22-bookworm-slim` tag.
- **Stage.** Alpha and pre-production. A default-deny egress policy will break any call nobody listed, so the cheapest time to adopt it is now.

## Decision

1. **Egress is denied by default for every pod in the namespace.**
   - A new policy, `default-deny-egress` (`podSelector: {}`, `policyTypes: [Egress]`), sits next to `default-deny-ingress`.
   - Every workload then has its own egress policy. Each one lists exactly the destinations in the matrix below, and nothing else.
   - **DNS** is narrowed from "any pod in any namespace on 53" to `kube-system` pods labelled `k8s-app: kube-dns`. An overlay may change the selector.

   | Workload | DNS | PostgreSQL 5432 | NATS 4222 | Temporal 7233 | Keycloak 8080 | OpenBao 8200 | In-cluster services | Tempo 4318 | Egress proxy listener |
   |---|---|---|---|---|---|---|---|---|---|
   | srs-api | yes | yes | yes | yes | yes | yes | wellbeing 3002, attendance 3004, clamav 3310 | yes | `api` 3128 |
   | srs-worker | yes | yes | yes | yes | yes | yes | clamav 3310 | yes | `worker` 3129 |
   | srs-wellbeing | yes | yes | yes | | yes | yes | srs-api 3000, clamav 3310 | yes | none |
   | srs-attendance | yes | yes | yes | | yes | yes | srs-api 3000 | yes | none |
   | srs-vle-adapter | yes | yes | yes | | yes | yes | srs-api 3000 | yes | `vle-adapter` 3130 |
   | srs-admin-bff, srs-portal-bff | yes | yes | | | yes | yes | srs-api 3000, wellbeing 3002 | yes | none |
   | srs-admin, srs-portal | yes | | | | | | their BFF 3010 | | none |
   | srs-temporal, srs-temporal-ui | unchanged | | | | | | | | none |
   | srs-nats | yes | | | | | | peers 6222 | | none |
   | srs-nats-streams (Job) | yes | | yes | | | | | | none |
   | srs-clamav | yes | | | | | | | | `clamav` 3131 |
   | srs-prometheus | yes | | | | | | scrape ports (ADR-035), alertmanager 9093, the Kubernetes API (A-22) | | none |
   | srs-alertmanager | yes | | | | | | the SMTP relay at a declared address, if email receivers are used | | `alertmanager` 3132 |
   | srs-grafana | yes | | | | | | prometheus 9090, loki 3100, tempo 3200, alertmanager 9093 | | none |
   | srs-loki | yes | | | | | | alertmanager 9093 | | none |
   | log collector (Promtail, then Alloy) | yes | | | | | | loki 3100, the Kubernetes API (A-22) | | none |
   | srs-tempo | yes | | | | | | | | none |
   | srs-egress-proxy | yes | | | | | | | | none; see item 3 |

   - The existing `0.0.0.0/0` rules for PostgreSQL and Keycloak are kept for now. Each overlay narrows them to the declared addresses (A-22, BL-433).
   - The ClamAV `0.0.0.0/0:443` rule is removed.

2. **Every outbound call to the internet goes through one egress proxy.** The proxy allows only named hosts, per calling service.
   - **What it is.** `srs-egress-proxy` is a Squid forward proxy. Its image is built in this repository (`infra/docker/egress-proxy/Dockerfile`) from Debian stable's `squid` package, and pinned and scanned like the other images (NFR-SEC-007, NFR-OPS-006). It runs as a non-root user with a read-only root filesystem and no cache.
   - **Deployment.** Two replicas with topology spread, and a PDB in production. A Service publishes one port per client.
   - **One listener per client.** Squid `http_port <port> name=<client>` with `acl l_<client> myportname <client>`, for the clients `api` 3128, `worker` 3129, `vle-adapter` 3130, `clamav` 3131 and `alertmanager` 3132. The proxy's ingress policy admits each client pod on its own port only, so a pod cannot borrow another client's list.
   - **Tunnels only.** Only `CONNECT` is allowed, to port 443, plus 587 for a client's `-smtp` list. TLS is end to end: the proxy never decrypts or sees content, which matters for special-category data and for client-certificate (mTLS) APIs. Plain-HTTP proxying is denied.
   - **The allow-lists are files.** A ConfigMap `srs-egress-allowlist` holds one file per client, `<client>.txt` and `<client>-smtp.txt`, with one exact host name per line. It is loaded as `acl <client>_hosts dstdomain "/etc/squid/allow/<client>.txt"`.
   - **Always denied:**
     - IP-literal destinations;
     - destinations that resolve into the cluster's pod or service CIDRs (`acl to_cluster dst`, from A-22);
     - anything not allowed by a rule. The configuration ends with `http_access deny all`.
   - **Logs.** Each request is logged to stdout as one JSON line: `{"event":"egress.request","client":"<listener name>","host":"<CONNECT host>","port":<port>,"status":"<Squid status>","code":<HTTP code>}`. No paths and no bodies are logged; a tunnel has neither.

3. **The proxy's own egress is the one broad rule.** It is `ipBlock 0.0.0.0/0`, with `except` the pod CIDR, the service CIDR and the RFC 1918 ranges the institution does not route to, on ports 443 and 587, plus DNS.
   - The control point moves from a pod that holds data and credentials to a pod that holds neither and enforces names.
   - An institution with a perimeter egress firewall, or a mandated upstream proxy (Squid `cache_peer`, A-22), can narrow it further.

4. **How allowed hosts are declared.**
   - **Base carries the product-known hosts only:**
     - `api.txt`: `www.gov.uk`. Remove it if every tenant uploads the file instead.
     - `clamav.txt`: `database.clamav.net`. Replace it if the overlay points freshclam at a private mirror (ADR-030).
   - All other lists are empty. That is the default deny.
   - **Each overlay patches `srs-egress-allowlist` with the institution's hosts** (A-21):
     - the VLE host from `VLE_ENDPOINT_URL`, in `vle-adapter.txt`;
     - the email provider's API host, or the SMTP submission host in `api-smtp.txt` and `worker-smtp.txt`, when BL-079 is built;
     - the alert webhook hosts, in `alertmanager.txt`.
   - **The list is per deployment, not per tenant.** Network reach is a platform decision, reviewed as a change to the overlay. A tenant administrator who edits an integration registration's endpoint cannot widen it. This is also the SSRF control for any tenant-configured URL. In a shared deployment, per-tenant separation still comes from per-tenant credentials (ADR-032); the network list does not provide it.
   - **Exact names only.** No leading-dot wildcards and no IP addresses in staging or production. A subdomain is a separate line.

5. **Services opt in to the proxy for external calls; in-cluster calls stay direct.**
   - **The helper.** `packages/service-client` gains `externalFetch(url, init, timeoutMs)`. It:
     - uses `undici`'s `fetch` with a `ProxyAgent` for `SRS_EGRESS_PROXY_URL`;
     - applies the same timeout semantics as `fetchWithTimeout`;
     - in production, refuses `http:` URLs and refuses to run without `SRS_EGRESS_PROXY_URL`;
     - in development and test, without the variable, connects directly, so compose needs no proxy.
   - **Why not the environment.** `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1` is not used. It would send every in-cluster call through the proxy unless `NO_PROXY` matched every internal name exactly, and a missed name fails silently to the wrong place.
   - **Its callers.**
     - The bank-holiday import and the Moodle and Canvas drivers (as their default `fetchImpl`).
     - Later, the BL-079 email transport. It is either an HTTPS API through `externalFetch`, or SMTP submission through the proxy's CONNECT to 587 (nodemailer supports HTTP CONNECT proxies), or a relay at a declared fixed address on 587 (an `ipBlock` /32 in the overlay).
     - Later, any regulator connector. Each future connector is a separate client with its own listener, list and register line, decided in the ADR that builds it.
   - **Configuration.** `SRS_EGRESS_PROXY_URL` enters the config schemas of `srs-api`, `srs-worker` and `srs-vle-adapter` (P-06). In production each refuses to start without it (P-05). Base sets it per Deployment to `http://srs-egress-proxy:<its port>`.
   - **Configuring other software.**
     - ClamAV: `HTTPProxyServer srs-egress-proxy` and `HTTPProxyPort 3131` in `freshclam.conf`.
     - Alertmanager: `http_config.proxy_url: http://srs-egress-proxy:3132` on each webhook receiver.
   - **A denial is reported clearly.** The proxy answers a denied CONNECT with 403. `externalFetch` turns that into an `EgressDeniedError` naming the host. The import route answers 502 with the problem type `https://srs.example.com/errors/egress-denied`, so an administrator sees "this host is not allowed for this deployment" rather than a timeout.

6. **The egress register.** `docs/integrations/egress-register.md` has one row per external destination, giving:
   - client;
   - purpose;
   - host, or "institution-supplied" and its variable;
   - port;
   - the calling file;
   - the ADR or backlog item.

   It starts with the five rows in the Context table. A test keeps it, the code and the base allow-lists in step (see Guard).

7. **Monitoring.** A Loki rule, `EgressDenied` (warning), under ADR-035's guard:

   ```
   sum by (client, host) (count_over_time({app="srs-egress-proxy"} | json | event="egress.request" | status=~"TCP_DENIED.*" [10m])) > 0
   ```

   A denial means either a missing allow-list entry or an attempt to reach somewhere the deployment does not use. The operator should look at both.

## Rationale

- **It works on any conformant cluster.** The base must run on whatever CNI the institution uses. Standard NetworkPolicy plus a proxy does. FQDN policies tie the base to Cilium, Calico, GKE or EKS. An institution may add those as an extra layer, but the base does not depend on them.
- **Names, not addresses.** GOV.UK and hosted VLEs move between CDN addresses. A proxy checks the name the client asked for, at connection time.
- **The fewest new parts that give per-service lists.** One small stateless Deployment, with one listener per client, enforced by the NetworkPolicy the system already uses. Squid is old, boring and packaged by Debian. It needs no mesh, no CRDs and no TLS interception.
- **Secure by default, and loud when it fails.** A call nobody declared fails at once, with a 403 and an alert. It does not quietly succeed. The wide 443 rule moves from ClamAV to a pod with no data and no secrets.
- **Explicit beats ambient.** `externalFetch` makes "this call leaves the cluster" visible in review and checkable by a test, as `fetchWithTimeout` did for timeouts (P-09).

## Options considered

| Option | Verdict |
|---|---|
| Do nothing | Rejected. The bank-holiday import, the VLE connector in a cluster with egress control, and real email cannot work. Seven workloads keep unrestricted egress |
| Open `0.0.0.0/0:443` on the API (and the others that need it) | Rejected. A compromised pod holding student records could send them anywhere. BL-335 rules it out |
| `ipBlock` per named host | Rejected. CDN-fronted hosts change address without notice, and the policy would fail silently |
| CNI FQDN policies (Cilium FQDN policies, GKE `FQDNNetworkPolicy`, EKS, Calico) in base | Rejected for base: it is CNI-specific, and the upstream selector is experimental. Allowed as an institution's extra layer |
| A service mesh egress gateway (Istio or similar) | Rejected. It adds a mesh, sidecars or ambient mode, and CRDs, to filter a handful of hosts |
| Envoy as the forward proxy | Considered. It is capable, but its configuration for CONNECT with per-listener allow-lists is far larger than Squid's. Reconsider if the platform already runs Envoy |
| Smokescreen | Considered. It is purpose-built, with good SSRF defaults, but less widely packaged and supported than Squid |
| A Squid forward proxy with per-client listeners, CONNECT only, named-host lists | **Chosen** |
| Route every call through the proxy with `HTTPS_PROXY`, `NODE_USE_ENV_PROXY=1` and `NO_PROXY` | Rejected. In-cluster calls depend on `NO_PROXY` matching every internal name, and a miss sends the call to the proxy |
| Per-tenant allow-lists set by tenant administrators | Rejected. Network reach is a platform control, and tenant-editable lists would make the SSRF control tenant-editable too |

## Consequences

- **Breaking changes, acceptable at Alpha:**
  - workloads that relied on open egress lose it;
  - the ClamAV 443 rule goes;
  - DNS egress is narrowed.

  A missing rule shows up as a timeout to an in-cluster service, or as a 403 from the proxy. Staging catches both before production.
- **The bank-holiday import works in Kubernetes** once BL-430 and BL-431 are deployed, because `www.gov.uk` is in base.
- **One more Deployment.** If both proxy replicas are down, external calls fail. Nothing on the record-serving path depends on an external host. The import, VLE instructions (retried by the connector), signature updates (ClamAV keeps its current database) and webhook alerts degrade, and recover when the proxy returns.
- **The institution must supply network facts** (A-22): the pod and service CIDRs, the Kubernetes API address for Prometheus and the log collector, and the PostgreSQL and Keycloak addresses. A production build with the placeholders is refused.
- **BL-350 is delivered by BL-429** and closes with it.
- **BL-079 is constrained.** The email transport must use `externalFetch`, CONNECT through the proxy, or a declared relay address. The row says so.
- **Node version.** `undici`'s `ProxyAgent` does not depend on Node's env-proxy support. The Node 22 floor is unchanged.

## Guard

1. **`check:k8s` additions** (`scripts/check-k8s.mjs`), for base and every overlay:
   - `default-deny-egress` exists, with `podSelector: {}` and `policyTypes: [Egress]`.
   - Every Deployment, StatefulSet, DaemonSet and Job in the namespace is selected by at least one other NetworkPolicy whose `policyTypes` include `Egress`.
   - No egress rule anywhere has an `ipBlock` of `0.0.0.0/0` or `::/0` on port 443 or on all ports, except `allow-srs-egress-proxy-egress`. That rule must carry `except` entries, and in staging and production they must not be the base placeholders.
   - The other `0.0.0.0/0` rules are allowed only on 5432 and 8080, and only until BL-433. In production they must be narrowed.
   - Every container that sets `SRS_EGRESS_PROXY_URL` points at `srs-egress-proxy` on its client's port. Its pod's egress policy admits exactly that port. The proxy's ingress policy admits that pod on that port and no other.
   - Every line of every allow-list file is an exact host name: no IP literal, no leading dot, no `*`. This applies in staging and production.
   - The host of every `VLE_ENDPOINT_URL` in a staging or production build is listed in `vle-adapter.txt`.
   - `srs-egress-proxy` spreads across nodes and zones, and production has `srs-egress-proxy-pdb`.
   - `freshclam.conf` sets `HTTPProxyServer`.
   - Every Alertmanager webhook receiver sets `proxy_url`.
2. **The proxy has no code of ours, so its configuration is tested as deployed.** `infra/docker/egress-proxy/test/squid.int.test.ts` (testcontainers, with the built image, the base `squid.conf` and test allow-lists) asserts that:
   - an allowed CONNECT on 443 is tunnelled;
   - an unlisted host, an IP literal, port 80 and plain-HTTP proxying are each refused with 403;
   - a host on another client's list is refused on this client's listener;
   - a name resolving into a `to_cluster` range is refused;
   - an empty list denies everything;
   - each request writes one `egress.request` JSON line.
3. **`packages/service-client/test/external-fetch.test.ts`** uses an in-process CONNECT proxy and asserts that:
   - calls go through the proxy;
   - a 403 becomes `EgressDeniedError`;
   - `http:` URLs are refused in production;
   - the call is refused in production without `SRS_EGRESS_PROXY_URL`;
   - the timeout still applies.
4. **The register test** (`apps/api/test/architecture/egress-register.test.ts`) asserts that:
   - every file that calls `externalFetch` appears in `docs/integrations/egress-register.md`;
   - every register row's file calls it;
   - every product-known host in the register is in the matching base allow-list, and nothing else is.
5. **Each service's config test** asserts the production refusal without `SRS_EGRESS_PROXY_URL` (api, worker, vle-adapter).

## Follow-up work

| ID | Title | Type | Area | Priority | Size |
|---|---|---|---|---|---|
| BL-429 | `default-deny-egress` and an egress policy per workload, from the ADR-036 matrix; DNS narrowed to kube-dns; ClamAV's `0.0.0.0/0:443` removed (delivers BL-350) | Defect | Infrastructure | P1 | M |
| BL-430 | Egress proxy: Debian Squid image, `egress-proxy.yaml` (two replicas, spread, per-client listeners, CONNECT-only, `srs-egress-allowlist`, JSON access log), production PDB; freshclam and Alertmanager through it; `EgressDenied` Loki rule | Feature | Infrastructure | P1 | M |
| BL-431 | `externalFetch` (undici `ProxyAgent`, https only and proxy required in production, `EgressDeniedError`); `SRS_EGRESS_PROXY_URL` in the api, worker and VLE connector configs; the bank-holiday import (502 `egress-denied`) and the Moodle and Canvas drivers use it; `docs/integrations/egress-register.md` | Feature | Integrations | P1 | S |
| BL-432 | Egress guards: `check:k8s` rules (default deny, per-workload egress, no wide `ipBlock` outside the proxy, client and listener consistency, allow-list syntax, VLE host listed, placeholders refused in production), Squid testcontainer test, `externalFetch` test, register test, config refusal tests | Test | Infrastructure | P1 | M |
| BL-433 | Narrow the PostgreSQL (5432) and Keycloak (8080) `0.0.0.0/0` egress rules to the addresses each overlay declares (A-22) | Improvement | Infrastructure | P2 | S |
| BL-434 | Runbook: "egress denied" and "allow a new host" in `docs/runbooks/03-integration-outage.md`; the admin bank-holiday import shows the `egress-denied` message | Docs | Documentation | P2 | S |

BL-429 to BL-432 are go-live Tier 1. Without them, an integration that is needed for go-live cannot run in Kubernetes. Without them, seven workloads also have unrestricted egress.
