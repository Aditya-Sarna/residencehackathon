#!/usr/bin/env bash
# Stage readiness — ALL GREEN or we tell you exactly what's red.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/node-v22.15.0-darwin-arm64/bin:${PATH}"
unset ELECTRON_RUN_AS_NODE

RED=0
ok() { echo "  ✅ $1"; }
bad() { echo "  ❌ $1"; RED=1; }

echo "══════════════════════════════════════"
echo " RESIDENCE JUDGE PREFLIGHT"
echo "══════════════════════════════════════"

# DataHub — attempt quickstart if down
if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
  ok "DataHub GMS :8080"
else
  echo "  … starting DataHub quickstart (best effort)"
  if command -v datahub >/dev/null 2>&1; then
    datahub docker quickstart >/tmp/residence-datahub-up.log 2>&1 || true
    for i in $(seq 1 60); do
      curl -sf http://localhost:8080/health >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    ok "DataHub GMS :8080 (started)"
  else
    bad "DataHub GMS down — run: datahub docker quickstart"
  fi
fi

# Core
if ! curl -sf http://127.0.0.1:8700/alive >/dev/null 2>&1; then
  echo "  … starting Core"
  if [[ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/miniconda3/etc/profile.d/conda.sh"
    conda activate residence 2>/dev/null || true
  fi
  mkdir -p "$HOME/.residence"
  (
    cd "$ROOT/core"
    RESIDENCE_ENV=development RESIDENCE_REQUIRE_AUTH=0 \
      nohup uvicorn main:app --host 127.0.0.1 --port 8700 \
      >"$HOME/.residence/core.log" 2>&1 &
    echo $! >"$HOME/.residence/core.pid"
  )
  for i in $(seq 1 40); do
    curl -sf http://127.0.0.1:8700/alive >/dev/null 2>&1 && break
    sleep 0.4
  done
fi

if curl -sf http://127.0.0.1:8700/alive >/dev/null 2>&1; then
  ok "Core alive :8700"
else
  bad "Core process down — see ~/.residence/core.log"
fi

READY=$(curl -sf http://127.0.0.1:8700/ready || echo '{}')
if echo "$READY" | grep -q '"ok":true'; then
  ok "Stage ready (Core + DataHub)"
else
  bad "Stage not ready — DataHub may be down (see /ready)"
fi

# Agent Context Kit + Skills
if curl -sf http://127.0.0.1:8700/ack/status >/tmp/residence-ack.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-ack.json"))
assert d.get("ackAvailable") is True, d
assert "search" in (d.get("tools") or []), d
print("ok")
PY
  then
    ok "Agent Context Kit bound (datahub-agent-context)"
  else
    bad "ACK status missing tools — pip install datahub-agent-context"
  fi
else
  bad "GET /ack/status failed — restart Core after pip install"
fi

if curl -sf http://127.0.0.1:8700/skills >/tmp/residence-skills.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-skills.json"))
assert d.get("count", 0) >= 5, d
names={s.get("name") for s in d.get("skills") or []}
assert "datahub-personal-context" in names or "datahub-search" in names, names
print("ok", d.get("count"))
PY
  then
    ok "DataHub Skills loaded (GET /skills)"
  else
    bad "Skills registry too thin"
  fi
else
  bad "GET /skills failed"
fi

if curl -sf http://127.0.0.1:8700/skills >/tmp/residence-skills2.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-skills2.json"))
assert d.get("officialCount", 0) >= 5, d
assert d.get("officialSource")=="datahub-project/datahub-skills", d
print("ok", d.get("officialCount"))
PY
  then
    ok "Official datahub-skills pack loaded (skills-lock → .agents/skills)"
  else
    bad "Official skills pack not detected — run: npx skills add datahub-project/datahub-skills"
  fi
fi

if curl -sf http://127.0.0.1:8700/desktop/briefing >/tmp/residence-briefing.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-briefing.json"))
assert d.get("ok") and d.get("headline") and d.get("dateISO"), d
assert "habit" in d and d["habit"].get("briefing"), d
print("ok", d.get("headline")[:80])
PY
  then
    ok "Daily briefing (GET /desktop/briefing)"
  else
    bad "GET /desktop/briefing missing headline/habit"
  fi
else
  bad "GET /desktop/briefing failed"
fi

if curl -sf -X POST http://127.0.0.1:8700/analytics/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is my weekly budget?"}' >/tmp/residence-analytics.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-analytics.json"))
assert d.get("agent")=="analytics-agent", d
assert "datahub-search" in (d.get("skills") or []), d
assert "text-to-sql" in (d.get("via") or ""), d
assert d.get("sql") is not None, d
print("ok", d.get("via"))
PY
  then
    ok "Analytics Agent Text-to-SQL via ACK + warehouse"
  else
    bad "Analytics Agent missing text-to-sql path"
  fi
else
  bad "POST /analytics/ask failed"
fi

# Judge path dry-run
if curl -sf -X POST http://127.0.0.1:8700/demo/judge >/tmp/residence-judge.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-judge.json"))
assert d.get("ok") and d.get("blocked") and not d.get("leaked")
assert d.get("closing",{}).get("headline")
print("ok")
PY
  then
    ok "POST /demo/judge — blocked + private health + closing card"
  else
    bad "Judge demo returned wrong shape (blocked/leaked/closing)"
  fi
else
  bad "POST /demo/judge failed"
fi

# Smart-memory breadth contract
if curl -sf -X POST http://127.0.0.1:8700/demo/smart-memory >/tmp/residence-smart.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-smart.json"))
assert d.get("ok")
cov=d.get("coverage") or {}
assert cov.get("scenarios", 0) >= 18, cov
assert cov.get("hit", 0) >= 16, cov
missing=cov.get("missing") or []
assert len(missing) <= 2, missing  # allow tiny flake budget
assert len(d.get("notifications") or []) >= 6
print("ok", cov.get("hit"), "/", cov.get("scenarios"))
PY
  then
    ok "POST /demo/smart-memory — breadth coverage"
  else
    bad "Smart-memory coverage too thin — see /tmp/residence-smart.json"
  fi
else
  bad "POST /demo/smart-memory failed"
fi

# Desktop capture smoke (no AppleScript — canned Mac-shaped text)
if curl -sf -X POST http://127.0.0.1:8700/desktop/capture \
  -H 'Content-Type: application/json' \
  -d '{"text":"Watch this youtube video https://youtube.com/watch?v=abc later today","source":"youtube","operation_id":"preflight-yt","capture_method":"preflight","consent_mode":"explicit"}' \
  >/tmp/residence-desktop-cap.json 2>/dev/null; then
  if python3 - <<'PY'
import json
d=json.load(open("/tmp/residence-desktop-cap.json"))
queued=d.get("queued") or []
assert queued, d
blob=json.dumps(queued).lower()
assert "watch" in blob or "youtube" in blob or "calendar" in blob, blob[:400]
print("ok", len(queued))
PY
  then
    ok "POST /desktop/capture — YouTube path queues a decision"
  else
    bad "Desktop capture smoke returned unexpected payload"
  fi
else
  bad "POST /desktop/capture failed"
fi

# Shell
if curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1; then
  ok "Phone shell :5173"
else
  echo "  … starting Vite shell"
  (cd "$ROOT/shell" && npm install --silent >/dev/null 2>&1 || true
   nohup npm run dev -- --host 127.0.0.1 --port 5173 \
     >"$HOME/.residence/shell.log" 2>&1 &)
  for i in $(seq 1 40); do
    curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1 && break
    sleep 0.3
  done
  if curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1; then
    ok "Phone shell :5173 (started)"
  else
    bad "Shell failed — see ~/.residence/shell.log"
  fi
fi

# Unit smoke — must run
PYTEST=""
if command -v pytest >/dev/null 2>&1; then
  PYTEST=pytest
elif [[ -x "$HOME/miniconda3/envs/residence/bin/pytest" ]]; then
  PYTEST="$HOME/miniconda3/envs/residence/bin/pytest"
fi
if [[ -n "$PYTEST" ]]; then
  if PYTHONPATH=core $PYTEST \
    tests/test_inference.py \
    tests/test_cross_reason.py \
    tests/test_memory_inference.py \
    tests/test_smart_memory_coverage.py \
    tests/test_ack_analytics.py \
    tests/test_desktop_bridge.py \
    -q >/tmp/residence-pytest.txt 2>&1; then
    ok "Offline unit tests (inference + cross + memory + ACK + desktop)"
  else
    bad "Unit tests failed — see /tmp/residence-pytest.txt"
  fi
else
  bad "pytest not found — install in residence env"
fi

echo ""
if [[ $RED -eq 0 ]]; then
  echo "══════════════════════════════════════"
  echo " ALL GREEN — you are stage-ready"
  echo "══════════════════════════════════════"
  echo ""
  echo "Judge (auto):"
  echo "  http://127.0.0.1:5173/?judge&auto=1"
  echo "Smart memory breadth (auto):"
  echo "  http://127.0.0.1:5173/?smart&auto=1"
  echo ""
  echo "Full script: WIN.md"
  open "http://127.0.0.1:5173/?judge&auto=1" 2>/dev/null || true
  exit 0
else
  echo "══════════════════════════════════════"
  echo " NOT READY — fix ❌ items above"
  echo "══════════════════════════════════════"
  exit 1
fi
