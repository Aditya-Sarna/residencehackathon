---
name: datahub-personal-context
description: Compose DataHub search, lineage, enrich, and quality skills for a personal context graph (Residence pattern).
---

# datahub-personal-context

Use this skill when an agent needs shared personal memory backed by DataHub rather than a private store.

## Workflow

1. **Resolve vocabulary** — map the user's phrase to a Business Glossary term (`Budget`, `Commitment`, `Intent`, `Health Condition`, `Location`). Reject unresolved terms (glossary enforcement).
2. **`datahub-search`** — find candidate Fact datasets under platform `residence` filtered by glossary term + recency.
3. **Sensitivity gate** — compare the requesting agent's `readScopes` (on its CorpUser / Agent Registry entry) to the fact's `sensitivityTag` before returning values.
4. **`datahub-quality` / TTL** — if `assertedAt + ttlSeconds` is in the past, mark the fact stale and surface that to the user.
5. **Write path** — `assert_fact` emits Dataset + Ownership + GlossaryTerms + Tags; on correction set `supersedesFactId` and emit UpstreamLineage (`datahub-lineage`).
6. **`datahub-enrich`** — on human certify, set `certificationStatus=user_confirmed` and `confidence=1.0`.

## Why not Postgres

DataHub's Context Platform thesis (unify technical metadata, business knowledge, and docs for agents) is the enterprise form of this pattern. Residence is the personal-scale instance — ownership, lineage, glossary, and certification are the product, not optional labels.
