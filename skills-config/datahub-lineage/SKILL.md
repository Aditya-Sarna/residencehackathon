---
name: datahub-lineage
description: Trace upstream/downstream lineage for personal Facts (Budget → blocked Intent).
---

# datahub-lineage

1. Use ACK `get_lineage` on Fact dataset URNs.
2. On conflict/supersede, Residence emits UpstreamLineage (Budget → purchase Intent).
3. Analytics Agent and `/explain/latest-block` walk these edges for plain-language Why.
