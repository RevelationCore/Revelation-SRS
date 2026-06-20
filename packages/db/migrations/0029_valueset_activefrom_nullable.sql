-- Revelation SRS — Make value_set_member.active_from nullable
-- Migration: 0029_valueset_activefrom_nullable
--
-- Bitemporal alignment: NULL active_from means "valid from the beginning of
-- time" (open-ended start), consistent with NULL active_to meaning "valid
-- forever" (open-ended end).  Previously active_from was NOT NULL defaultNow(),
-- which forced every member to record the insert timestamp as a lower bound —
-- semantically incorrect for platform-seeded codes that have always been valid.
--
-- Changes:
--   1. Drop the NOT NULL constraint and default from active_from.
--   2. Set active_from = NULL for all platform-managed members (tenant_id IS NULL)
--      because these codes are definitionally valid from the beginning.
--   3. Tenant-owned members retain their existing timestamp (they were explicitly
--      created at a known point in time; NULL would misrepresent their provenance).

ALTER TABLE "value_set_member"
  ALTER COLUMN "active_from" DROP NOT NULL,
  ALTER COLUMN "active_from" DROP DEFAULT;

UPDATE "value_set_member"
SET    "active_from" = NULL
WHERE  "tenant_id" IS NULL;
