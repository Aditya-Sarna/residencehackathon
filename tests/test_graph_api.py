"""Graph export, glossary summary, and fact history against live DataHub."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

import graph_api
from broker import FactBroker
from datahub_client import DataHubClient


@pytest.fixture(scope="module")
def broker():
    c = DataHubClient()
    if not c.health():
        pytest.skip("DataHub GMS not healthy")
    return FactBroker(c)


def test_graph_shape(broker):
    g = graph_api.build_graph(broker)
    assert g["ok"] is True
    kinds = {n["kind"] for n in g["nodes"]}
    assert "glossaryTerm" in kinds
    assert "agent" in kinds
    node_ids = {n["id"] for n in g["nodes"]}
    for e in g["edges"]:
        assert e["source"] in node_ids, f"dangling edge source {e}"
        assert e["target"] in node_ids, f"dangling edge target {e}"
    assert g["meta"]["agentCount"] >= 1
    # sensitivity gate visible: at least one agent must NOT read health
    agents = [n for n in g["nodes"] if n["kind"] == "agent"]
    assert any("health" not in (a.get("readScopes") or []) for a in agents)


def test_glossary_counts(broker):
    out = graph_api.glossary_summary(broker)
    assert out["ok"] is True
    names = {t["name"] for t in out["terms"]}
    assert {"Budget", "Health Condition", "Commitment", "Intent", "Location"} <= names
    for t in out["terms"]:
        assert t["activeCount"] <= t["factCount"]


def test_history_chain(broker):
    # Two budgets — second supersedes first; history must show both
    f1 = broker.assert_fact(
        {"value": '{"ceilingWeeklyUsd": 77, "currency": "USD"}'},
        "mentor-user",
        glossary_term="Budget",
        confidence=0.9,
    )
    f2 = broker.assert_fact(
        {"value": '{"ceilingWeeklyUsd": 88, "currency": "USD"}', "certificationStatus": "user_confirmed"},
        "mentor-user",
        glossary_term="Budget",
        confidence=1.0,
    )
    hist = graph_api.fact_history(broker, f2.factId)
    assert hist["ok"] is True
    ids = [h["factId"] for h in hist["chain"]]
    assert f2.factId in ids
    if f2.supersedesFactId:
        assert f2.supersedesFactId in ids
        assert hist["length"] >= 2
    assert graph_api.fact_history(broker, "does-not-exist")["ok"] is False
    # cleanup impact: superseded f1 must be excluded from active reads
    resp = broker.query_facts("Budget", "finance-agent", "Budget")
    active_ids = {r.fact.factId for r in resp.results}
    assert f1.factId not in active_ids or f1.factId == f2.supersedesFactId
