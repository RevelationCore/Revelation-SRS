-- 0028 — Overdue notices for the manual adjustment task queue
--
-- An overdue flag on the queue page only helps if someone opens it. Each
-- target can now name a team mailbox; the worker's reconcile loop sends that
-- mailbox at most one overdue digest per target per day, through the
-- communications dispatch log (the SRS records what to send; an external
-- service delivers it, behind communications.channel.email.enabled). The
-- digest carries counts and a link to the queue, never student details.

ALTER TABLE "adjustment_target_config"
  ADD COLUMN IF NOT EXISTS "notify_email"           text,
  ADD COLUMN IF NOT EXISTS "last_overdue_notice_at" timestamptz;

INSERT INTO "communication_template" (
  "id", "tenant_id", "template_key", "channel_code", "locale_code",
  "subject_template", "body_template", "version", "active", "created_by"
)
VALUES
  (gen_random_uuid(), NULL,
   'adjustment-tasks.overdue', 'email', 'en-GB',
   '{overdueCount} overdue {targetLabel} adjustment tasks',
   'There are {overdueCount} reasonable-adjustment tasks for {targetLabel} waiting longer than {alertAfterHours} hours ({openCount} open in total; the oldest has waited since {oldestDueSince}). Approved adjustments are not in effect for these students until someone applies them and confirms it. Open the queue: {queueUrl}',
   1, true, 'system')
ON CONFLICT DO NOTHING;
