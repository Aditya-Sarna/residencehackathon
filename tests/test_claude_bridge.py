"""Claude → Residence: exam utterance becomes a calendar note suggestion."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from inference import InferenceEngine


def test_exam_tomorrow_suggests_calendar_note():
    out = InferenceEngine().infer(
        "I have an exam tomorrow",
        source_app="claude",
        persist=False,
        use_llm=False,
    )
    assert out["ok"] is True
    apps = {n["actionApp"] for n in out["notifications"]}
    assert "calendar" in apps
    cal = next(n for n in out["notifications"] if n["actionApp"] == "calendar")
    assert "note" in cal["title"].lower() or "calendar" in cal["title"].lower()
    assert "exam" in cal["body"].lower() or "exam" in (cal["payload"].get("title") or "").lower()
