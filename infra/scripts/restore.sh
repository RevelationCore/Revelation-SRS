#!/usr/bin/env bash
# restore.sh — Revelation SRS PostgreSQL restore script
#
# Usage:
#   ./restore.sh --backup-file <path> --db-url <url> [--gpg-passphrase-file <path>]
#
# Environment variables:
#   DATABASE_URL             — target PostgreSQL connection URL
#   BACKUP_FILE              — path to backup file (.sql.gz.gpg or .sql.gz)
#   GPG_PASSPHRASE_FILE      — path to file containing GPG passphrase (for encrypted backups)
#
# This script:
#   1. Optionally decrypts a GPG-encrypted backup archive.
#   2. Verifies the SHA-256 checksum if a .sha256 sidecar exists.
#   3. Drops all connections to the target database.
#   4. Restores via psql.
#   5. Runs the Drizzle migration suite to bring the schema to the current version.
#   6. Runs the SRS demo/scenario validation to confirm data integrity.
#
# RTO target: ≤ 4 hours from declaration of incident to service restored.
# Time the restore and record elapsed time in the post-incident report.
#
# IMPORTANT: This script is destructive. It will overwrite the target database.
# Take a snapshot of the target before restoring if there is any data to preserve.

set -euo pipefail

TIMESTAMP="$(date -u '+%Y%m%d-%H%M%S')"
LOG_PREFIX="[srs-restore ${TIMESTAMP}]"

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-file)         BACKUP_FILE="$2"; shift 2 ;;
    --db-url)              DATABASE_URL="$2"; shift 2 ;;
    --gpg-passphrase-file) GPG_PASSPHRASE_FILE="$2"; shift 2 ;;
    --skip-validation)     SKIP_VALIDATION=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

SKIP_VALIDATION="${SKIP_VALIDATION:-false}"

# ── Validation ─────────────────────────────────────────────────────────────────
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${BACKUP_FILE:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: --backup-file is required" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "${LOG_PREFIX} ERROR: backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

RESTORE_START="$(date +%s)"
echo "${LOG_PREFIX} Starting restore from: ${BACKUP_FILE}"
echo "${LOG_PREFIX} Target: ${DATABASE_URL//:*@/@}"   # mask password in log

# ── Checksum verification ──────────────────────────────────────────────────────
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ -f "${CHECKSUM_FILE}" ]]; then
  echo "${LOG_PREFIX} Verifying SHA-256 checksum..."
  if ! sha256sum --check "${CHECKSUM_FILE}"; then
    echo "${LOG_PREFIX} ERROR: checksum verification failed" >&2
    exit 1
  fi
  echo "${LOG_PREFIX} Checksum OK."
else
  echo "${LOG_PREFIX} WARNING: no .sha256 sidecar found, skipping checksum verification" >&2
fi

# ── GPG decryption (if encrypted) ─────────────────────────────────────────────
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

if [[ "${BACKUP_FILE}" == *.gpg ]]; then
  echo "${LOG_PREFIX} Decrypting GPG-encrypted backup..."
  DECRYPTED_FILE="${WORK_DIR}/$(basename "${BACKUP_FILE%.gpg}")"

  GPG_ARGS=(--batch --yes --output "${DECRYPTED_FILE}" --decrypt "${BACKUP_FILE}")
  if [[ -n "${GPG_PASSPHRASE_FILE:-}" ]]; then
    GPG_ARGS+=(--passphrase-file "${GPG_PASSPHRASE_FILE}" --pinentry-mode loopback)
  fi

  if ! gpg "${GPG_ARGS[@]}"; then
    echo "${LOG_PREFIX} ERROR: GPG decryption failed" >&2
    exit 1
  fi
  SQL_GZ="${DECRYPTED_FILE}"
  echo "${LOG_PREFIX} Decryption complete."
else
  SQL_GZ="${BACKUP_FILE}"
fi

# ── Terminate existing connections ─────────────────────────────────────────────
echo "${LOG_PREFIX} Terminating existing database connections..."
DB_NAME="$(echo "${DATABASE_URL}" | sed 's|.*\/||')"

psql "${DATABASE_URL%/*}/postgres" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null 2>&1 || true

# ── psql restore ──────────────────────────────────────────────────────────────
echo "${LOG_PREFIX} Restoring database from ${SQL_GZ}..."
if ! gunzip -c "${SQL_GZ}" | psql "${DATABASE_URL}" 2>&1 | tee "${WORK_DIR}/restore.log"; then
  echo "${LOG_PREFIX} ERROR: psql restore failed. See ${WORK_DIR}/restore.log" >&2
  cat "${WORK_DIR}/restore.log" >&2
  exit 1
fi

ERROR_COUNT="$(grep -c '^ERROR' "${WORK_DIR}/restore.log" 2>/dev/null || echo 0)"
if [[ "${ERROR_COUNT}" -gt 0 ]]; then
  echo "${LOG_PREFIX} WARNING: ${ERROR_COUNT} psql ERRORs during restore — review restore.log" >&2
fi

echo "${LOG_PREFIX} psql restore complete."

# ── Schema migration (ensure current version) ──────────────────────────────────
echo "${LOG_PREFIX} Running Drizzle migrations to reconcile schema version..."
if command -v pnpm &>/dev/null; then
  DATABASE_URL="${DATABASE_URL}" pnpm --filter '@revelation-srs/db' migrate || {
    echo "${LOG_PREFIX} WARNING: migration run failed — check schema version manually" >&2
  }
else
  echo "${LOG_PREFIX} pnpm not available — skipping migration step (run manually)" >&2
fi

# ── Data integrity validation ──────────────────────────────────────────────────
if [[ "${SKIP_VALIDATION}" != "true" ]]; then
  echo "${LOG_PREFIX} Running scenario validation..."
  if command -v pnpm &>/dev/null; then
    DATABASE_URL="${DATABASE_URL}" pnpm demo:validate 2>&1 | tee "${WORK_DIR}/validate.log" || {
      echo "${LOG_PREFIX} WARNING: scenario validation reported failures — review validate.log" >&2
    }
  else
    echo "${LOG_PREFIX} pnpm not available — skipping validation (run 'pnpm demo:validate' manually)" >&2
  fi
fi

# ── Elapsed time ──────────────────────────────────────────────────────────────
RESTORE_END="$(date +%s)"
ELAPSED=$(( RESTORE_END - RESTORE_START ))
ELAPSED_MIN=$(( ELAPSED / 60 ))
ELAPSED_SEC=$(( ELAPSED % 60 ))
echo "${LOG_PREFIX} Restore complete in ${ELAPSED_MIN}m ${ELAPSED_SEC}s"

if [[ "${ELAPSED_MIN}" -gt 240 ]]; then
  echo "${LOG_PREFIX} WARNING: restore exceeded 4-hour RTO target (${ELAPSED_MIN}m)" >&2
else
  echo "${LOG_PREFIX} RTO: within 4-hour target (${ELAPSED_MIN}m of 240m allowed)"
fi

# ── Emit Prometheus pushgateway metric (optional) ─────────────────────────────
if [[ -n "${PROMETHEUS_PUSHGATEWAY:-}" ]]; then
  cat <<PROM | curl -s --data-binary @- "${PROMETHEUS_PUSHGATEWAY}/metrics/job/srs-restore"
# TYPE srs_last_restore_timestamp_seconds gauge
srs_last_restore_timestamp_seconds $(date +%s)
# TYPE srs_last_restore_duration_seconds gauge
srs_last_restore_duration_seconds ${ELAPSED}
PROM
fi
