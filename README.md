# RESIDENCE

**Thesis:** DataHub’s siloed-metadata problem, restated for a person — one shared personal context graph so Shopping, Wallet, Calendar, and Wellness stop lying to each other.

## DataHub tier used

**Self-hosted OSS** (`datahub docker quickstart`).  
Agents are `CorpUser`s with read/write scopes. Staleness is app-side (`ttlSeconds` + `assertedAt`).

## Judge path (undeniable)

```bash
./scripts/judge-preflight.sh
# ALL GREEN → opens http://127.0.0.1:5173/?judge&auto=1
```

Spoken script: [`WIN.md`](WIN.md) · checklist: [`SUBMISSION.md`](SUBMISSION.md)

Manual: DataHub + Core `:8700` + shell → **http://localhost:5173/?judge&auto=1** (Space re-fires).

That one button runs live DataHub writes:

1. Wallet locks **$40/week** (certified Budget fact)
2. Voice utterance inferred → Calendar + Shop + Wallet banners
3. Shop pauses **Everyday Runners ($95)** with lineage to Budget
4. Wellness allergy stays **hidden from Shop** (sensitivity gate)
5. Plain-language **Why?** from live lineage

Manual explore: Voice / Calendar / Wallet / Shop / Wellness (5 apps).

## Architecture

```text
Hero video → Phone shell (Helvetica Neue)
                ↓
         Residence Core  (/infer · /facts · /demo/judge)
                ↓
      DataHub GMS (glossary · ownership · lineage · tags · CorpUser)
```

| DataHub primitive | Residence use |
|---|---|
| Business Glossary | Enforced on every `assert_fact` |
| Ownership | `assertedByAgentUrn` on each Fact |
| Lineage | Budget → blocked purchase (+ supersedes) |
| Tags | certification + sensitivity |
| Domains | `residence.personal-context` on Facts |
| Assertions | Native Assertion + run event on conflict |
| CorpUser | Agent scopes (Trust / sensitivity) |
| **Agent Context Kit** | `datahub-agent-context` — `search` / `get_entities` / `get_lineage` via `/ack/*` + Analytics Agent |
| **DataHub MCP** | Official `mcp-server-datahub` (`./scripts/datahub-mcp.sh`) + Residence MCP for Accept |
| **Skills** | `skills-config/datahub-{search,lineage,enrich,quality,personal-context}` + runtime invocation |
| **Analytics Agent** | ACK discover `warehouse.*` → Text-to-SQL on SQLite Fact warehouse → answer |
| **Official Skills** | `datahub-project/datahub-skills` installed to `.agents/skills` (`skills-lock.json`) |

## Before / after + tests

```bash
python examples/before_private_stores.py
python examples/after_fact_broker.py
pytest tests/ -q
```

## LLM

Optional. Inference NLU works without keys. Set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for LLM refine.

## Agent Context Kit · MCP · Analytics Agent

```bash
pip install -r core/requirements.txt   # datahub-agent-context + mcp-server-datahub
curl -s http://127.0.0.1:8700/ack/status | jq .
curl -s -X POST http://127.0.0.1:8700/analytics/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"Why was Everyday Runners blocked?"}' | jq .
./scripts/datahub-mcp.sh               # official DataHub MCP → local GMS
```

Claude Desktop dual MCP: [`desktop/mcp/claude_desktop_config.example.json`](desktop/mcp/claude_desktop_config.example.json)  
Details: [`explainability/README.md`](explainability/README.md) · [`skills-config/README.md`](skills-config/README.md)

## OSS contribution

[`skills-config/datahub-personal-context/SKILL.md`](skills-config/datahub-personal-context/SKILL.md) · [`skills-config/UPSTREAM_ISSUE.md`](skills-config/UPSTREAM_ISSUE.md)

## Production (self-hosted)

```bash
cp .env.example .env          # set RESIDENCE_API_KEY for prod
./scripts/residence-up.sh --with-shell --with-mac
./scripts/install-launchagent.sh   # Core survives reboot (macOS)
```

Auth, rate limits, durable pending inbox, Docker, CI, backups — see [`PRODUCTION.md`](PRODUCTION.md).

## Mac app (menu bar + integrations)

Claude, Notes, Calendar, Reminders, YouTube, Gmail… → **⌘⇧R** → Accept → Facts + native write-back.

```bash
./scripts/open-mac-app.sh
./scripts/build-mac-app.sh
```

Details: [`desktop/README.md`](desktop/README.md).

## Deploy

- **Judging:** local DataHub + Core + `shell` (`/api` → `:8700`).
- **Mac:** download `desktop/dist` zip / `Residence.app` (unsigned — Open Anyway once).
- **Vercel:** static `shell/dist` only — Core stays local.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
