"""Inference gates — routing into the five Residence apps."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from inference import (
    CANONICAL_APPS,
    InferenceEngine,
    extract_slots,
    resolve_calendar_when,
)


def test_birthday_routes_calendar_and_shop():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "Sam birthday on the 15th, I want to get them shoes",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    apps = {n["actionApp"] for n in out["notifications"]}
    assert apps <= set(CANONICAL_APPS)
    assert "calendar" in apps
    assert "shop" in apps
    assert out["slots"]["person"] == "Sam"
    assert out["slots"]["dayOfMonth"] == 15


def test_tight_balance_routes_wallet():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "my balance isn't much, I only have $40 this week",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    apps = {n["actionApp"] for n in out["notifications"]}
    assert apps <= set(CANONICAL_APPS)
    assert "wallet" in apps
    assert out["slots"]["budgetTight"] is True


def test_time_routes_calendar():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "remind me at 7pm to call mom",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    apps = {n["actionApp"] for n in out["notifications"]}
    assert "calendar" in apps
    assert "clock" not in apps
    assert out["slots"]["time"] == "19:00"


def test_resolve_calendar_when_tomorrow_and_time():
    info = resolve_calendar_when(
        relative_when="tomorrow",
        time_hhmm="15:00",
        today=date(2026, 8, 10),
    )
    assert info["dateISO"] == "2026-08-11"
    assert info["startHhmm"] == "15:00"
    assert "3:00" in info["whenLabel"] or "15:00" in info["whenLabel"]


def test_resolve_calendar_when_weekday():
    # 2026-08-10 is Monday → next Friday is 2026-08-14
    info = resolve_calendar_when(weekday=4, today=date(2026, 8, 10))
    assert info["dateISO"] == "2026-08-14"


def test_commitment_payload_has_date_fields():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "meeting tomorrow at 3pm",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    cal = [i for i in out["intents"] if i["target_app"] == "calendar"]
    assert cal
    payload = cal[0]["payload"]
    assert payload.get("dateISO")
    assert payload.get("startHhmm") in ("15:00", "3:00") or payload.get("startHhmm") == "15:00"
    assert cal[0]["title"] == "Add to Calendar?"


def test_allergy_routes_wellness():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "I'm allergic to nickel",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    apps = {n["actionApp"] for n in out["notifications"]}
    assert apps == {"wellness"} or "wellness" in apps


def test_trip_routes_calendar_only():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "flying to Tokyo next month",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    apps = {n["actionApp"] for n in out["notifications"]}
    assert apps <= set(CANONICAL_APPS)
    assert "calendar" in apps
    assert "travel" not in apps


def test_slots_extract_money_and_day():
    s = extract_slots("budget of $120 for shoes on the 22nd")
    assert 120.0 in s.money
    assert s.day_of_month == 22
