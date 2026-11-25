#!/bin/sh
# Container start (Dockerfile CMD): apply the Prisma schema, set up an empty database on first boot, then serve.
#   SKIP_DB_PUSH=true   manage the schema yourself
#   SEED_DEMO=false     start with an empty database instead of the demo league
set -e
cd "${APP_DIR:-/app}"

on_host=""
[ -n "${RAILWAY_ENVIRONMENT:-}${RAILWAY_PUBLIC_DOMAIN:-}${RENDER:-}" ] && on_host=1

# A DATABASE_URL pointing at localhost on a hosting platform is the .env.example value, not your database.
case "${DATABASE_URL:-}" in
  *localhost*|*127.0.0.1*)
    if [ -n "$on_host" ]; then
      echo "[cte] DATABASE_URL points at localhost, which is the .env.example placeholder. On Railway set it to" >&2
      echo "[cte]   \${{Postgres.DATABASE_URL}}   (app service → Variables), and add a PostgreSQL database first." >&2
    fi
    ;;
esac

# Public URL for links in emails and push alerts: APP_URL, else the host's own (Railway, Render).
# A localhost APP_URL (the .env.example placeholder) is ignored on a hosting platform.
case "${APP_URL:-}" in *localhost*|*127.0.0.1*) [ -n "$on_host" ] && APP_URL="" ;; esac
if [ -z "${APP_URL:-}" ]; then
  if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    APP_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  elif [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
    APP_URL="${RENDER_EXTERNAL_URL}"
  fi
  [ -n "${APP_URL:-}" ] && export APP_URL
fi

# Schema: db push refuses changes that would lose data.
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

# First boot: NFL data + the demo league (skipped once a league exists).
if [ "${SEED_DEMO:-true}" = "true" ]; then
  node_modules/.bin/tsx scripts/bootstrap.ts
fi

echo "[cte] starting CTE Dynasty on port ${PORT:-3000}${APP_URL:+ ($APP_URL)}"
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
