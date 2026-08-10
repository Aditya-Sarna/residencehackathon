"""Real Claude (Anthropic) chat with Residence connected — session + Messages API."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

log = logging.getLogger("residence.claude")

_session_key: Optional[str] = None

SYSTEM = (
    "You are Claude inside the Residence phone. Residence is a personal context OS: "
    "Calendar, Wallet, Shop, Wellness, and Voice share Facts through DataHub — not private silos.\n"
    "When the user mentions plans, exams, deadlines, money, shopping, or health, reply helpfully "
    "in 2–4 short sentences. Mention that Residence can turn it into a note or calendar item if they tap "
    "the notification. Do not claim you wrote Facts yourself; Residence handles that. Be warm and concise."
)


def active_key() -> Optional[str]:
    if _session_key and _session_key.strip():
        return _session_key.strip()
    env = os.getenv("ANTHROPIC_API_KEY", "").strip()
    return env or None


def status() -> dict[str, Any]:
    key = active_key()
    return {
        "ok": True,
        "loggedIn": bool(key),
        "residenceConnected": bool(key),
        "source": "session" if _session_key else ("env" if key else None),
        "model": "claude-3-5-haiku-latest",
    }


def login(api_key: Optional[str] = None) -> dict[str, Any]:
    global _session_key
    candidate = (api_key or "").strip() or os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not candidate:
        return {
            "ok": False,
            "loggedIn": False,
            "residenceConnected": False,
            "error": "Paste an Anthropic API key, or set ANTHROPIC_API_KEY on Core.",
        }
    # Light validation — real check happens on first chat
    if not candidate.startswith("sk-ant-") and len(candidate) < 20:
        return {
            "ok": False,
            "loggedIn": False,
            "residenceConnected": False,
            "error": "That does not look like an Anthropic API key.",
        }
    if api_key and api_key.strip():
        _session_key = api_key.strip()
    return {
        "ok": True,
        "loggedIn": True,
        "residenceConnected": True,
        "source": "session" if _session_key else "env",
        "model": "claude-3-5-haiku-latest",
    }


def logout() -> dict[str, Any]:
    global _session_key
    _session_key = None
    return {"ok": True, "loggedIn": bool(active_key()), "residenceConnected": bool(active_key())}


def chat(message: str, history: Optional[list[dict[str, str]]] = None) -> dict[str, Any]:
    key = active_key()
    if not key:
        return {
            "ok": False,
            "error": "not_logged_in",
            "reply": "",
        }

    messages: list[dict[str, str]] = []
    for turn in history or []:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message.strip()})

    try:
        import httpx

        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 500,
                "system": SYSTEM,
                "messages": messages,
            },
            timeout=35,
        )
        if r.status_code == 401:
            return {"ok": False, "error": "invalid_api_key", "reply": ""}
        r.raise_for_status()
        data = r.json()
        parts = data.get("content") or []
        reply = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
        return {
            "ok": True,
            "reply": reply or "Got it.",
            "model": data.get("model", "claude-3-5-haiku-latest"),
            "residenceConnected": True,
        }
    except Exception as e:
        log.warning("Claude chat failed: %s", e)
        return {"ok": False, "error": str(e), "reply": ""}


def caption_image(
    image_base64: str,
    media_type: str = "image/png",
    *,
    hint: str = "",
) -> dict[str, Any]:
    """Short vision caption + keywords for chat recall (Haiku)."""
    key = active_key()
    if not key:
        return {"ok": False, "error": "not_logged_in", "caption": "", "keywords": []}
    b64 = (image_base64 or "").strip()
    if b64.startswith("data:"):
        # data:image/png;base64,....
        try:
            header, b64 = b64.split(",", 1)
            if "image/" in header:
                media_type = header.split(";")[0].split(":")[-1] or media_type
        except ValueError:
            pass
    if not b64:
        return {"ok": False, "error": "empty_image", "caption": "", "keywords": []}

    mt = media_type if media_type in ("image/png", "image/jpeg", "image/gif", "image/webp") else "image/png"
    prompt = (
        "Describe this image in one short sentence for personal memory search. "
        "Then on a new line list 6-10 lowercase keywords separated by commas "
        "(people, objects, place, clothing, activity). No markdown."
    )
    if hint.strip():
        prompt += f"\nUser hint: {hint.strip()[:200]}"

    try:
        import httpx

        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 220,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mt,
                                    "data": b64,
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            },
            timeout=45,
        )
        if r.status_code == 401:
            return {"ok": False, "error": "invalid_api_key", "caption": "", "keywords": []}
        r.raise_for_status()
        data = r.json()
        parts = data.get("content") or []
        reply = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
        lines = [ln.strip() for ln in reply.splitlines() if ln.strip()]
        caption = lines[0] if lines else reply
        keywords: list[str] = []
        if len(lines) > 1:
            keywords = [
                k.strip().lower()
                for k in lines[-1].replace(";", ",").split(",")
                if k.strip()
            ]
        return {
            "ok": True,
            "caption": caption[:300],
            "keywords": keywords[:12],
            "model": data.get("model", "claude-3-5-haiku-latest"),
        }
    except Exception as e:
        log.warning("caption_image failed: %s", e)
        return {"ok": False, "error": str(e), "caption": "", "keywords": []}
