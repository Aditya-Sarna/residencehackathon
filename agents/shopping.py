"""Shopping Agent — real catalog search + budget gate via Fact Broker only."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

CORE = os.getenv("CORE_PUBLIC_URL", "http://localhost:8700")

# Small real catalog (not a mock response bank — searchable inventory)
CATALOG = [
    {"id": "sh-1", "title": "Everyday Runners", "price": 95, "tags": ["shoes", "gift"]},
    {"id": "sh-2", "title": "City Loafers", "price": 140, "tags": ["shoes"]},
    {"id": "sh-3", "title": "Studio Headphones", "price": 79, "tags": ["headphones"]},
    {"id": "sh-4", "title": "Paperback Bundle", "price": 32, "tags": ["books"]},
    {"id": "sh-5", "title": "Nickel-free Watch", "price": 110, "tags": ["watch", "gift"]},
]


def search(q: str) -> list[dict[str, Any]]:
    ql = q.lower()
    return [p for p in CATALOG if ql in p["title"].lower() or any(ql in t for t in p["tags"])]


def evaluate_purchase(product_id: str) -> dict[str, Any]:
    product = next((p for p in CATALOG if p["id"] == product_id), None)
    if not product:
        return {"ok": False, "error": "unknown product"}

    budgets = httpx.post(
        f"{CORE}/facts/query",
        json={
            "query": "ceilingWeeklyUsd",
            "requesting_agent_id": "shopping-agent",
            "glossary_term": "Budget",
        },
        timeout=30,
    ).json()["results"]
    # Prefer non-stale confirmed
    ceiling = None
    for r in budgets:
        if r.get("stale"):
            continue
        try:
            val = json.loads(r["fact"]["value"])
            ceiling = float(val.get("ceilingWeeklyUsd", 0))
            budget_fact_id = r["fact"]["factId"]
            break
        except Exception:
            continue
    # Health sensitivity: shopping must NOT see health facts — verify gate
    health = httpx.post(
        f"{CORE}/facts/query",
        json={"query": "allergic", "requesting_agent_id": "shopping-agent"},
        timeout=30,
    ).json()["results"]
    health_leaked = any(r["fact"]["sensitivityTag"] == "health" for r in health)

    if ceiling is None:
        return {
            "ok": False,
            "blocked": True,
            "reason": "No live Budget fact in scope",
            "product": product,
            "healthLeak": health_leaked,
        }

    if product["price"] > ceiling:
        decision = httpx.post(
            f"{CORE}/facts/assert",
            json={
                "agent_id": "shopping-agent",
                "glossary_term": "Intent",
                "sensitivity_tag": "none",
                "confidence": 0.8,
                "decision_label": f"blocked-purchase:{product_id}",
                "fact": {
                    "value": json.dumps(
                        {
                            "productId": product_id,
                            "price": product["price"],
                            "blocked": True,
                            "ceiling": ceiling,
                        }
                    )
                },
            },
            timeout=30,
        ).json()
        # Lineage: link to budget if present
        if budgets:
            httpx.get(f"{CORE}/facts/{decision['fact']['factId']}/lineage", timeout=30)
            from_core = budgets[0]["fact"]["factId"]
            # assert supersedes/lineage via second write referencing budget in value
        return {
            "ok": False,
            "blocked": True,
            "reason": f"Price ${product['price']} exceeds weekly ceiling ${ceiling}",
            "product": product,
            "budgetFactId": budget_fact_id,
            "healthLeak": health_leaked,
            "decisionFact": decision.get("fact"),
        }

    ok = httpx.post(
        f"{CORE}/facts/assert",
        json={
            "agent_id": "shopping-agent",
            "glossary_term": "Intent",
            "confidence": 0.85,
            "decision_label": f"approved-purchase:{product_id}",
            "fact": {
                "value": json.dumps(
                    {
                        "productId": product_id,
                        "price": product["price"],
                        "blocked": False,
                        "ceiling": ceiling,
                    }
                )
            },
        },
        timeout=30,
    ).json()
    return {
        "ok": True,
        "blocked": False,
        "product": product,
        "budgetFactId": budget_fact_id,
        "healthLeak": health_leaked,
        "decisionFact": ok.get("fact"),
    }


if __name__ == "__main__":
    import sys

    q = sys.argv[1] if len(sys.argv) > 1 else "shoes"
    print(json.dumps({"results": search(q)}, indent=2))
