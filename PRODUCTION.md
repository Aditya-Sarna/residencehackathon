# Residence — Production Readiness

Target: **self-hosted personal OS** you can run every day without babysitting.

## Scorecard (all required for 10/10)

| # | Gate | Status |
|---|---|---|
| 1 | Env-based config + fail-closed production auth | ✅ `core/config.py` |
| 2 | API auth (Bearer / X-Residence-Key) + public health | ✅ `prod_middleware.py` |
| 3 | Durable rate limiting + request IDs + structured logs | ✅ file-backed `~/.residence/rate_limit.json` |
| 4 | CORS allowlist (credentials-safe) | ✅ |
| 5 | Dangerous resets disabled in production | ✅ `RESIDENCE_ALLOW_RESET=0` |
| 6 | Durable desktop permission inbox | ✅ `~/.residence/desktop_pending.json` |
| 7 | Fact backup export | ✅ `GET /backup/facts` |
| 8 | Docker image + compose | ✅ `Dockerfile`, `docker-compose.yml` |
| 9 | One-command up/down | ✅ `scripts/residence-up.sh` / `residence-down.sh` |
| 10 | macOS LaunchAgent (Core at login) | ✅ `scripts/install-launchagent.sh` |
| 11 | Mac first-run permission wizard | ✅ `desktop/first-run.html` |
| 12 | Mac entitlements + Automation usage string | ✅ |
| 13 | Desktop reconnect w/ exponential backoff + file logs | ✅ |
| 14 | CI (pytest + shell vitest/build + desktop syntax + Mac pack) | ✅ `.github/workflows/ci.yml` |
| 15 | `.env.example` — no secrets in git | ✅ |
| 16 | Live Fact graph + glossary + history APIs | ✅ `/graph` `/glossary` `/facts/{id}/history` |
| 17 | Native DataHub Assertions + Personal Context domain | ✅ |
| 18 | GMS-first agent cache (TTL) + search batch 200 | ✅ |
| 19 | DataHub UI deep links from Graph | ✅ |
| 20 | Constant-time API key compare | ✅ `hmac.compare_digest` |
| 21 | Offline judge replay (hosted shell never dead-ends) | ✅ `shell/src/judgeFixture.ts` |
| 22 | Judge path unit contract (vitest) | ✅ `shell/src/judgeDemo.test.ts` |
| 23 | Security policy | ✅ `SECURITY.md` |
| 24 | Mac install steps on landing Download tab | ✅ `shell/src/Landing.tsx` |

## Operator runbook

```bash
# 1) Configure
cp .env.example .env
# set RESIDENCE_API_KEY, RESIDENCE_ENV=production, RESIDENCE_REQUIRE_AUTH=1

# 2) DataHub
datahub docker quickstart

# 3) Start Core (+ optional shell / Mac)
./scripts/residence-up.sh --with-shell --with-mac

# 4) Keep Core alive across reboots (macOS)
./scripts/install-launchagent.sh

# 5) Docker alternative
docker compose up -d --build
```

Clients must send:

```http
Authorization: Bearer $RESIDENCE_API_KEY
```

## Signing / Gatekeeper (Apple Developer)

Unsigned local builds need **Open Anyway** once. For distribution:

```bash
export CSC_IDENTITY="Developer ID Application: Your Name (TEAMID)"
cd desktop && npm run dist
xcrun notarytool submit dist/Residence-*.dmg --wait --keychain-profile residence
```

Entitlements are already wired (`desktop/entitlements.mac.plist`).

## Security model

- Core binds `127.0.0.1` in production by default.
- Auth required when `RESIDENCE_REQUIRE_AUTH=1`.
- Demo clear/reset blocked when `allow_reset` is false.
- Health/ready stay public for probes.
- Pending inbox + logs live under `RESIDENCE_PERSIST_DIR` (default `~/.residence`).

## Mac ambient assistant guarantees

- Capture is always explicit: smart capture uses a hotkey/tray action; clipboard capture is a separate explicit action.
- The desktop app stores a bounded local outbox before Core delivery. A Core/network outage cannot silently drop a capture; it retries after reconnect.
- Every capture carries an operation ID and content hash. Core deduplicates retries, and accepting the same decision twice cannot create two Facts.
- Native write-backs carry the same operation marker in Notes, Calendar, or Reminders. A retry is idempotent; failed writes enter the desktop recovery queue without rolling back the already accepted Fact.
- Core retains an auditable lifecycle record (`/desktop/activity`) containing capture, decision, Fact write, and native write-back outcome. Resolved records retain metadata/previews rather than being used as an indefinite raw capture archive.
- Per-integration capture/write-back settings are available from the Mac status window. Revoke Automation/Accessibility in macOS System Settings at any time.

## macOS release process

Development bundles use ad-hoc signing only. A distributable build must be Developer-ID signed and notarized:

```bash
export CSC_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
./scripts/release-mac.sh
```

The release CI job runs only for `v*` tags and fails closed if these secrets are absent. It produces neither a trusted release claim nor a notarized artifact without Apple credentials.

## Honest boundary

This is **production-ready self-hosted personal OS**: auth, durable rate limits, persistence, packaging, CI, restart policy, backups, native DataHub Assertions/Domains, and a live graph UI.  
Multi-tenant SaaS (hosted IdP / org billing) is intentionally out of scope — Residence is one person’s context graph.
