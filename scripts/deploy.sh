#!/usr/bin/env bash
# Production deploy: git pull → npm install → PM2 restart
# Usage (from app root, e.g. /opt/lpdp-ai):
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh --skip-pull
#   ./scripts/deploy.sh --branch main

set -euo pipefail

APP_NAME="${APP_NAME:-ai-lpdp}"
BRANCH="${BRANCH:-main}"
SKIP_PULL=0
SKIP_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-pull) SKIP_PULL=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --branch) BRANCH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--skip-pull] [--skip-install] [--branch main]"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Deploy root: $ROOT"
echo "==> Node: $(node -v 2>/dev/null || echo 'NOT FOUND')"
echo "==> npm:  $(npm -v 2>/dev/null || echo 'NOT FOUND')"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Put Node 18+ first in PATH (e.g. /usr/local/bin)."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example → .env and set DB_*/secrets."
  exit 1
fi

mkdir -p logs uploads public/generated

LOCK_BEFORE=""
PKG_BEFORE=""
if [[ -f package-lock.json ]]; then LOCK_BEFORE="$(sha256sum package-lock.json | awk '{print $1}')"; fi
if [[ -f package.json ]]; then PKG_BEFORE="$(sha256sum package.json | awk '{print $1}')"; fi

if [[ "$SKIP_PULL" -eq 0 ]]; then
  echo "==> git fetch / pull ($BRANCH)"
  git fetch --all --prune
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  echo "==> skip git pull"
fi

NEED_INSTALL=1
if [[ "$SKIP_INSTALL" -eq 1 ]]; then
  NEED_INSTALL=0
  echo "==> skip npm install"
elif [[ -d node_modules ]]; then
  LOCK_AFTER=""
  PKG_AFTER=""
  if [[ -f package-lock.json ]]; then LOCK_AFTER="$(sha256sum package-lock.json | awk '{print $1}')"; fi
  if [[ -f package.json ]]; then PKG_AFTER="$(sha256sum package.json | awk '{print $1}')"; fi
  if [[ "$LOCK_BEFORE" == "$LOCK_AFTER" && "$PKG_BEFORE" == "$PKG_AFTER" && -n "$LOCK_AFTER$PKG_AFTER" ]]; then
    # Still install if node_modules looks incomplete
    if [[ -f node_modules/.package-lock.json ]] || [[ -d node_modules/express ]]; then
      echo "==> package.json/lock unchanged — npm install (quick verify)"
    fi
  fi
fi

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  echo "==> npm install --omit=dev"
  # Yes: after pull, install when deps change (safe to always run)
  npm install --omit=dev
fi

echo "==> ensure folders writable"
chmod -R u+rwX logs uploads public/generated 2>/dev/null || true

if command -v pm2 >/dev/null 2>&1; then
  echo "==> PM2 restart ($APP_NAME)"
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start ecosystem.config.cjs
  fi
  pm2 save || true
  pm2 status "$APP_NAME" || pm2 status
  echo "==> Recent logs:"
  pm2 logs "$APP_NAME" --lines 30 --nostream || true
else
  echo "WARN: pm2 not found. Start manually: npm start"
fi

echo ""
echo "DONE."
echo "Notes:"
echo "  - npm install: YA, wajib setelah pull jika package.json / package-lock berubah"
echo "  - DB migrate jalan otomatis saat app start (initDb)"
echo "  - SQL manual di folder sql/ hanya jika ada migrasi khusus yang belum di-auto"
echo "  - Cek .env (PORT, DB_*, secrets) jangan ke-overwrite pull"
