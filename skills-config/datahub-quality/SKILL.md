---
name: datahub-quality
description: TTL staleness + native Assertion run events on Fact conflicts (OSS).
---

# datahub-quality

1. Flag Facts where `assertedAt + ttlSeconds` is past.
2. On conflict, emit native AssertionInfo + AssertionRunEvent on the Fact dataset.
3. Surface quality in Analytics Agent answers about blocked purchases / budget clashes.
