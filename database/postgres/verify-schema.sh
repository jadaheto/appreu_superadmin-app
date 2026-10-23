#!/usr/bin/env bash
# =============================================================================
# Compara el esquema de una BD MariaDB con el de una BD PostgreSQL (ADR-0008).
#
#   database/postgres/verify-schema.sh <bd_mariadb> <bd_postgres>
#   database/postgres/verify-schema.sh apreu_demo apreu_demo_pg_schema_test
#   database/postgres/verify-schema.sh apreu_master apreu_master
#
# Compara: tablas, columnas (nombre y NULL/NOT NULL), claves primarias, claves
# foráneas (columnas, tabla y columnas referenciadas, ON DELETE), índices únicos
# (columnas; lower(col) cuenta como col) y valores de los ENUM frente a los CHECK
# de PostgreSQL. Los índices no únicos solo se cuentan (en PG se eliminaron los
# redundantes y se agregaron índices trigram), y los tipos no se comparan (la
# conversión está en TYPE-MAP.md).
#
# Usa `docker exec` (el sandbox no permite TCP host→Docker). Variables:
#   MARIA_CONTAINER (apreu-dev-db)  MARIA_USER (root)  MARIA_PASSWORD (root)
#   PG_CONTAINER    (apreu-dev-pg)  PG_USER    (postgres)
# Sale con 0 si no hay diferencias y con 1 si las hay.
# =============================================================================
set -euo pipefail

if [[ $# -ne 2 ]]; then
  sed -n '3,8p' "$0" >&2
  exit 2
fi
MDB="$1"
PDB="$2"
MARIA_CONTAINER="${MARIA_CONTAINER:-apreu-dev-db}"
MARIA_USER="${MARIA_USER:-root}"
MARIA_PASSWORD="${MARIA_PASSWORD:-root}"
PG_CONTAINER="${PG_CONTAINER:-apreu-dev-pg}"
PG_USER="${PG_USER:-postgres}"

maria() { docker exec -i "$MARIA_CONTAINER" mariadb -u"$MARIA_USER" -p"$MARIA_PASSWORD" -N -B --raw "$MDB"; }
pg() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PDB" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -q; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- MariaDB ---
maria > "$WORK/maria.txt" <<'SQL'
SELECT CONCAT_WS('\t', 'table', table_name)
  FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
SELECT CONCAT_WS('\t', 'column', table_name, column_name, IF(is_nullable = 'YES', 'null', 'not null'))
  FROM information_schema.columns WHERE table_schema = DATABASE();
SELECT CONCAT_WS('\t', 'pk', table_name, GROUP_CONCAT(column_name ORDER BY seq_in_index))
  FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name = 'PRIMARY'
 GROUP BY table_name;
SELECT DISTINCT CONCAT_WS('\t', 'unique', table_name, cols) FROM (
  SELECT table_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
    FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND non_unique = 0 AND index_name <> 'PRIMARY'
   GROUP BY table_name, index_name) u;
SELECT DISTINCT CONCAT_WS('\t', 'fk', table_name, cols, ref_table, ref_cols, del) FROM (
  SELECT k.table_name, GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position) AS cols,
         k.referenced_table_name AS ref_table,
         GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position) AS ref_cols,
         REPLACE(REPLACE(r.delete_rule, 'NO ACTION', 'RESTRICT'), ' ', '_') AS del
    FROM information_schema.key_column_usage k
    JOIN information_schema.referential_constraints r
      ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
     AND r.table_name = k.table_name
   WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
   GROUP BY k.table_name, k.constraint_name, k.referenced_table_name, r.delete_rule) f;
SELECT CONCAT_WS('\t', 'enum', table_name, column_name,
         REPLACE(SUBSTRING(column_type, 7, CHAR_LENGTH(column_type) - 8), '\',\'', ','))
  FROM information_schema.columns WHERE table_schema = DATABASE() AND data_type = 'enum';
SELECT CONCAT_WS('\t', '#indexes', COUNT(DISTINCT table_name, index_name))
  FROM information_schema.statistics WHERE table_schema = DATABASE();
SQL

# ------------------------------------------------------------- PostgreSQL ---
pg > "$WORK/pg.txt" <<'SQL'
SELECT 'table', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'column', table_name, column_name, CASE WHEN is_nullable = 'YES' THEN 'null' ELSE 'not null' END
  FROM information_schema.columns WHERE table_schema = 'public';
WITH idx AS (
  SELECT t.relname AS table_name, i.indexrelid, i.indisprimary, i.indisunique,
         (SELECT string_agg(regexp_replace(pg_get_indexdef(i.indexrelid, k, true),
                                           '^lower\(\(?"?(\w+)"?(::text)?\)?\)$', '\1'), ',' ORDER BY k)
            FROM generate_series(1, i.indnkeyatts) k) AS cols
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND i.indpred IS NULL)
SELECT DISTINCT CASE WHEN indisprimary THEN 'pk' ELSE 'unique' END, table_name, replace(cols, '"', '')
  FROM idx WHERE indisunique;
SELECT DISTINCT 'fk', t.relname,
       (SELECT string_agg(a.attname, ',' ORDER BY x.ord) FROM unnest(c.conkey) WITH ORDINALITY x(att, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.att),
       r.relname,
       (SELECT string_agg(a.attname, ',' ORDER BY x.ord) FROM unnest(c.confkey) WITH ORDINALITY x(att, ord)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = x.att),
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET_NULL' WHEN 'd' THEN 'SET_DEFAULT'
                          ELSE 'RESTRICT' END
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_class r ON r.oid = c.confrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE c.contype = 'f' AND n.nspname = 'public';
SELECT 'enum', t.relname, a.attname,
       (SELECT string_agg(m[1], ',' ORDER BY o)
          FROM regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')*)''', 'g') WITH ORDINALITY x(m, o))
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'c' AND n.nspname = 'public' AND array_length(c.conkey, 1) = 1
   AND pg_get_constraintdef(c.oid) ~ '= ANY|IN \(';
SELECT '#indexes', count(*)
  FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public';
SQL

grep -v '^#' "$WORK/maria.txt" | sort -u > "$WORK/m.sorted"
grep -v '^#' "$WORK/pg.txt" | sort -u > "$WORK/p.sorted"

count() { grep -c "^$1"$'\t' "$2" || true; }
printf '%-10s %8s %8s\n' '' 'MariaDB' 'Postgres'
for k in table column pk unique fk enum; do
  printf '%-10s %8s %8s\n' "$k" "$(count "$k" "$WORK/m.sorted")" "$(count "$k" "$WORK/p.sorted")"
done
printf '%-10s %8s %8s   (informativo: PG sin índices redundantes, con trigram)\n' 'índices' \
  "$(grep '^#indexes' "$WORK/maria.txt" | cut -f2)" "$(grep '^#indexes' "$WORK/pg.txt" | cut -f2)"

if diff -u --label "mariadb:$MDB" --label "postgres:$PDB" "$WORK/m.sorted" "$WORK/p.sorted" > "$WORK/diff.txt"; then
  echo "OK: sin diferencias entre mariadb:$MDB y postgres:$PDB"
else
  echo "DIFERENCIAS (- solo en MariaDB, + solo en PostgreSQL):"
  grep -E '^[-+][^-+]' "$WORK/diff.txt"
  exit 1
fi
