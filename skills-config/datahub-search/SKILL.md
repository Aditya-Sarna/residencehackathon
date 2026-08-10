---
name: datahub-search
description: Find Residence Facts, glossary terms, and agents in DataHub GMS via Agent Context Kit search.
---

# datahub-search

1. Prefer ACK `search` with `/q` syntax against GMS (`DATAHUB_GMS_URL`).
2. Filter to Personal Context domain / platform `residence` when looking for Facts.
3. Map hits to glossary vocabulary: Budget · Commitment · Intent · Health Condition · Location.
4. Never return Health Condition values to agents whose CorpUser `readScopes` exclude health.
