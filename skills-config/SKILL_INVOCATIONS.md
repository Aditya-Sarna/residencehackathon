# DataHub skill invocation sites (Residence Core)

These map playbook skill patterns to code paths in `core/`. The broker logs each call as `skill_invocation=<name>`.

| Skill pattern | Where | Purpose |
|---|---|---|
| `datahub-search` | `FactBroker.query_facts`, `FactBroker._active_facts_for_term` → `DataHubClient.search_facts` | Find Facts by query / glossary |
| `datahub-lineage` | `FactBroker.assert_fact` (conflict + supersedes), `FactBroker.lineage`, `FactBroker.impact_analysis`, `POST /facts/{down}/link/{up}` | Ownership chain + impact analysis |
| `datahub-enrich` | `FactBroker.assert_fact` (write), `FactBroker.certify` | Persist Fact aspects; certify to `user_confirmed` |
| `datahub-quality` | `FactBroker.query_facts` when `is_stale(fact)` | TTL / staleness signaling |

Composition skill (upstream candidate): [`datahub-personal-context/SKILL.md`](./datahub-personal-context/SKILL.md).
