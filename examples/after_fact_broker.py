#!/usr/bin/env python3
"""AFTER: same agents through Fact Broker — Shopping blocked by live Budget fact."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents"))

from shopping import evaluate_purchase, search
from finance import set_ceiling

CORE = os.getenv("CORE_PUBLIC_URL", "http://localhost:8700")


def main() -> None:
    # Ensure a tight certified ceiling exists on the shared graph (wins conflict)
    set_ceiling(50, certify=True)
    # Confirm ceiling readable by shopping
    import httpx as _httpx

    check = _httpx.post(
        f"{CORE}/facts/query",
        json={
            "query": "ceilingWeeklyUsd",
            "requesting_agent_id": "shopping-agent",
            "glossary_term": "Budget",
        },
        timeout=30,
    ).json()
    live = [x for x in check["results"] if not x.get("stale")]
    assert live, f"expected live budget after set_ceiling, got {check}"
    products = search("shoes")
    assert products, "catalog empty"
    result = evaluate_purchase(products[0]["id"])
    out = {
        "mode": "after_fact_broker",
        "product": products[0],
        "result": result,
        "goodOutcome": result.get("blocked") is True,
        "healthLeak": result.get("healthLeak"),
    }
    print(json.dumps(out, indent=2))
    assert out["goodOutcome"], "expected shopping to block against shared budget"
    assert out["healthLeak"] is False, "sensitivity gate leaked health to shopping"


if __name__ == "__main__":
    main()
