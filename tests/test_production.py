"""Production readiness gates — auth, config, persistence, middleware."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))


def test_production_requires_api_key(monkeypatch):
    monkeypatch.setenv("RESIDENCE_ENV", "production")
    monkeypatch.setenv("RESIDENCE_REQUIRE_AUTH", "1")
    monkeypatch.delenv("RESIDENCE_API_KEY", raising=False)
    import config

    config._settings = None
    with pytest.raises(RuntimeError, match="RESIDENCE_API_KEY"):
        config.load_settings()


def test_dev_settings_load(monkeypatch):
    monkeypatch.setenv("RESIDENCE_ENV", "development")
    monkeypatch.setenv("RESIDENCE_REQUIRE_AUTH", "0")
    monkeypatch.delenv("RESIDENCE_API_KEY", raising=False)
    import config

    config._settings = None
    s = config.load_settings()
    assert s.env == "development"
    assert s.require_auth is False
    assert s.allow_reset is True


def test_pending_persists(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    import desktop_bridge as db

    db._pending = []
    db._loaded = False
    row = db.push_permission({"title": "t", "body": "b", "actionApp": "calendar"})
    assert row["id"]
    assert (tmp_path / "desktop_pending.json").exists()

    db._pending = []
    db._loaded = False
    pending = db.list_pending()
    assert any(p["id"] == row["id"] for p in pending)
    db.resolve(row["id"], True)
    assert row["id"] not in {p["id"] for p in db.list_pending()}


def test_durable_rate_limit_persists(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    from prod_middleware import DurableRateLimiter

    a = DurableRateLimiter(str(tmp_path))
    assert a.limited("127.0.0.1", 2) is False
    assert a.limited("127.0.0.1", 2) is False
    assert a.limited("127.0.0.1", 2) is True
    assert (tmp_path / "rate_limit.json").exists()

    b = DurableRateLimiter(str(tmp_path))
    # Survives process restart within the 60s window
    assert b.limited("127.0.0.1", 2) is True


def test_desktop_heartbeats_exempt_from_rate_limit(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_ENV", "production")
    monkeypatch.setenv("RESIDENCE_REQUIRE_AUTH", "0")
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    monkeypatch.setenv("RESIDENCE_RATE_LIMIT_PER_MINUTE", "2")
    import config

    config._settings = None
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from prod_middleware import ResidenceMiddleware

    app = FastAPI()
    app.add_middleware(ResidenceMiddleware, settings=config.load_settings())

    @app.get("/ready")
    def ready():
        return {"ok": True}

    @app.get("/desktop/pending")
    def pending():
        return {"ok": True, "pending": []}

    @app.post("/desktop/resolve")
    def resolve():
        return {"ok": True}

    client = TestClient(app)
    # Heartbeats never 429 even when over the tiny limit
    for _ in range(8):
        assert client.get("/ready").status_code == 200
        assert client.get("/desktop/pending").status_code == 200
    # Mutating path still rate-limited
    assert client.post("/desktop/resolve").status_code == 200
    assert client.post("/desktop/resolve").status_code == 200
    assert client.post("/desktop/resolve").status_code == 429


def test_auth_middleware_blocks(monkeypatch):
    monkeypatch.setenv("RESIDENCE_ENV", "development")
    monkeypatch.setenv("RESIDENCE_REQUIRE_AUTH", "1")
    monkeypatch.setenv("RESIDENCE_API_KEY", "secret-test-key")
    import config

    config._settings = None
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from prod_middleware import ResidenceMiddleware

    app = FastAPI()
    app.add_middleware(ResidenceMiddleware, settings=config.load_settings())

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/facts/query")
    def facts():
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/facts/query").status_code == 401
    ok = client.get(
        "/facts/query", headers={"Authorization": "Bearer secret-test-key"}
    )
    assert ok.status_code == 200
