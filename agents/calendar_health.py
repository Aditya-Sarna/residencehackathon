"""Calendar/Health Agent — commitments → events; health facts stay sensitivity-gated."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

CORE = os.getenv("CORE_PUBLIC_URL", "http://localhost:8700")

# Local event store is derived from Core facts only (no private memory of commitments)
_EVENTS: list[dict[str, Any]] = []


def sync_events_from_facts() -> list[dict[str, Any]]:
    global _EVENTS
    r = httpx.post(
        f"{CORE}/facts/query",
        json={
            "query": "Commitment",
            "requesting_agent_id": "calendar-health-agent",
            "glossary_term": "Commitment",
        },
        timeout=30,
    ).json()
    events = []
    for item in r["results"]:
        fact = item["fact"]
        try:
            val = json.loads(fact["value"])
        except Exception:
            val = {"title": fact["value"]}
        events.append(
            {
                "id": fact["factId"],
                "title": val.get("title") or val.get("item") or "Commitment",
                "dayOfMonth": val.get("dayOfMonth"),
                "provenance": item.get("provenance"),
                "sensitivityTag": fact["sensitivityTag"],
            }
        )
    _EVENTS = events
    return events


def create_event(title: str, day_of_month: int) -> dict[str, Any]:
    resp = httpx.post(
        f"{CORE}/facts/assert",
        json={
            "agent_id": "calendar-health-agent",
            "glossary_term": "Commitment",
            "confidence": 0.9,
            "decision_label": "calendar-event",
            "fact": {
                "value": json.dumps({"title": title, "dayOfMonth": day_of_month}),
                "certificationStatus": "user_confirmed",
            },
        },
        timeout=30,
    ).json()
    sync_events_from_facts()
    return resp


def delete_event(fact_id: str) -> dict[str, Any]:
    # Soft-supersede with cancelled marker
    resp = httpx.post(
        f"{CORE}/facts/assert",
        json={
            "agent_id": "calendar-health-agent",
            "glossary_term": "Commitment",
            "fact": {
                "value": json.dumps({"title": "cancelled", "cancelledFactId": fact_id}),
                "supersedesFactId": fact_id,
                "certificationStatus": "superseded",
            },
        },
        timeout=30,
    ).json()
    sync_events_from_facts()
    return resp


def write_health(note: str) -> dict[str, Any]:
    return httpx.post(
        f"{CORE}/facts/assert",
        json={
            "agent_id": "calendar-health-agent",
            "glossary_term": "Health Condition",
            "sensitivity_tag": "health",
            "confidence": 1.0,
            "fact": {
                "value": json.dumps({"note": note}),
                "certificationStatus": "user_confirmed",
            },
        },
        timeout=30,
    ).json()


def list_health_as(agent_id: str) -> dict[str, Any]:
    return httpx.post(
        f"{CORE}/facts/query",
        json={
            "query": "Health",
            "requesting_agent_id": agent_id,
            "glossary_term": "Health Condition",
        },
        timeout=30,
    ).json()


if __name__ == "__main__":
    print(json.dumps(sync_events_from_facts(), indent=2))
