-- Reasonable adjustments production hardening: trace a distributed
-- reasonable_adjustment record back to the wellbeing module case that
-- approved it. Opaque cross-service reference (wellbeing module has its
-- own database) — not a foreign key.

ALTER TABLE "reasonable_adjustment" ADD COLUMN "source_case_id" uuid;
