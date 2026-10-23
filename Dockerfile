# syntax=docker/dockerfile:1
# superadmin-api · imagen de producción.
# Incluye los scripts SQL de database/postgres para aprovisionar colegios.
# Construir desde esta carpeta:
#   docker build -t superadmin-api .
# Variables: ver .env.example (se pasan con --env-file o desde el orquestador).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3100 \
    TENANT_SCHEMA_FILE=/app/database/postgres/tenant-schema.sql \
    TENANT_MIGRATIONS_DIR=/app/database/postgres/migrations
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY database/postgres/tenant-schema.sql ./database/postgres/
COPY database/postgres/migrations ./database/postgres/migrations
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/main.js"]
