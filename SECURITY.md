# Security

## Threat model (personal self-host)

Residence Core holds personal Facts and proxies DataHub writes. Default production posture:

| Control | Behavior |
|---|---|
| Bind | `127.0.0.1` in production |
| Auth | `RESIDENCE_REQUIRE_AUTH=1` + `RESIDENCE_API_KEY` (fail-closed) |
| CORS | Allowlist only |
| Resets | Disabled unless `RESIDENCE_ALLOW_RESET=1` |
| Rate limit | Durable file-backed limiter |
| Keys | Constant-time compare (`hmac.compare_digest`) |

## Secrets

- Never commit `.env`, `.gemini_oauth.json`, or API keys.
- `.env.example` documents required vars without values.
- Demo / judge preflight may set `RESIDENCE_REQUIRE_AUTH=0` **locally only**.

## Mac app

- Capture is explicit (hotkey / tray) — no silent ambient scrape.
- Accept/Decline gate before Fact write-back.
- Unsigned builds require Gatekeeper **Open Anyway**; signed/notarized releases use `scripts/release-mac.sh` + CI tag job.

## Reporting

Open a private advisory or email the maintainer via GitHub profile for sensitive issues.
