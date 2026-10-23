# syntax=docker/dockerfile:1
# PostgreSQL 16 de Apreu: al iniciar con un volumen vacío crea la BD maestra
# (master-schema.sql + master-migrations). Las BD de cada colegio (apreu_<slug>)
# las crea superadmin-api al aprovisionar. Construir desde esta carpeta:
#   docker build -t apreu-db .
# Variables: ver .env.example. Montar un volumen en /var/lib/postgresql/data.

FROM postgres:16-alpine
ENV TZ=UTC \
    MASTER_DB_NAME=apreu_master
COPY postgres/master-schema.sql /apreu/master-schema.sql
COPY postgres/master-migrations /apreu/master-migrations
COPY docker/init-apreu.sh /docker-entrypoint-initdb.d/10-init-apreu.sh
EXPOSE 5432
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD pg_isready -U "$POSTGRES_USER" -d "$MASTER_DB_NAME" || exit 1
