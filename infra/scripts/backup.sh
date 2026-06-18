#!/usr/bin/env bash
# backup.sh — Revelation SRS daily PostgreSQL backup script
#
# Usage:
#   ./backup.sh [--db-url <url>] [--output-dir <path>] [--gpg-recipient <key-id>]
#
# Environment variables (override CLI flags):
#   DATABASE_URL         — PostgreSQL connection URL
#   BACKUP_OUTPUT_DIR    — local path to write backup archives (default: /var/backups/srs)
#   GPG_RECIPIENT        — GPG key ID or email for encryption (required unless --no-encrypt)
#   S3_BUCKET            — (optional) upload to s3://bucket/path after local backup
#   RETENTION_DAYS       — how many local backups to retain (default: 7)
#
# Backup file naming:
#   srs-backup-<YYYYMMDD-HHMMSS>.sql.gz.gpg  (encrypted)
#   srs-backup-<YYYYMMDD-HHMMSS>.sql.gz       (unencrypted, for dev)
#
# Exit codes:
#   0  success
#   1  pg_dump failed
#   2  GPG encryption failed
#   3  S3 upload failed (non-zero but backup written locally)
#
# RTO/RPO:
#   RPO target: ≤ 1 hour (achieved via this script scheduled hourly + WAL archiving)
#   RTO target: ≤ 4 hours (restore procedure in restore.sh)

set -euo pipefail

# ── Defaults ───────────────────────────────────────────────────────────────────
BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-/var/backups/srs}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
NO_ENCRYPT="${NO_ENCRYPT:-false}"
TIMESTAMP="$(date -u '+%Y%m%d-%H%M%S')"
BACKUP_BASENAME="srs-backup-${TIMESTAMP}"
LOG_PREFIX="[srs-backup ${TIMESTAMP}]"

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)       DATABASE_URL="$2"; shift 2 ;;
    --output-dir)   BACKUP_OUTPUT_DIR="$2"; shift 2 ;;
    --gpg-recipient) GPG_RECIPIENT="$2"; shift 2 ;;
    --s3-bucket)    S3_BUCKET="$2"; shift 2 ;;
    --no-encrypt)   NO_ENCRYPT=true; shift ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validation ─────────────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: DATABASE_URL is required" >&2
  exit 1
fi

if [[ "${NO_ENCRYPT}" != "true" && -z "${GPG_RECIPIENT:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: GPG_RECIPIENT is required (or use --no-encrypt for non-production)" >&2
  exit 1
fi

# ── Prepare output directory ───────────────────────────────────────────────────
mkdir -p "${BACKUP_OUTPUT_DIR}"
DUMP_FILE="${BACKUP_OUTPUT_DIR}/${BACKUP_BASENAME}.sql.gz"

echo "${LOG_PREFIX} Starting backup to ${DUMP_FILE}"

# ── pg_dump ────────────────────────────────────────────────────────────────────
echo "${LOG_PREFIX} Running pg_dump..."
if ! pg_dump \
    --format=plain \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    "${DATABASE_URL}" \
  | gzip -9 > "${DUMP_FILE}"; then
  echo "${LOG_PREFIX} ERROR: pg_dump failed" >&2
  rm -f "${DUMP_FILE}"
  exit 1
fi

DUMP_SIZE="$(du -sh "${DUMP_FILE}" | cut -f1)"
echo "${LOG_PREFIX} pg_dump complete. Compressed size: ${DUMP_SIZE}"

# ── GPG encryption ─────────────────────────────────────────────────────────────
if [[ "${NO_ENCRYPT}" != "true" ]]; then
  ENCRYPTED_FILE="${DUMP_FILE}.gpg"
  echo "${LOG_PREFIX} Encrypting with GPG for recipient: ${GPG_RECIPIENT}"
  if ! gpg \
      --batch \
      --yes \
      --trust-model always \
      --encrypt \
      --recipient "${GPG_RECIPIENT}" \
      --output "${ENCRYPTED_FILE}" \
      "${DUMP_FILE}"; then
    echo "${LOG_PREFIX} ERROR: GPG encryption failed" >&2
    exit 2
  fi
  # Remove unencrypted dump after successful encryption
  rm -f "${DUMP_FILE}"
  FINAL_FILE="${ENCRYPTED_FILE}"
  echo "${LOG_PREFIX} Encrypted backup: ${FINAL_FILE}"
else
  echo "${LOG_PREFIX} WARNING: backup is NOT encrypted (--no-encrypt is set)" >&2
  FINAL_FILE="${DUMP_FILE}"
fi

# ── Checksum ───────────────────────────────────────────────────────────────────
sha256sum "${FINAL_FILE}" > "${FINAL_FILE}.sha256"
echo "${LOG_PREFIX} SHA-256: $(cat "${FINAL_FILE}.sha256")"

# ── S3 upload (optional) ───────────────────────────────────────────────────────
if [[ -n "${S3_BUCKET:-}" ]]; then
  S3_KEY="${S3_BUCKET}/${BACKUP_BASENAME}/$(basename "${FINAL_FILE}")"
  echo "${LOG_PREFIX} Uploading to s3://${S3_KEY}..."
  if aws s3 cp "${FINAL_FILE}" "s3://${S3_KEY}" \
      --sse aws:kms \
      --storage-class STANDARD_IA; then
    aws s3 cp "${FINAL_FILE}.sha256" "s3://${S3_KEY}.sha256" --sse aws:kms
    echo "${LOG_PREFIX} S3 upload complete."
  else
    echo "${LOG_PREFIX} WARNING: S3 upload failed. Backup retained locally." >&2
    exit 3
  fi
fi

# ── Local retention sweep ──────────────────────────────────────────────────────
echo "${LOG_PREFIX} Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_OUTPUT_DIR}" \
  -name 'srs-backup-*.gz*' -o -name 'srs-backup-*.sha256' \
  | while read -r f; do
    if [[ "$(find "${f}" -mtime +"${RETENTION_DAYS}" 2>/dev/null)" == "${f}" ]]; then
      echo "${LOG_PREFIX} Removing old backup: ${f}"
      rm -f "${f}"
    fi
  done

# ── Emit Prometheus pushgateway metric (optional) ─────────────────────────────
if [[ -n "${PROMETHEUS_PUSHGATEWAY:-}" ]]; then
  BACKUP_BYTES="$(stat -c%s "${FINAL_FILE}" 2>/dev/null || stat -f%z "${FINAL_FILE}" 2>/dev/null || echo 0)"
  cat <<PROM | curl -s --data-binary @- "${PROMETHEUS_PUSHGATEWAY}/metrics/job/srs-backup"
# TYPE srs_last_backup_timestamp_seconds gauge
srs_last_backup_timestamp_seconds $(date +%s)
# TYPE srs_last_backup_size_bytes gauge
srs_last_backup_size_bytes ${BACKUP_BYTES}
PROM
fi

echo "${LOG_PREFIX} Backup complete: ${FINAL_FILE}"
