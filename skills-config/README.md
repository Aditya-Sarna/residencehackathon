# DataHub Skills — Residence

## Official pack (required for a 10 on Use of DataHub)

Installed from [`datahub-project/datahub-skills`](https://github.com/datahub-project/datahub-skills) into `.agents/skills/` and locked in [`skills-lock.json`](../skills-lock.json):

```bash
npx skills add datahub-project/datahub-skills -a cursor
curl -s http://127.0.0.1:8700/skills | jq '{count, officialCount, officialSource}'
```

Core prefers those upstream `SKILL.md` files (full playbooks for search / lineage / enrich / quality / setup).

## Residence composition skill

| Skill | Path |
|---|---|
| `datahub-personal-context` | [`datahub-personal-context/SKILL.md`](./datahub-personal-context/SKILL.md) → also copied to `.agents/skills/` |

Upstream issue: [`UPSTREAM_ISSUE.md`](./UPSTREAM_ISSUE.md).

## Runtime

Broker logs `skill_invocation=datahub-*`. Analytics Agent chains ACK tools + Text-to-SQL per those playbooks.

See [`explainability/README.md`](../explainability/README.md).
