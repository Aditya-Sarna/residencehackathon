"""YouTube search via public mirrors — no Google API key."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from media_apps import youtube_search


def test_youtube_search_returns_videos():
    out = youtube_search("lofi study", limit=4)
    assert out.get("ok") is True
    assert out.get("results")
    first = out["results"][0]
    assert first.get("title")
    assert first.get("embedUrl")
    assert first.get("watchUrl")
    if out.get("source") == "youtube-web":
        pytest.skip("public mirrors unreachable — fallback deep-link only")
