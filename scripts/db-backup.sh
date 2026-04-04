#!/usr/bin/env bash
# db-backup.sh — dump PostgreSQL database to a timestamped .sql.gz file
# Usage: DATABASE_URL=postgres://... ./scripts/db-backup.sh [output-dir]
#
# Set BACKUP_S3_BUCKET to upload to S3 (requires awscli):
#   BACKUP_S3_BUCKET=my-backups DATABASE_URL=... ./scripts/db-backup.sh
#
# Recommended: run via Railway / cron every 24 h in production.

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="rockland_taxi_${TIMESTAMP}.sql.gz"
DEST="${OUTPUT_DIR}/${FILENAME}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

echo "→ Dumping database..."
pg_dump "$DATABASE_URL" | gzip > "$DEST"
echo "✓ Backup saved to ${DEST}"

# Optional: upload to S3 and prune local copy
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "→ Uploading to s3://${BACKUP_S3_BUCKET}/db-backups/${FILENAME}..."
  aws s3 cp "$DEST" "s3://${BACKUP_S3_BUCKET}/db-backups/${FILENAME}" --storage-class STANDARD_IA
  rm "$DEST"
  echo "✓ Uploaded and local copy removed"
fi

# Prune local backups older than 7 days
find "$OUTPUT_DIR" -name "*.sql.gz" -mtime +7 -delete
echo "✓ Pruned backups older than 7 days"
