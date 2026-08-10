#!/usr/bin/env bash
# One-command local production stack: DataHub (if needed) + Core + optional shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/node-v22.15.0-darwin-arm64/bin:${PATH}"
unset ELECTRON_RUN_AS_NODE

if [[ ! -f .env ]]; then
  cp .env.example .env
  # Generate a local API key for safer defaults
  KEY=$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)
  if grep -q '^RESIDENCE_API_KEY=$' .env 2>/dev/null || grep -q '^RESIDENCE_API_KEY=$' .env; then
    sed -i.bak "s|^RESIDENCE_API_KEY=.*|RESIDENCE_API_KEY=${KEY}|" .env && rm -f .env.bak
  fi
  # Dev-friendly defaults in generated .env
  sed -i.bak 's/^RESIDENCE_REQUIRE_AUTH=.*/RESIDENCE_REQUIRE_AUTH=0/' .env && rm -f .env.bak
  echo "Created .env (auth optional for local). API key ready if you enable REQUIRE_AUTH=1."
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

echo "==> Checking DataHub GMS at ${DATAHUB_GMS_URL:-http://localhost:8080}"
if ! curl -sf "${DATAHUB_GMS_URL:-http://localhost:8080}/health" >/dev/null 2>&1; then
  echo "DataHub not up — starting quickstart (may take a few minutes)…"
  if command -v datahub >/dev/null 2>&1; then
    datahub docker quickstart || true
  else
    echo "Install DataHub CLI: pip install acryl-datahub"
    echo "Then: datahub docker quickstart"
    exit 1
  fi
fi

mkdir -p "${RESIDENCE_PERSIST_DIR:-$HOME/.residence}"

# Kill stale core
if lsof -ti:8700 >/dev/null 2>&1; then
  kill "$(lsof -ti:8700)" 2>/dev/null || true
  sleep 0.4
fi

echo "==> Starting Residence Core on :8700"
# Prefer conda env if present
if [[ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/miniconda3/etc/profile.d/conda.sh"
  conda activate residence 2>/dev/null || true
fi

(
  cd "$ROOT/core"
  nohup uvicorn main:app --host "${CORE_HOST:-127.0.0.1}" --port "${CORE_PORT:-8700}" \
    >"${RESIDENCE_PERSIST_DIR:-$HOME/.residence}/core.log" 2>&1 &
  echo $! >"${RESIDENCE_PERSIST_DIR:-$HOME/.residence}/core.pid"
)

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${CORE_PORT:-8700}/ready" >/dev/null 2>&1; then
    echo "Core ready."
    break
  fi
  sleep 0.5
  if [[ $i -eq 40 ]]; then
    echo "Core failed to become ready. See ~/.residence/core.log"
    exit 1
  fi
done

if [[ "${1:-}" == "--with-shell" ]]; then
  echo "==> Starting phone shell on :5173"
  (cd "$ROOT/shell" && npm install --silent && nohup npm run dev -- --host 127.0.0.1 --port 5173 \
    >"${RESIDENCE_PERSIST_DIR:-$HOME/.residence}/shell.log" 2>&1 &)
fi

if [[ "${1:-}" == "--with-mac" ]] || [[ "${2:-}" == "--with-mac" ]]; then
  echo "==> Opening Mac app"
  "$ROOT/scripts/open-mac-app.sh"
fi

echo ""
echo "Residence is up."
echo "  Core:   http://127.0.0.1:${CORE_PORT:-8700}/health"
echo "  Phone:  http://127.0.0.1:5173/?judge  (if --with-shell)"
echo "  Logs:   ${RESIDENCE_PERSIST_DIR:-$HOME/.residence}/core.log"
echo "  Stop:   ./scripts/residence-down.sh"
