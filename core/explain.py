"""Plain-language explanations from live Facts + lineage — judge-facing 'why'."""

from __future__ import annotations

import json
from typing import Any, Optional


def explain_latest_block(broker: Any) -> dict[str, Any]:
    """Find newest blocked purchase Intent and explain via Budget lineage."""
    resp = broker.query_facts("blocked-purchase", "mentor-user", "Intent")
    blocked = [
        r
        for r in resp.results
        if (r.fact.decisionLabel or "").startswith("blocked-purchase")
        or ("blocked" in r.fact.value and "true" in r.fact.value.lower())
    ]
    if not blocked:
        # fallback: any Intent with blocked true
        all_intents = broker.query_facts("purchase", "mentor-user", "Intent")
        for r in all_intents.results:
            try:
                val = json.loads(r.fact.value)
            except Exception:
                continue
            if val.get("blocked"):
                blocked.append(r)
    if not blocked:
        return {
            "ok": False,
            "headline": "Nothing blocked yet",
            "because": "Run Shop after setting a tight Wallet limit.",
            "apps": [],
        }

    latest = sorted(blocked, key=lambda r: r.fact.assertedAt, reverse=True)[0]
    try:
        val = json.loads(latest.fact.value)
    except Exception:
        val = {}
    title = val.get("title") or "that purchase"
    price = val.get("price")
    ceiling = val.get("ceiling")

    lin = broker.lineage(latest.fact.factId)
    budget_id: Optional[str] = None
    for up in lin.get("upstreams") or []:
        urn = up.get("dataset") or ""
        if "fact." in urn:
            budget_id = urn.split("fact.")[-1].rstrip(",PROD)")
            break
    if not budget_id and latest.fact.supersedesFactId:
        budget_id = latest.fact.supersedesFactId

    budget_bit = ""
    if ceiling is not None:
        budget_bit = f" Your weekly spend is ${ceiling}."
    elif budget_id:
        bf = broker.client.get_fact(budget_id)
        if bf:
            try:
                bval = json.loads(bf.value)
                budget_bit = f" Your weekly spend is ${bval.get('ceilingWeeklyUsd')}."
            except Exception:
                pass

    price_bit = f" at ${price}" if price is not None else ""
    return {
        "ok": True,
        "headline": f"Shop paused {title}",
        "because": (
            f"{title}{price_bit} doesn’t fit this week.{budget_bit} "
            "Wallet and Shop share one Budget fact on DataHub — not private memory."
        ),
        "apps": ["wallet", "shop"],
        "decisionFactId": latest.fact.factId,
        "budgetFactId": budget_id,
        "provenance": latest.provenance,
    }
