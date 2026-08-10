"""Production configuration — fail closed when RESIDENCE_ENV=production."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Settings:
    env: str
    api_key: str
    datahub_gms_url: str
    datahub_token: str
    datahub_ui_url: str
    cors_origins: list[str]
    allow_reset: bool
    rate_limit_per_minute: int
    host: str
    port: int
    persist_dir: str
    require_auth: bool
    agent_cache_ttl_seconds: int

    @property
    def is_production(self) -> bool:
        return self.env.lower() in ("production", "prod")


def load_settings() -> Settings:
    env = (os.getenv("RESIDENCE_ENV") or "development").strip()
    api_key = (os.getenv("RESIDENCE_API_KEY") or "").strip()
    gms = (os.getenv("DATAHUB_GMS_URL") or "http://localhost:8080").rstrip("/")
    cors_raw = os.getenv("RESIDENCE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    origins = [o.strip() for o in cors_raw.split(",") if o.strip()]
    if os.getenv("RESIDENCE_CORS_ORIGINS", "").strip() == "*":
        origins = ["*"]

    is_prod = env.lower() in ("production", "prod")
    allow_reset = os.getenv("RESIDENCE_ALLOW_RESET", "0" if is_prod else "1") == "1"
    require_auth = os.getenv("RESIDENCE_REQUIRE_AUTH", "1" if is_prod else "0") == "1"

    if is_prod and require_auth and not api_key:
        raise RuntimeError(
            "RESIDENCE_ENV=production requires RESIDENCE_API_KEY "
            "(or set RESIDENCE_REQUIRE_AUTH=0 explicitly)."
        )
    if is_prod and not origins:
        raise RuntimeError("RESIDENCE_CORS_ORIGINS must be set in production.")

    # UI usually shares host with GMS on quickstart (port 9002) — overridable.
    ui = (os.getenv("DATAHUB_UI_URL") or "").strip().rstrip("/")
    if not ui:
        # Derive from GMS: localhost:8080 → localhost:9002
        if ":8080" in gms:
            ui = gms.replace(":8080", ":9002")
        else:
            ui = gms

    return Settings(
        env=env,
        api_key=api_key,
        datahub_gms_url=gms,
        datahub_token=(os.getenv("DATAHUB_GMS_TOKEN") or "").strip(),
        datahub_ui_url=ui,
        cors_origins=origins,
        allow_reset=allow_reset,
        # Personal OS: Mac + shell poll often; 120/min was starving Accept/Notes write-back.
        rate_limit_per_minute=int(os.getenv("RESIDENCE_RATE_LIMIT_PER_MINUTE", "600")),
        host=os.getenv("CORE_HOST", "127.0.0.1" if is_prod else "0.0.0.0"),
        port=int(os.getenv("CORE_PORT", "8700")),
        persist_dir=os.getenv(
            "RESIDENCE_PERSIST_DIR",
            str((__import__("pathlib").Path.home() / ".residence")),
        ),
        require_auth=require_auth,
        agent_cache_ttl_seconds=int(os.getenv("RESIDENCE_AGENT_CACHE_TTL", "30")),
    )


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings
