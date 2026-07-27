-- Increment E: durable idempotency and append-only intervention evidence.

ALTER TABLE "engagement_intervention_case" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_contact_attempt" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_action" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_referral" ADD COLUMN "idempotency_key" text;

UPDATE "engagement_contact_attempt" SET "idempotency_key" = 'legacy-contact:' || "id"::text;
UPDATE "engagement_action" SET "idempotency_key" = 'legacy-action:' || "id"::text;
UPDATE "engagement_referral" SET "idempotency_key" = 'legacy-referral:' || "id"::text;

ALTER TABLE "engagement_contact_attempt" ALTER COLUMN "idempotency_key" SET NOT NULL;
ALTER TABLE "engagement_action" ALTER COLUMN "idempotency_key" SET NOT NULL;
ALTER TABLE "engagement_referral" ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX "engagement_case_idempotency_unique"
  ON "engagement_intervention_case" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "engagement_contact_idempotency_unique"
  ON "engagement_contact_attempt" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "engagement_action_idempotency_unique"
  ON "engagement_action" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "engagement_referral_idempotency_unique"
  ON "engagement_referral" ("tenant_id", "idempotency_key");

CREATE FUNCTION engagement_protect_case_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement intervention history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement intervention versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_case_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_intervention_case"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_history();

CREATE FUNCTION engagement_protect_case_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement case evidence is append-only';
END;
$$;
CREATE TRIGGER engagement_contact_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_contact_attempt"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_evidence();
CREATE TRIGGER engagement_referral_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_referral"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_evidence();
