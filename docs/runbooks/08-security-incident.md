# Runbook 08 — Security Incident Response

---

## Scope

Use this runbook for:
- Suspected or confirmed unauthorised access to the SRS API or database
- Unusual access patterns detected (e.g., SAST/DAST findings in production)
- A HIGH or CRITICAL CVE discovered in a deployed container image
- A credential leak (database password, API key, JWT secret)

---

## Step 1 — Contain

**Do not wait for confirmation before containing a suspected breach.**

### If credentials may be compromised:

```bash
# Rotate database credentials via OpenBao (revoke and re-issue)
bao lease revoke -prefix database/creds/srs-api
bao lease revoke -prefix database/creds/srs-worker

# Rotate Keycloak client secret
# Admin UI → Realm: srs → Clients → srs-api → Credentials → Regenerate Secret
# Update in OpenBao:
bao kv put kv/srs/keycloak client_secret=<new-value>

# Force pod restart to pick up new secrets
kubectl rollout restart deployment/srs-api -n revelation-srs
```

### If a pod is behaving suspiciously:

```bash
# Isolate the pod via a deny-all network policy patch
kubectl label pod <pod-name> quarantine=true -n revelation-srs
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: quarantine-deny-all
  namespace: revelation-srs
spec:
  podSelector:
    matchLabels:
      quarantine: "true"
  policyTypes: [Ingress, Egress]
EOF
```

---

## Step 2 — Assess

1. Review the OTel traces for the suspicious time window in Grafana Tempo.
2. Check API access logs for anomalous request patterns:
   ```bash
   kubectl logs -l app.kubernetes.io/name=srs-api -n revelation-srs --since=2h \
     | jq 'select(.statusCode == 401 or .statusCode == 403)' \
     | jq -r '[.reqId, .url, .ip // "unknown"] | @tsv' | sort | uniq -c | sort -rn | head -20
   ```
3. Check database access logs for unexpected queries.
4. Check if any student personal data was exfiltrated (query audit log).

---

## Step 3 — Notify

**Personal data breach notification obligations (UK GDPR):**

- If personal data of UK data subjects has been breached, the Data Protection
  Officer must be notified **immediately**.
- If the breach is reportable, the ICO must be notified **within 72 hours** of
  becoming aware of it.
- Data subjects must be notified if there is a high risk to their rights and
  freedoms.

Contact: DPO at `dpo@example.com`

---

## Step 4 — Remediate

| Issue | Remediation |
|---|---|
| HIGH/CRITICAL CVE in deployed image | Patch the base image; rebuild; deploy via upgrade runbook |
| Compromised JWT secret | Rotate `JWT_SECRET`; all active sessions are invalidated |
| SQL injection found | Apply patch release immediately; check audit log for exploitation |
| RLS bypass | Check and repair PostgreSQL RLS policies; audit affected tables |

---

## Step 5 — Post-incident

1. Write a post-incident review within 5 business days.
2. Record the incident in the ISMS register.
3. Record the finding in the institution's current security assurance register if it
   affects NFR attestations.
4. File accepted-exception record if applicable.
