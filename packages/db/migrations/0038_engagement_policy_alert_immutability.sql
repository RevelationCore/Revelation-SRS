-- Increment D: policy definitions and alert evidence are immutable authorities.
-- Lifecycle changes close the current alert version and append a replacement.

CREATE FUNCTION engagement_protect_policy_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement policy versions are immutable; create a new version';
END;
$$;

CREATE TRIGGER engagement_policy_version_immutability_guard
  BEFORE UPDATE OR DELETE ON "engagement_policy_version"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_policy_version();

CREATE FUNCTION engagement_protect_alert_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement alert history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement alert versions are immutable';
  END IF;
  IF NEW.policy_version_id <> OLD.policy_version_id
    OR NEW.evidence_window_from <> OLD.evidence_window_from
    OR NEW.evidence_window_to <> OLD.evidence_window_to
    OR NEW.evidence_snapshot <> OLD.evidence_snapshot
    OR NEW.evidence_hash <> OLD.evidence_hash
    OR NEW.explanation <> OLD.explanation
  THEN
    RAISE EXCEPTION 'engagement alert evidence and explanation are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_alert_evidence_immutability_guard
  BEFORE UPDATE OR DELETE ON "engagement_alert"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_alert_evidence();
