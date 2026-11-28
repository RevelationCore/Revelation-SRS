-- 0006_document_scanning
--
-- ADR-030 (BL-339): every upload is scanned before it is stored, and only
-- clean or system-generated documents are served. The scan is recorded on
-- the row. Rows stored before scanning existed claimed 'clean' from a no-op
-- scanner, which means nothing: they become 'pending-scan' (refused on
-- download) until the one-off rescan clears them. Award documents are
-- rendered by the server and become 'system-generated'.
--
-- Idempotent: core and wellbeing may share the documents schema.

ALTER TABLE documents."document" ADD COLUMN IF NOT EXISTS "scanned_at" timestamptz;
ALTER TABLE documents."document" ADD COLUMN IF NOT EXISTS "scan_engine" text;
ALTER TABLE documents."document" ADD COLUMN IF NOT EXISTS "scan_database_version" text;
ALTER TABLE documents."document" ADD COLUMN IF NOT EXISTS "scan_signature" text;

UPDATE documents."document" SET "status_code" = 'system-generated'
  WHERE "owner_service" = 'award-documents' AND "status_code" <> 'system-generated';
UPDATE documents."document" SET "status_code" = 'pending-scan'
  WHERE "status_code" = 'clean' AND "scanned_at" IS NULL AND "owner_service" <> 'award-documents';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_status_code_check') THEN
    ALTER TABLE documents."document" ADD CONSTRAINT "document_status_code_check"
      CHECK ("status_code" IN ('pending-scan', 'clean', 'infected', 'system-generated'));
  END IF;
END $$;
