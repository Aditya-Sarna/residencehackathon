# RESIDENCE — Submission / judging checklist

## One-liner

Personal agents need a shared context graph — DataHub OSS owns Facts so Shop, Wallet, Calendar, and Wellness share truth instead of private silos.

## Undeniable judge path (use this)

```bash
./scripts/judge-preflight.sh
# opens http://127.0.0.1:5173/?judge&auto=1
```

Spoken script + anti-patterns: **[`WIN.md`](WIN.md)**

1. Preflight prints **ALL GREEN**  
2. Browser opens `/?judge&auto=1` — demo auto-runs  
3. Closing card: **DataHub won — not five private silos**  
4. Say: *“Apps stopped lying because Facts live in DataHub — glossary, ownership, lineage, and sensitivity.”*  
5. Optional encore: **Smart memory** (same-day clash)  

Fallback: Space bar re-fires the 30s demo.  
Hosted / Core-down: shell plays the **offline replay** of the same winning path (toast says Replay).  
Live GMS proof: `pytest tests/test_judge_demo.py -q`

## DataHub tier

**Self-hosted OSS.** CorpUser agents + app-side TTL (not Cloud Agent Registry / Cloud Assertions).

## Criteria map

| Criterion | Evidence |
|---|---|
| Real DataHub load-bearing | Fact datasets, glossary, ownership, lineage, domains, tags, assertions, CorpUser scopes |
| **Agent Context Kit** | `datahub-agent-context` in `core/ack_bridge.py` · `GET /ack/status` · `GET /ack/search` |
| **DataHub MCP Server** | Official `mcp-server-datahub` · `./scripts/datahub-mcp.sh` · dual Claude config |
| **DataHub Skills** | Official pack via `skills-lock.json` → `.agents/skills` (`datahub-project/datahub-skills`) · `GET /skills` · broker `_skill()` |
| **Analytics Agent** | ACK discover `warehouse.*` → Text-to-SQL on Fact warehouse → execute · `POST /analytics/ask` · judge step |
| **Fact warehouse** | Sync Facts → SQLite · register `warehouse.*` datasets in GMS · `POST /warehouse/sync` |
| Fact Broker only API | `core/broker.py` + `/infer` + `/demo/judge` |
| Conflict + TTL | `tests/test_broker.py` |
| Cross-app + cross-reasoning | `inference.py` + `cross_reason.py` + Smart memory |
| Explainability | Analytics Agent + `/explain/latest-block` + closing card |
| Sensitivity | Shop cannot read health in judge demo (`leaked: false`) |
| Mac product path | `desktop/` + Residence MCP + DataHub MCP + native write-back |
| Daily usefulness | Morning briefing · Calendar 7-day sync · Accept gates · shell Today (`GET /desktop/briefing`) |
| Production | [`PRODUCTION.md`](PRODUCTION.md) — auth, Docker, CI, LaunchAgent |
| OSS contribution | `skills-config/datahub-personal-context` + UPSTREAM_ISSUE |
| Gates | `tests/test_judge_demo.py` + `tests/test_ack_analytics.py` |

## Deploy note

Vercel = static shell. Core + DataHub local for the live demo.
