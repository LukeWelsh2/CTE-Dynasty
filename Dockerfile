# syntax=docker/dockerfile:1.7
#
# CTE Dynasty — production image.
# One long-running Node process: the Next.js server plus the in-process job scheduler (live scoring,
# waivers, recaps, data sync) booted from src/instrumentation.ts. Run a single replica.
#
#   docker compose up -d --build                 # app + Postgres (docker-compose.yml)
#   docker compose exec app npm run sync:all     # first-time NFL data pull
#
# Stages: base (Debian slim + OpenSSL for Prisma) → deps (npm ci) → build (prisma generate + next build)
# → runner (non-root). The runner keeps dev dependencies on purpose: the Prisma CLI applies the schema
# on start and tsx runs the maintenance scripts (npm run sync:all / job / db:seed) inside the container.

ARG NODE_VERSION=22

# ───────────────────────────── base ─────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ───────────────────────────── deps ─────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

# ───────────────────────────── build ─────────────────────────────
FROM base AS build
# JOBS_ENABLED=false: belt and braces — instrumentation.ts already skips the scheduler during next build.
ENV NODE_ENV=production \
    JOBS_ENABLED=false
# Prisma's env("DATABASE_URL") must resolve while building; no page touches the database at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 && rm -rf .next/cache

# ───────────────────────────── runner ─────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000

# Application files are root-owned (read-only for the app user) …
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
# … except what the server writes at runtime: the Next.js cache, uploaded images and email previews.
COPY --from=build --chown=node:node /app/.next ./.next
RUN mkdir -p .next/cache public/uploads .emails \
 && chown node:node .next/cache public/uploads .emails

# Start script: apply the Prisma schema (db push refuses changes that would lose data), then serve.
# Set SKIP_DB_PUSH=true to manage the schema yourself.
COPY --chmod=755 <<'EOF' /usr/local/bin/cte-start
#!/bin/sh
set -e
cd /app
if [ "${SKIP_DB_PUSH:-false}" != "true" ]; then
  attempt=1
  until node_modules/.bin/prisma db push --skip-generate; do
    if [ "$attempt" -ge "${DB_PUSH_RETRIES:-10}" ]; then
      echo "[cte] prisma db push failed after $attempt attempts; is DATABASE_URL reachable?" >&2
      exit 1
    fi
    echo "[cte] database not ready (attempt $attempt), retrying in 3s…"
    attempt=$((attempt + 1))
    sleep 3
  done
fi
echo "[cte] starting CTE Dynasty on port ${PORT:-3000}"
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
EOF

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["cte-start"]
