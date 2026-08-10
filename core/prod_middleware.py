"""Auth, durable rate limiting, request IDs — production middleware."""

from __future__ import annotations

import hmac
import json
import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from config import Settings

log = logging.getLogger("residence.http")

# Paths that stay public even with auth on
PUBLIC_PATHS = {"/health", "/ready", "/alive", "/docs", "/openapi.json", "/redoc"}

# Heartbeats / inbox polls must not burn the Accept budget (Mac + shell poll aggressively)
RATE_LIMIT_EXEMPT_PREFIXES = (
    "/health",
    "/ready",
    "/alive",
    "/desktop/pending",
    "/desktop/activity",
    "/desktop/briefing",
)


class DurableRateLimiter:
    """Sliding-window limiter that survives process restarts (file-backed)."""

    def __init__(self, persist_dir: str) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque] = defaultdict(deque)
        self._path = Path(persist_dir) / "rate_limit.json"
        self._last_flush = 0.0
        self._load()

    def _load(self) -> None:
        try:
            if not self._path.exists():
                return
            raw = json.loads(self._path.read_text())
            now = time.time()
            for key, times in (raw or {}).items():
                q = deque(t for t in times if now - t <= 60)
                if q:
                    self._hits[key] = q
        except Exception as e:
            log.warning("rate_limit load failed: %s", e)

    def _flush(self, force: bool = False) -> None:
        now = time.time()
        # Throttle normal writes; always persist when force=True (limit hit / shutdown)
        if not force and now - self._last_flush < 1.0:
            return
        self._last_flush = now
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            payload = {k: list(v) for k, v in self._hits.items() if v}
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload))
            os.replace(tmp, self._path)
        except Exception as e:
            log.warning("rate_limit flush failed: %s", e)

    def limited(self, key: str, limit: int) -> bool:
        if limit <= 0:
            return False
        now = time.time()
        with self._lock:
            window = self._hits[key]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= limit:
                self._flush(force=True)
                return True
            window.append(now)
            # Force flush when approaching the ceiling so restarts stay accurate
            self._flush(force=len(window) >= max(1, limit - 1))
            return False


class ResidenceMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self.settings = settings
        self._limiter = DurableRateLimiter(settings.persist_dir)

    def _client_key(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _authorized(self, request: Request) -> bool:
        if not self.settings.require_auth:
            return True
        if not self.settings.api_key:
            return False
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
            return hmac.compare_digest(token, self.settings.api_key)
        return hmac.compare_digest(
            request.headers.get("x-residence-key", "").strip(), self.settings.api_key
        )

    def _rate_limit_exempt(self, path: str) -> bool:
        return any(path == p or path.startswith(p + "/") for p in RATE_LIMIT_EXEMPT_PREFIXES)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.time()
        path = request.url.path

        if not self._rate_limit_exempt(path) and self._limiter.limited(
            self._client_key(request), self.settings.rate_limit_per_minute
        ):
            return JSONResponse(
                {"ok": False, "error": "rate_limited", "requestId": req_id},
                status_code=429,
                headers={"X-Request-Id": req_id, "Retry-After": "5"},
            )

        if path not in PUBLIC_PATHS and not self._authorized(request):
            return JSONResponse(
                {"ok": False, "error": "unauthorized", "requestId": req_id},
                status_code=401,
                headers={"X-Request-Id": req_id, "WWW-Authenticate": "Bearer"},
            )

        try:
            response = await call_next(request)
        except Exception:
            log.exception("request_failed id=%s path=%s", req_id, path)
            return JSONResponse(
                {"ok": False, "error": "internal_error", "requestId": req_id},
                status_code=500,
                headers={"X-Request-Id": req_id},
            )

        response.headers["X-Request-Id"] = req_id
        response.headers["X-Residence-Env"] = self.settings.env
        ms = int((time.time() - start) * 1000)
        log.info(
            "id=%s method=%s path=%s status=%s ms=%s",
            req_id,
            request.method,
            path,
            response.status_code,
            ms,
        )
        return response
