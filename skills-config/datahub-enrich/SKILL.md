---
name: datahub-enrich
description: Write and certify personal Facts — ownership, glossary, tags, domains.
---

# datahub-enrich

1. Every Accept / assert writes Dataset + Ownership + GlossaryTerms + Tags + Domains via RestEmitter.
2. ACK `get_entities` reads the enriched aspects back for Analytics Agent answers.
3. Human certify → `certificationStatus=user_confirmed`, confidence 1.0.
