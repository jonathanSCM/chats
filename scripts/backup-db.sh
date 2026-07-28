#!/usr/bin/env bash
# Respaldo manual/programado de la base de datos.
#
# Uso local:
#   DATABASE_URL="postgresql://..." ./scripts/backup-db.sh
#
# En Coolify: preferí el backup automático nativo de la base de datos
# (pestaña "Backups" del recurso Postgres — programa el dump y lo sube a S3
# solo). Este script es para respaldos manuales o si programás un cron aparte.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Falta DATABASE_URL" >&2
  exit 1
fi

OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="$OUT_DIR/backup_${TIMESTAMP}.sql.gz"

echo "Respaldando a $OUT_FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$OUT_FILE"
echo "Listo: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Conserva solo los últimos 14 respaldos locales.
ls -1t "$OUT_DIR"/backup_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
