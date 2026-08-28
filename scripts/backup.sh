#!/usr/bin/env bash
# Nightly logical backup. Add to the deploy user's crontab:
#   15 3 * * * /home/paul/room-planner/scripts/backup.sh >> /home/paul/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

mkdir -p backups
stamp=$(date +%Y%m%d)

docker compose exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
    | gzip > "backups/db-$stamp.sql.gz"

# Keep 14 days locally. This is NOT off-site: pull these to your laptop, or
# push them to a bucket, before you rely on them.
find backups -name 'db-*.sql.gz' -mtime +14 -delete

echo "$(date -Iseconds) backup ok: backups/db-$stamp.sql.gz"
