"""Activity heatmap — real Fact timestamps for the home UI."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from datahub_client import DataHubClient
from main import activity, ready


@pytest.fixture(scope="module")
def live():
    c = DataHubClient()
    if not c.health():
        pytest.skip("DataHub GMS not healthy")
    return c


def test_ready_reports_datahub(live):
    out = ready()
    assert out["ok"] is True
    assert out["core"] is True
    assert out["datahub"] is True


def test_activity_returns_sunday_aligned_cells(live):
    out = activity(28)
    assert out["ok"] is True
    assert len(out["cells"]) >= 28
    assert len(out["cells"]) % 7 == 0
    assert out["cells"][0]["weekday"] == "Sun"
    assert all("intensity" in c and "count" in c for c in out["cells"])
    assert out["total"] >= 0
