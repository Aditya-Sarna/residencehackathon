"""Judge demo — deterministic winning path on live DataHub."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from datahub_client import DataHubClient
from main import judge_demo


@pytest.fixture(scope="module")
def live():
    c = DataHubClient()
    if not c.health():
        pytest.skip("DataHub GMS not healthy")
    return c


def test_judge_demo_blocks_and_keeps_health_private(live):
    out = judge_demo()
    assert out["ok"] is True
    assert out["blocked"] is True
    assert out["leaked"] is False
    assert out["why"]["ok"] is True
    assert out["closing"]["headline"]
    assert len(out["closing"]["bullets"]) >= 3
    apps = {n["actionApp"] for n in out["notifications"]}
    assert "calendar" in apps or "shop" in apps or "wallet" in apps
    ids = {s["id"] for s in out["steps"]}
    assert {"wallet", "voice", "shop", "wellness"} <= ids
