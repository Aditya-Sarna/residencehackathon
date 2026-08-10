"""Finance Agent — owns Budget ceiling facts; reads purchase attempts."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

CORE = os.getenv("CORE_PUBLIC_URL", "http://localhost:8700")


def get_ceiling() -> dict[str, Any]:
    r = httpx.post(
        f"{CORE}/facts/query",
        json={
            "query": "ceilingWeeklyUsd",
            "requesting_agent_id": "finance-agent",
            "glossary_term": "Budget",
        },
        timeout=30,
    ).json()
    live = [x for x in r["results"] if not x.get("stale")]
    if not live:
        return {"ceiling": None, "results": r["results"]}
    val = json.loads(live[0]["fact"]["value"])
    return {
        "ceiling": val.get("ceilingWeeklyUsd"),
        "factId": live[0]["fact"]["factId"],
        "provenance": live[0].get("provenance"),
        "staleCandidates": len(r["results"]) - len(live),
    }


def set_ceiling(weekly_usd: float, certify: bool = False) -> dict[str, Any]:
    resp = httpx.post(
        f"{CORE}/facts/assert",
        json={
            "agent_id": "finance-agent" if not certify else "mentor-user",
            "glossary_term": "Budget",
            "sensitivity_tag": "financial",
            "confidence": 1.0 if certify else 0.8,
            "decision_label": "budget-ceiling-update",
            "fact": {
                "value": json.dumps({"ceilingWeeklyUsd": weekly_usd, "currency": "USD"}),
                "certificationStatus": "user_confirmed" if certify else "inferred",
                "ttlSeconds": 7 * 24 * 3600,
            },
        },
        timeout=30,
    ).json()
    fact = resp["fact"]
    if certify:
        httpx.post(f"{CORE}/facts/{fact['factId']}/certify", timeout=30)
    return resp


def spent_from_purchases() -> dict[str, Any]:
    r = httpx.post(
        f"{CORE}/facts/query",
        json={"query": "purchase", "requesting_agent_id": "finance-agent"},
        timeout=30,
    ).json()
    total = 0.0
    rows = []
    for item in r["results"]:
        try:
            val = json.loads(item["fact"]["value"])
        except Exception:
            continue
        if "price" in val and not val.get("blocked"):
            total += float(val["price"])
            rows.append(val)
    ceiling = get_ceiling()
    return {
        "spent": total,
        "ceiling": ceiling.get("ceiling"),
        "remaining": (ceiling["ceiling"] - total) if ceiling.get("ceiling") is not None else None,
        "purchases": rows,
    }


if __name__ == "__main__":
    print(json.dumps(get_ceiling(), indent=2))
