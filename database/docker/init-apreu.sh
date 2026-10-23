#!/bin/sh
# Se ejecuta una sola vez, cuando el volumen de datos está vacío
# (docker-entrypoint-initdb.d de la imagen oficial de postgres).
set -eu

psql_admin() { psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@"; }

echo "apreu: creando la BD maestra ${MASTER_DB_NAME}"
psql_admin --dbname postgres -c "CREATE DATABASE \"${MASTER_DB_NAME}\""
psql_admin --dbname "$MASTER_DB_NAME" -f /apreu/master-schema.sql
for f in /apreu/master-migrations/[0-9]*.sql; do
  [ -e "$f" ] || continue
  echo "apreu: aplicando $(basename "$f")"
  psql_admin --dbname "$MASTER_DB_NAME" -f "$f"
done
