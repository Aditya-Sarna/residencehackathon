"""Daily usefulness — briefing + calendar import proposals."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import desktop_bridge
from briefing import build_briefing, parse_event_row, propose_calendar_imports


class _FakeBroker:
    def __init__(self, commitments=None, budget=40.0, health=None):
        self.commitments = commitments or []
        self.budget = budget
        self.health = health or ["allergic to peanuts"]

    def query_facts(self, query, agent, glossary_term=None):
        rows = []
        if glossary_term == "Budget" and self.budget is not None:
            rows.append(
                SimpleNamespace(
                    stale=False,
                    fact=SimpleNamespace(
                        value=f'{{"ceilingWeeklyUsd": {self.budget}, "currency": "USD"}}'
                    ),
                )
            )
        elif glossary_term == "Health Condition":
            for note in self.health:
                rows.append(
                    SimpleNamespace(
                        stale=False,
                        fact=SimpleNamespace(value=f'{{"note": "{note}"}}'),
                    )
                )
        elif glossary_term == "Commitment":
            for c in self.commitments:
                import json

                rows.append(
                    SimpleNamespace(
                        stale=False,
                        fact=SimpleNamespace(value=json.dumps(c)),
                    )
                )
        return SimpleNamespace(results=rows)


def test_parse_event_row():
    row = parse_event_row("Lunch with Sam\t2026-08-09\t12:30")
    assert row == {
        "title": "Lunch with Sam",
        "dateISO": "2026-08-09",
        "startHhmm": "12:30",
    }


def test_briefing_surfaces_today_commitment_and_budget():
    today = date.today().isoformat()
    broker = _FakeBroker(
        commitments=[{"title": "Exam", "dayOfMonth": date.today().day, "dateISO": today}]
    )
    b = build_briefing(broker, pending_count=2)
    assert b["ok"]
    assert b["budget"] == 40.0
    assert "peanut" in b["allergens"]
    assert any(c.get("title") == "Exam" for c in b["today"]["commitments"])
    assert b["pendingCount"] == 2
    assert "Today" in b["headline"]


def test_calendar_import_proposes_and_detects_clash(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    desktop_bridge._pending = []
    desktop_bridge._captures = {}
    desktop_bridge._activity = []
    desktop_bridge._loaded = False

    today = date.today()
    broker = _FakeBroker(
        commitments=[
            {
                "title": "Exam",
                "dayOfMonth": today.day,
                "dateISO": today.isoformat(),
            }
        ]
    )
    events = [
        {
            "title": "Lunch with Alex",
            "dateISO": today.isoformat(),
            "startHhmm": "12:00",
        },
        {
            "title": "Exam",
            "dateISO": today.isoformat(),
            "startHhmm": "09:00",
        },
    ]
    out = propose_calendar_imports(
        broker, events, push_permission=desktop_bridge.push_permission
    )
    assert out["proposed"] == 1  # Exam already known; Lunch is new
    assert out["skipped"] >= 1
    assert out["clashes"]
    pending = desktop_bridge.list_pending()
    assert any(p.get("kind") == "calendar_import" for p in pending)
    assert pending[0]["payload"]["dateISO"] == today.isoformat()
