#!/usr/bin/env python3
"""BEFORE: each agent has private memory — Shopping green-lights what Finance would block."""

from __future__ import annotations

import json

# Private silos — intentionally NOT using Fact Broker
finance_private = {"ceilingWeeklyUsd": 50}
shopping_private: dict = {}  # never reads finance_private


def shopping_approve(price: float) -> dict:
    # Bug: shopping only knows its own silo
    shopping_private["lastAttempt"] = price
    return {
        "approved": True,
        "reason": "No shared budget visible in private store",
        "price": price,
        "privateFinanceCeiling": None,
    }


def finance_would_have_said(price: float) -> dict:
    return {
        "wouldBlock": price > finance_private["ceilingWeeklyUsd"],
        "ceiling": finance_private["ceilingWeeklyUsd"],
    }


if __name__ == "__main__":
    price = 95
    shop = shopping_approve(price)
    fin = finance_would_have_said(price)
    out = {
        "mode": "before_private_stores",
        "shopping": shop,
        "financeTruth": fin,
        "badOutcome": shop["approved"] and fin["wouldBlock"],
    }
    print(json.dumps(out, indent=2))
    assert out["badOutcome"], "expected bad outcome in before mode"
