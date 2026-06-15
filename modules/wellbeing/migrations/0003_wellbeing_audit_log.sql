-- Stage 3: Audit log for special-category data access
--
-- Append-only record of every read, write, and export operation on special-
-- category wellbeing data (disability cases, DSA entitlements, evidence).
-- Required for Equality Act compliance and data-protection audit obligations.

CREATE TABLE wellbeing.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  actor_id      text        NOT NULL,
  action_code   text        NOT NULL,   -- read | write | export
  resource_type text        NOT NULL,   -- disability-case | dsa-entitlement | evidence
  resource_id   uuid        NOT NULL,
  person_id     uuid        NOT NULL,
  context       jsonb       NOT NULL DEFAULT '{}',
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wellbeing.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON wellbeing.audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX audit_log_tenant_person ON wellbeing.audit_log (tenant_id, person_id);
CREATE INDEX audit_log_resource      ON wellbeing.audit_log (tenant_id, resource_type, resource_id);
