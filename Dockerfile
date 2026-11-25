#
# CTE Dynasty — production image.
# One long-running Node process: the Next.js server plus the in-process job scheduler (live scoring,
# waivers, recaps, data sync) booted from src/instrumentation.ts. Run a single replica.
#
#   docker compose up -d --build                 # app + Postgres (docker-compose.yml)
#
# On first boot with an empty database the start script pulls the NFL data and builds the demo league
# (scripts/bootstrap.ts; SEED_DEMO=false skips it). Also deploys as-is on Railway (railway.json) or any Docker host.
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
RUN npm ci --include=dev --no-audit --no-fund

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

# Start script (scripts/docker-start.sh): apply the Prisma schema, set up an empty database on first boot, serve.
RUN install -m 755 scripts/docker-start.sh /usr/local/bin/cte-start

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["cte-start"]
