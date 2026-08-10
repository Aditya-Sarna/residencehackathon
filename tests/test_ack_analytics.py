"""Agent Context Kit + Analytics Agent Text-to-SQL + official skills."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

import ack_bridge
import analytics_agent
import fact_warehouse


def test_load_skills_includes_official_datahub_skills_pack():
    skills = ack_bridge.load_skills()
    names = {s["name"] for s in skills}
    assert "datahub-search" in names
    assert "datahub-lineage" in names
    assert "datahub-enrich" in names
    assert "datahub-quality" in names
    assert "datahub-setup" in names
    # Official pack preferred
    search = next(s for s in skills if s["name"] == "datahub-search")
    assert search["source"] == "datahub-project/datahub-skills"
    assert search.get("bytes", 0) > 1000  # full upstream skill, not a stub
    assert "datahub-personal-context" in names
    assert len(skills) >= 10


def test_warehouse_sql_readonly_and_templates():
    table, sql = fact_warehouse.sql_for_question("What is my weekly budget?")
    assert table == "budgets"
    assert sql.upper().startswith("SELECT")
    bad = fact_warehouse.run_sql("DELETE FROM budgets")
    assert not bad["ok"]


def test_warehouse_sync_and_sql(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))

    class F:
        def __init__(self, **kw):
            self.factId = kw["id"]
            self.glossaryTermUrn = kw["term"]
            self.value = kw["value"]
            self.assertedByAgentUrn = "urn:li:corpuser:mentor-user"
            self.assertedAt = "2026-01-01T00:00:00Z"
            self.confidence = 1.0
            self.certificationStatus = MagicMock(value="user_confirmed")
            self.sensitivityTag = MagicMock(value="financial")
            self.decisionLabel = None

    class Row:
        def __init__(self, fact):
            self.fact = fact

    class Resp:
        def __init__(self, rows):
            self.results = rows

    class Broker:
        def query_facts(self, q, agent, term=None):
            if term == "Budget":
                return Resp(
                    [
                        Row(
                            F(
                                id="b1",
                                term="urn:li:glossaryTerm:residence.Budget",
                                value='{"ceilingWeeklyUsd": 40, "currency": "USD"}',
                            )
                        )
                    ]
                )
            if term == "Intent":
                return Resp(
                    [
                        Row(
                            F(
                                id="i1",
                                term="urn:li:glossaryTerm:residence.Intent",
                                value='{"title": "Everyday Runners", "price": 95, "blocked": true, "ceiling": 40}',
                            )
                        )
                    ]
                )
            return Resp([])

    counts = fact_warehouse.sync_from_broker(Broker())
    assert counts["budgets"] == 1
    assert counts["intents"] == 1
    out = fact_warehouse.run_sql(
        "SELECT ceiling_weekly_usd FROM budgets WHERE ceiling_weekly_usd = 40"
    )
    assert out["ok"] and out["rowCount"] == 1


def test_analytics_agent_text_to_sql_path(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))

    class Broker:
        client = MagicMock()

        def query_facts(self, *a, **k):
            class R:
                results = []

            return R()

    with patch.object(
        ack_bridge,
        "ack_search",
        return_value={
            "ok": True,
            "total": 1,
            "searchResults": [
                {
                    "entity": {
                        "urn": "urn:li:dataset:(urn:li:dataPlatform:residence,warehouse.budgets,PROD)",
                        "type": "DATASET",
                        "properties": {"name": "warehouse.budgets"},
                    }
                }
            ],
        },
    ), patch.object(
        ack_bridge, "ack_get_entities", return_value={"ok": True, "entities": []}
    ), patch.object(
        fact_warehouse, "register_datasets", return_value=["urn:li:dataset:warehouse.budgets"]
    ), patch.object(
        fact_warehouse, "sync_from_broker", return_value={"budgets": 1, "facts": 1}
    ), patch.object(
        fact_warehouse,
        "run_sql",
        return_value={
            "ok": True,
            "sql": "SELECT ceiling_weekly_usd FROM budgets",
            "rows": [{"ceiling_weekly_usd": 40}],
            "rowCount": 1,
            "columns": ["ceiling_weekly_usd"],
        },
    ):
        out = analytics_agent.ask("What is my budget?", broker=Broker())
    assert out["ok"]
    assert out["via"] == "agent-context-kit+text-to-sql"
    assert out.get("sql", {}).get("rowCount") == 1
    assert "datahub-search" in out["skills"]


def test_ack_status_shape():
    st = ack_bridge.status()
    assert "ackAvailable" in st
    assert st["package"] == "datahub-agent-context"
