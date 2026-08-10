"""No-key public apps — Nominatim + Open-Meteo (+ Residence listen)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from inference import InferenceEngine
from public_apps import search_places, weather_for


def test_maps_search_returns_places():
    out = search_places("Golden Gate Bridge", limit=2)
    if not out.get("ok"):
        pytest.skip(out.get("error") or "nominatim unavailable")
    assert out["results"]
    assert "lat" in out["results"][0]
    assert "googleMapsUrl" in out["results"][0]


def test_weather_open_meteo():
    out = weather_for(37.7749, -122.4194, place="San Francisco")
    if not out.get("ok"):
        pytest.skip(out.get("error") or "open-meteo unavailable")
    assert out["current"]["temp"] is not None
    assert out["daily"]


def test_notes_listen_exam_suggests_calendar():
    out = InferenceEngine().infer(
        "Study for exam tomorrow",
        source_app="notes",
        persist=False,
        use_llm=False,
    )
    assert out["ok"]
    assert any(n["actionApp"] == "calendar" for n in out["notifications"])
