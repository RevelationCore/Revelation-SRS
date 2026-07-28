-- Revelation SRS — Engagement outcome sponsor-compliance evidence fields
-- Migration: 0043_engagement_outcome_sponsor_evidence
--
-- The UKVI sponsor-compliance evidence-snapshot flow
-- (apps/api/src/platform/regulatory/ukvi-service.ts:createEngagementEvidenceSnapshot)
-- used to join core's own engagement_alert/engagement_intervention_case/
-- engagement_referral tables directly. Those tables moved to the attendance
-- module in migration 0042. This adds the fields the attendance module now
-- hands off via POST /students/:personId/engagement-outcomes (outcomeCode
-- 'referred-sponsor-compliance') so core can create the evidence snapshot
-- from its own authoritative record instead of a cross-schema join.

ALTER TABLE "engagement_outcome"
  ADD COLUMN "policy_version_id"      uuid,
  ADD COLUMN "evidence_window_from"   timestamptz,
  ADD COLUMN "evidence_window_to"     timestamptz,
  ADD COLUMN "evidence_snapshot"      jsonb,
  ADD COLUMN "evidence_hash"          text,
  ADD COLUMN "reevaluation_required"  boolean;
