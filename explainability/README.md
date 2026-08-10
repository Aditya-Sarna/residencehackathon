# Analytics Agent (Agent Context Kit + Text-to-SQL)

Residence ships the **official Analytics Agent pattern** against a personal Fact warehouse:

1. **Sync** Facts from DataHub → SQLite (`~/.residence/facts_warehouse.db`)
2. **Publish** `warehouse.*` tables as DataHub datasets (schema + Personal Context domain)
3. **ACK `search`** finds the trustworthy table
4. **Text-to-SQL** generates a SELECT (templates; optional LLM)
5. **Execute** read-only SQL → answer (+ lineage for blocked purchases)

## Live

```bash
# Seed Facts then ask
curl -s -X POST http://127.0.0.1:8700/demo/judge >/dev/null
curl -s -X POST http://127.0.0.1:8700/analytics/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is my weekly budget?"}' | jq '{ok,via,headline,sql,skills}'

curl -s -X POST http://127.0.0.1:8700/analytics/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"Why was Everyday Runners blocked?"}' | jq '{ok,via,answer,sql,skills}'
```

Warehouse admin: `POST /warehouse/sync`

## Official DataHub Skills

Installed from [`datahub-project/datahub-skills`](https://github.com/datahub-project/datahub-skills) into `.agents/skills/` (see `skills-lock.json`).

```bash
npx skills add datahub-project/datahub-skills -a cursor
curl -s http://127.0.0.1:8700/skills | jq '{count,officialCount,officialSource}'
```

Composition skill (upstream candidate): `datahub-personal-context`.

## Official DataHub MCP

```bash
./scripts/datahub-mcp.sh
```

Claude Desktop dual MCP: [`desktop/mcp/claude_desktop_config.example.json`](../desktop/mcp/claude_desktop_config.example.json)

## Packages

```bash
pip install datahub-agent-context mcp-server-datahub
```
