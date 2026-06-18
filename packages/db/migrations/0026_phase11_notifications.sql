-- Phase 11 Stage 5 — In-app notification table
-- Stores persistent notifications delivered to students via SSE and displayed
-- in the NotificationsPage.  Each row is tenant-scoped and person-scoped.

CREATE TABLE IF NOT EXISTS "notification" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID        NOT NULL REFERENCES "tenant"("id"),
  "person_id"   UUID        NOT NULL,
  "category"    TEXT        NOT NULL,   -- e.g. 'adjustment', 'ec', 'enrolment', 'general'
  "title"       TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "link_url"    TEXT,                   -- optional deep link
  "read_at"     TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_person_idx"
  ON "notification"("tenant_id", "person_id", "created_at" DESC);

CREATE INDEX "notification_unread_idx"
  ON "notification"("tenant_id", "person_id")
  WHERE "read_at" IS NULL;
