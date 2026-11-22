# 10 — Document Scanning

Every uploaded document is scanned for malware by ClamAV before it is stored, and a document that has not passed the scan is never served ([ADR-030](../decisions/ADR-030-malware-scanning-of-uploaded-documents.md)).

## How it works

- **The scanner.** `srs-clamav` runs clamd as a cluster service on TCP 3310, with 2 replicas. `srs-api`, `srs-worker` and `srs-wellbeing` call it. Network policy `allow-ingress-to-clamav` admits only those three.
- **Signatures.** freshclam refreshes them every 2 hours. Each pod is seeded from the image at start, so it does not wait on the mirror.
- **If the scanner cannot answer, uploads are refused** with 503 and `Retry-After: 60`. Everything else keeps working, and `/ready` does not depend on the scanner.
- **An infected upload** is refused with 422. Its metadata and signature name are kept with no content, and the log event `documents.upload.rejected` is written.
- **A document that has not passed** (`pending-scan` or `infected`) is refused on download with 409.

## First rollout, and after restoring an old backup

Documents stored before scanning existed are marked `pending-scan` by the migration, and are refused on download until they are rescanned.

1. Deploy `srs-clamav` and wait until both pods are ready:
   `kubectl -n revelation-srs rollout status deployment/srs-clamav`.
   - A pod can take several minutes to load signatures. The startup probe allows 10 minutes.
2. Migrate and deploy the services.
3. Rescan, once for core and once for wellbeing:
   ```sh
   kubectl -n revelation-srs exec deploy/srs-worker    -- node dist/rescan-documents.js --all-tenants
   kubectl -n revelation-srs exec deploy/srs-wellbeing -- node dist/rescan-documents.js --all-tenants
   ```
   - Each prints a `documents.rescan.summary` line per tenant: `checked`, `clean`, `infected` and `failed`.
   - The command is idempotent. A non-zero exit means some documents could not be scanned; they stay `pending-scan`, and a later run retries them.
   - Record the summaries in the release notes.

## When an alert fires

The two alert rules are not yet in Grafana (backlog BL-344). Until they are, search Loki for the events below.

**`DocumentMalwareDetected`** (log events `documents.upload.rejected` or `documents.rescan.infected`):

1. The event names the tenant, owner service and reference, the actor, the checksum and the signature. It never names the file.
2. A signature that starts `Heuristics.Encrypted` or `Heuristics.OLE2.ContainsMacros` is policy: a password-protected file, or a document with macros. The uploader has already been told to remove the password or macros. No incident is needed unless it repeats.
3. Any other signature is a possible malware upload. Follow [08 — Security Incident](08-security-incident.md). The content was never stored, so there is nothing to remove.

**`DocumentScannerUnavailable`** (more than 5 `documents.scanner.unavailable` events in 10 minutes):

1. `kubectl -n revelation-srs get pods -l app.kubernetes.io/name=srs-clamav`, then check the logs for signature load or memory errors. A reload needs up to 4 GiB.
2. `cause: timeout` with healthy pods means the scanner is saturated. Check CPU, then consider more replicas.
3. `cause: connection` means clamd is down or the network policy changed.
4. Uploads recover on their own once clamd answers. Nothing needs replaying.

## Where clamd cannot run

Set `DOCUMENT_SCANNER=reject`. Uploads are then refused (503, "not available in this environment") and nothing unscanned is stored. `noop` is refused outside development and test.

## Keeping ClamAV current

The image is pinned by digest in each overlay (`clamav/clamav`, 1.5 line). Refresh the digest at least monthly. ClamAV may stop serving signatures to a patch release four months after a newer one ships.
