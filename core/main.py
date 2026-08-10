"""Residence Core — FastAPI Fact Broker surface."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

logging.basicConfig(
    level=os.getenv("RESIDENCE_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

from broker import FactBroker
import ack_bridge
import analytics_agent
import claude_bridge
import desktop_bridge
import media_apps
import public_apps
from config import get_settings
from datahub_client import DataHubClient
from explain import explain_latest_block
import graph_api
from inference import InferenceEngine
from models import (
    AssertFactRequest,
    QueryFactsRequest,
    SensitivityTag,
)
from prod_middleware import ResidenceMiddleware

settings = get_settings()

app = FastAPI(title="RESIDENCE Core", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Browsers reject wildcard origins combined with credentials
    allow_credentials=settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ResidenceMiddleware, settings=settings)

broker = FactBroker()
engine = InferenceEngine(broker)


class InferRequest(BaseModel):
    text: str
    source_app: str = "voice"
    persist: bool = True
    agent_id: str = "mentor-user"
    use_llm: bool = True


class ClaudeLoginRequest(BaseModel):
    api_key: Optional[str] = None


class ClaudeChatRequest(BaseModel):
    message: str
    history: list[dict[str, str]] = Field(default_factory=list)


class ListenRequest(BaseModel):
    text: str
    source_app: str = "notes"


class DesktopCaptureRequest(BaseModel):
    text: str
    source: str = "claude-desktop"
    operation_id: Optional[str] = None
    capture_method: str = "explicit"
    consent_mode: str = "explicit"


class DesktopResolveRequest(BaseModel):
    id: str
    accept: bool = True
    # Mac choice sheet: calendar | notes | reminders | facts-only
    destination: Optional[str] = None


class DesktopRecallRequest(BaseModel):
    text: Optional[str] = None
    image_base64: Optional[str] = None
    media_type: str = "image/png"
    source: str = "macos"
    use_llm: bool = True


def _residence_listen(text: str, source_app: str) -> dict[str, Any]:
    inferred = engine.infer(
        text=text,
        source_app=source_app,
        persist=False,
        agent_id="mentor-user",
        use_llm=False,
    )
    notes = []
    for n in inferred.get("notifications") or []:
        if n.get("actionApp") == "calendar":
            n = {
                **n,
                "title": n.get("title") or "Convert this into a note?",
                "body": n.get("body") or text[:80],
            }
        notes.append(n)
    return {
        "notifications": notes,
        "intents": inferred.get("intents") or [],
        "ok": inferred.get("ok", True),
    }


@app.get("/alive")
def alive() -> dict[str, Any]:
    """Process liveness — Mac/desktop may poll this without requiring DataHub."""
    return {"ok": True, "core": True}


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        dh = bool(broker.client.health())
    except Exception:
        dh = False
    return {
        "ok": dh,
        "core": True,
        "datahubOk": dh,
        "datahub": settings.datahub_gms_url,
        "tier": os.getenv("DATAHUB_TIER", "oss"),
        "inference": "residence-nlu-v1",
        "version": "1.0.0",
        "env": settings.env,
        "authRequired": settings.require_auth,
        "message": "ready" if dh else "Core up · DataHub unreachable",
    }


@app.get("/ready")
def ready() -> dict[str, Any]:
    """Stage gate — Core + DataHub must both answer before the judge demo runs."""
    try:
        dh = bool(broker.client.health())
    except Exception:
        dh = False
    return {
        "ok": dh,
        "core": True,
        "datahub": dh,
        "message": "ready" if dh else "DataHub GMS unreachable — start quickstart",
    }


def _parse_asserted_day(raw: str) -> Optional[date]:
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).date()
    except Exception:
        return None


@app.get("/activity")
def activity(days: int = 28) -> dict[str, Any]:
    """Last N days of real Fact writes — powers the home heatmap."""
    window = max(7, min(days, 56))
    today = date.today()
    # Align to Sunday so columns match Sun…Sat chrome
    days_since_sun = (today.weekday() + 1) % 7
    weeks = max(1, (window + 6) // 7)
    start = today - timedelta(days=days_since_sun + 7 * (weeks - 1))
    end = start + timedelta(days=7 * weeks - 1)

    seen: dict[str, Any] = {}
    for query, term in (
        ("fact", None),
        ("Budget", "Budget"),
        ("Commitment", "Commitment"),
        ("Intent", "Intent"),
        ("Health", "Health Condition"),
    ):
        try:
            resp = broker.query_facts(query, "mentor-user", term)
        except Exception:
            continue
        for row in resp.results:
            fid = row.fact.factId
            if fid not in seen:
                seen[fid] = row.fact

    counts: dict[str, int] = {}
    for fact in seen.values():
        d = _parse_asserted_day(fact.assertedAt)
        if d is None or d < start or d > end:
            continue
        key = d.isoformat()
        counts[key] = counts.get(key, 0) + 1

    cells: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        c = counts.get(key, 0)
        cells.append(
            {
                "date": key,
                "count": c,
                "weekday": cursor.strftime("%a"),
            }
        )
        cursor += timedelta(days=1)

    peak = max((c["count"] for c in cells), default=0)
    for c in cells:
        c["intensity"] = 0.0 if peak == 0 else round(c["count"] / peak, 3)

    total = sum(c["count"] for c in cells)
    active_days = sum(1 for c in cells if c["count"] > 0)
    return {
        "ok": True,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": total,
        "activeDays": active_days,
        "peak": peak,
        "cells": cells,
    }


@app.post("/infer")
def infer(req: InferRequest) -> dict[str, Any]:
    try:
        return engine.infer(
            text=req.text,
            source_app=req.source_app,
            persist=req.persist,
            agent_id=req.agent_id,
            use_llm=req.use_llm,
        )
    except Exception as e:
        raise HTTPException(500, f"infer failed: {e}") from e


@app.get("/claude/status")
def claude_status() -> dict[str, Any]:
    return claude_bridge.status()


@app.post("/claude/login")
def claude_login(req: ClaudeLoginRequest) -> dict[str, Any]:
    out = claude_bridge.login(req.api_key)
    if not out.get("ok"):
        raise HTTPException(400, out.get("error") or "login failed")
    return out


@app.post("/claude/logout")
def claude_logout() -> dict[str, Any]:
    return claude_bridge.logout()


@app.post("/claude/chat")
def claude_chat(req: ClaudeChatRequest) -> dict[str, Any]:
    """Real Claude reply + Residence inference notifications (e.g. convert to note)."""
    msg = (req.message or "").strip()
    if not msg:
        raise HTTPException(400, "empty message")

    chat_out = claude_bridge.chat(msg, req.history)
    if not chat_out.get("ok"):
        err = chat_out.get("error") or "claude failed"
        code = 401 if err in ("not_logged_in", "invalid_api_key") else 502
        raise HTTPException(code, err)

    # Residence listens to what you told Claude — suggest Calendar / Wallet / etc.
    inferred = engine.infer(
        text=msg,
        source_app="claude",
        persist=False,
        agent_id="claude-wrapper",
        use_llm=False,
    )
    # Prefer suggestion-style titles for Claude → Residence handoff
    notes = []
    for n in inferred.get("notifications") or []:
        if n.get("actionApp") == "calendar":
            n = {
                **n,
                "title": "Convert this into a note?",
                "body": n.get("body") or msg[:80],
                "fromApp": "calendar",
                "fromLabel": "Calendar",
            }
        notes.append(n)

    return {
        "ok": True,
        "reply": chat_out["reply"],
        "model": chat_out.get("model"),
        "residenceConnected": True,
        "notifications": notes,
        "intents": inferred.get("intents") or [],
        "utterance": msg,
    }


@app.get("/maps/search")
def maps_search(q: str) -> dict[str, Any]:
    out = public_apps.search_places(q)
    if not out.get("ok"):
        raise HTTPException(502, out.get("error") or "maps search failed")
    return out


@app.get("/youtube/search")
def youtube_search(q: str, limit: int = 12) -> dict[str, Any]:
    """Real YouTube results via public mirrors — no Google API key."""
    out = media_apps.youtube_search(q, limit=limit)
    if not out.get("ok"):
        raise HTTPException(502, out.get("error") or "youtube search failed")
    for row in out.get("results") or []:
        row["lengthLabel"] = media_apps.fmt_duration(int(row.get("length") or 0))
    return out


@app.get("/weather")
def weather(q: Optional[str] = None, lat: Optional[float] = None, lon: Optional[float] = None) -> dict[str, Any]:
    if lat is not None and lon is not None:
        out = public_apps.weather_for(lat, lon, place=q)
    elif q:
        out = public_apps.weather_for_query(q)
    else:
        # Default: San Francisco — client should pass geolocation when available
        out = public_apps.weather_for(37.7749, -122.4194, place="San Francisco")
    if not out.get("ok"):
        raise HTTPException(502, out.get("error") or "weather failed")
    return out


@app.post("/apps/listen")
def apps_listen(req: ListenRequest) -> dict[str, Any]:
    """Any connected app can hand text to Residence for cross-app notifications."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    listened = _residence_listen(text, req.source_app)
    return {
        "ok": True,
        "residenceConnected": True,
        "source_app": req.source_app,
        "utterance": text,
        **listened,
    }


def _existing_note_strings() -> list[str]:
    notes: list[str] = []
    for query, term in (
        ("Health", "Health Condition"),
        ("Budget", "Budget"),
        ("Commitment", "Commitment"),
    ):
        try:
            resp = broker.query_facts(query, "mentor-user", term)
        except Exception:
            continue
        for row in resp.results:
            try:
                val = json.loads(row.fact.value)
                if isinstance(val, dict):
                    notes.append(
                        str(val.get("note") or val.get("title") or val.get("ceilingWeeklyUsd") or row.fact.value)
                    )
                else:
                    notes.append(str(row.fact.value))
            except Exception:
                notes.append(row.fact.value)
    return notes


@app.post("/desktop/capture")
def desktop_capture(req: DesktopCaptureRequest) -> dict[str, Any]:
    """Mac app / MCP: analyze text → queue Accept/Decline permissions (+ contradictions)."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > 32_000:
        raise HTTPException(413, "capture exceeds 32KB safety limit")

    operation_id = req.operation_id or hashlib.sha256(
        f"{req.source}\0{req.capture_method}\0{text}".encode()
    ).hexdigest()
    content_hash = hashlib.sha256(text.encode()).hexdigest()
    if not desktop_bridge.register_capture(
        operation_id, req.source, req.capture_method, text, content_hash
    ):
        return {
            "ok": True,
            "duplicate": True,
            "operationId": operation_id,
            "queued": [
                p
                for p in desktop_bridge.list_pending()
                if p.get("operationId") == operation_id
            ],
            "pendingCount": len(desktop_bridge.list_pending()),
        }

    listened = _residence_listen(text, "claude")
    existing = _existing_note_strings()
    contradictions = desktop_bridge.find_contradictions(text, existing)

    queued: list[dict[str, Any]] = []
    for c in contradictions:
        queued.append(
            desktop_bridge.push_permission(
                {
                    "kind": "contradiction",
                    "source": req.source,
                    "operationId": operation_id,
                    "captureMethod": req.capture_method,
                    "consentMode": req.consent_mode,
                    "contentHash": content_hash,
                    "title": "Your notes disagree — fix?",
                    "body": c["summary"],
                    "actionApp": "wellness" if "allergic" in c["existing"].lower() else "notes",
                    "payload": {
                        "note": text,
                        "existing": c["existing"],
                        "incoming": c["incoming"],
                        "kind": c["kind"],
                        "title": text[:80],
                        "text": text,
                    },
                    "utterance": text,
                }
            )
        )

    contradiction_kinds = {c.get("kind") for c in contradictions}
    for n in listened.get("notifications") or []:
        # Only suppress same-domain duplicates. Never hide a calendar event
        # because of an unrelated shop/budget/allergy conflict.
        app = n.get("actionApp")
        if app == "wellness" and "allergy_flip" in contradiction_kinds:
            continue
        if app == "wallet" and "budget_conflict" in contradiction_kinds:
            continue
        n_type = str(n.get("type") or "")
        kind = "related_chats" if n_type == "memory.related_chats" else "suggestion"
        payload = n.get("payload") or {"text": text, "title": text[:80]}
        if kind == "related_chats":
            payload = {
                **payload,
                "q": "related_chats",
                "summary": payload.get("summary") or n.get("body") or text,
                "note": payload.get("note") or payload.get("summary") or n.get("body"),
            }
        queued.append(
            desktop_bridge.push_permission(
                {
                    "kind": kind,
                    "source": req.source,
                    "operationId": operation_id,
                    "captureMethod": req.capture_method,
                    "consentMode": req.consent_mode,
                    "contentHash": content_hash,
                    "title": n.get("title") or "Add to Residence?",
                    "body": n.get("body") or text[:120],
                    "actionApp": n.get("actionApp") or "calendar",
                    "payload": payload,
                    "utterance": text if kind != "related_chats" else (payload.get("summary") or text),
                    "fromLabel": n.get("fromLabel"),
                }
            )
        )

    # If nothing inferred but user pasted something, still offer a note
    if not queued:
        queued.append(
            desktop_bridge.push_permission(
                {
                    "kind": "suggestion",
                    "source": req.source,
                    "title": "Save to Residence Notes?",
                    "body": text[:140],
                    "actionApp": "wellness",
                    "payload": {"note": text, "text": text, "title": text[:80]},
                    "utterance": text,
                }
            )
        )

    return {
        "ok": True,
        "operationId": operation_id,
        "utterance": text,
        "contradictions": contradictions,
        "queued": queued,
        "pendingCount": len(desktop_bridge.list_pending()),
    }


@app.get("/desktop/pending")
def desktop_pending(
    status: str = "pending", offset: int = 0, limit: int = 50
) -> dict[str, Any]:
    return {
        "ok": True,
        "pending": desktop_bridge.list_pending(status=status, offset=offset, limit=limit),
        "status": status,
        "offset": offset,
        "limit": limit,
    }


@app.post("/desktop/recall")
def desktop_recall(req: DesktopRecallRequest) -> dict[str, Any]:
    """Image/text → search indexed Claude/GPT chats → queue summarized related_chats permission."""
    import chat_recall

    text = (req.text or "").strip()
    caption = ""
    keywords: list[str] = []
    vision_error = None

    if req.image_base64:
        vis = claude_bridge.caption_image(
            req.image_base64,
            req.media_type or "image/png",
            hint=text,
        )
        if vis.get("ok"):
            caption = str(vis.get("caption") or "").strip()
            keywords = list(vis.get("keywords") or [])
        else:
            vision_error = vis.get("error")

    query_parts = [p for p in (caption, " ".join(keywords), text) if p]
    query = " ".join(query_parts).strip()
    if not query:
        raise HTTPException(
            400,
            "recall needs text and/or a captionable image (set ANTHROPIC_API_KEY for vision)",
        )

    hits = chat_recall.search_conversations(broker, query, limit=6)
    summary = chat_recall.summarize_related(
        query,
        hits,
        caption=caption or None,
        use_llm=bool(req.use_llm and hits),
    )

    op_id = hashlib.sha256(
        f"recall\0{req.source}\0{query[:400]}".encode()
    ).hexdigest()[:32]
    title = (
        "Related Claude/GPT chats"
        if hits
        else "No related chats yet"
    )
    body = summary[:900]
    queued = desktop_bridge.push_permission(
        {
            "kind": "related_chats",
            "source": req.source or "macos",
            "operationId": op_id,
            "captureMethod": "image-recall" if req.image_base64 else "text-recall",
            "consentMode": "explicit",
            "title": title,
            "body": body,
            "actionApp": "notes",
            "payload": {
                "q": "related_chats",
                "summary": summary,
                "note": summary,
                "text": summary,
                "title": title,
                "caption": caption,
                "keywords": keywords,
                "hits": hits,
                "query": query,
                "visionError": vision_error,
            },
            "utterance": summary,
            "fromLabel": "Recall",
        }
    )
    return {
        "ok": True,
        "operationId": op_id,
        "caption": caption,
        "keywords": keywords,
        "query": query,
        "hits": hits,
        "summary": summary,
        "visionError": vision_error,
        "queued": [queued],
        "pendingCount": len(desktop_bridge.list_pending()),
    }


@app.post("/desktop/recall/seed")
def desktop_recall_seed() -> dict[str, Any]:
    """Demo seed: wardrobe/backstage Claude chat for drink-image recall."""
    import chat_recall

    fact = chat_recall.seed_demo_conversation(broker)
    return {
        "ok": True,
        "seeded": bool(fact),
        "factId": getattr(fact, "factId", None),
    }


@app.get("/desktop/briefing")
def desktop_briefing() -> dict[str, Any]:
    """Morning / Today digest — Facts + optional clash hints (daily OS loop)."""
    from briefing import build_briefing

    return build_briefing(
        broker,
        pending_count=len(desktop_bridge.list_pending()),
    )


class CalendarEventIn(BaseModel):
    title: str
    dateISO: str
    startHhmm: Optional[str] = None
    endHhmm: Optional[str] = None
    uid: Optional[str] = None


class CalendarSyncRequest(BaseModel):
    events: list[CalendarEventIn] = Field(default_factory=list)
    propose_imports: bool = True
    source: str = "apple-calendar-sync"


@app.post("/desktop/calendar-sync")
def desktop_calendar_sync(req: CalendarSyncRequest) -> dict[str, Any]:
    """Import Apple Calendar rows → Accept proposals + briefing with clashes."""
    from briefing import build_briefing, propose_calendar_imports

    events = [e.model_dump() for e in req.events]
    proposed: dict[str, Any] = {
        "ok": True,
        "proposed": 0,
        "skipped": 0,
        "queued": [],
        "clashes": [],
        "eventsSeen": len(events),
    }
    if req.propose_imports and events:
        proposed = propose_calendar_imports(
            broker,
            events,
            push_permission=desktop_bridge.push_permission,
            source=req.source,
        )
    briefing = build_briefing(
        broker,
        calendar_events=events,
        pending_count=len(desktop_bridge.list_pending()),
    )
    # Prefer sync-detected clashes when present
    if proposed.get("clashes"):
        briefing["clashes"] = proposed["clashes"][:8]
        briefing["headline"] = (
            f"Today · {proposed.get('proposed', 0)} Calendar import(s) · "
            f"{len(briefing['clashes'])} clash"
            if briefing["clashes"]
            else briefing["headline"]
        )
    return {
        "ok": True,
        "sync": {
            "proposed": proposed.get("proposed", 0),
            "skipped": proposed.get("skipped", 0),
            "eventsSeen": proposed.get("eventsSeen", 0),
            "clashes": proposed.get("clashes") or [],
        },
        "queued": proposed.get("queued") or [],
        "briefing": briefing,
    }


@app.get("/desktop/activity")
def desktop_activity(offset: int = 0, limit: int = 100) -> dict[str, Any]:
    """Auditable desktop lifecycle: capture → decision → Fact → native write-back."""
    return {
        "ok": True,
        "activity": desktop_bridge.list_activity(offset=offset, limit=limit),
        "offset": offset,
        "limit": limit,
    }


class DesktopWritebackResult(BaseModel):
    operation_id: str
    permission_id: str
    ok: bool
    writes: list[dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None


@app.post("/desktop/writeback-result")
def desktop_writeback_result(req: DesktopWritebackResult) -> dict[str, Any]:
    """Record native write-back independently of the accepted Fact outcome."""
    desktop_bridge.record_writeback(
        req.operation_id,
        req.permission_id,
        {"ok": req.ok, "writes": req.writes, "error": req.error},
    )
    return {"ok": True}


class DesktopUndoRequest(BaseModel):
    fact_id: str
    permission_id: Optional[str] = None
    operation_id: Optional[str] = None


@app.post("/desktop/undo")
def desktop_undo(req: DesktopUndoRequest) -> dict[str, Any]:
    """Undo the last Accept by soft-deleting the Fact it wrote."""
    ok = broker.client.soft_delete_fact(req.fact_id)
    if not ok:
        raise HTTPException(404, "fact not found or delete failed")
    desktop_bridge.record_undo(req.fact_id, req.permission_id, req.operation_id)
    return {"ok": True, "factId": req.fact_id, "status": "undone"}


@app.post("/desktop/resolve")
def desktop_resolve(req: DesktopResolveRequest) -> dict[str, Any]:
    """Accept/Decline a desktop permission — Accept writes Facts."""
    item = desktop_bridge.resolve(req.id, req.accept)
    if not item:
        raise HTTPException(404, "permission not found")
    if not req.accept:
        desktop_bridge.redact_resolved(req.id)
        return {"ok": True, "status": "declined", "id": req.id}
    if item.get("factId"):
        # Network/UI retry after an accepted resolution: no duplicate Fact.
        return {
            "ok": True,
            "status": "accepted",
            "id": req.id,
            "actionApp": item.get("actionApp"),
            "factId": item["factId"],
            "idempotent": True,
        }

    p = dict(item.get("payload") or {})
    dest = (req.destination or "").strip().lower()
    if item.get("kind") == "related_chats":
        # Recall digest → Notes by default
        action = "notes" if dest != "calendar" else "calendar"
        p.setdefault(
            "note",
            p.get("summary") or item.get("body") or item.get("utterance"),
        )
    elif dest in ("notes", "reminders", "facts-only"):
        action = "notes"
    elif dest == "calendar":
        action = "calendar"
    else:
        action = item.get("actionApp") or "calendar"
    # Persist the user's chosen destination for audit / Mac write-back.
    if dest:
        item["destination"] = dest
        item["actionApp"] = action
    written = None
    desktop_provenance = {
        "source": item.get("source"),
        "captureMethod": item.get("captureMethod", "unknown"),
        "consentMode": item.get("consentMode", "explicit"),
        "operationId": item.get("operationId"),
        "contentHash": item.get("contentHash"),
        "capturedAt": item.get("createdAt"),
    }

    try:
        if action in ("wellness", "notes") or item.get("kind") in (
            "contradiction",
            "related_chats",
        ):
            note = p.get("note") or p.get("incoming") or p.get("text") or item.get("utterance")
            written = broker.assert_fact(
                {
                    "value": json.dumps({"note": note, "source": item.get("source")}),
                    "glossary_term": "Health Condition",
                    "certificationStatus": "user_confirmed",
                    "confidence": 1.0,
                    "provenance": desktop_provenance,
                },
                agent_id="mentor-user",
                confidence=1.0,
                sensitivity_tag=SensitivityTag.health,
                decision_label="desktop-accept-note",
            )
        elif action == "wallet" and p.get("ceilingWeeklyUsd") not in (None, ""):
            written = broker.assert_fact(
                {
                    "value": json.dumps(
                        {
                            "ceilingWeeklyUsd": float(p["ceilingWeeklyUsd"]),
                            "currency": "USD",
                        }
                    ),
                    "glossary_term": "Budget",
                    "certificationStatus": "user_confirmed",
                    "confidence": 1.0,
                    "ttlSeconds": 7 * 24 * 3600,
                    "provenance": desktop_provenance,
                },
                agent_id="mentor-user",
                confidence=1.0,
                sensitivity_tag=SensitivityTag.financial,
                decision_label="desktop-accept-budget",
            )
        elif action == "shop":
            written = broker.assert_fact(
                {
                    "value": json.dumps(
                        {
                            "intent": "gift_search",
                            "who": p.get("who"),
                            "q": p.get("q") or "gift",
                            "title": p.get("title") or item.get("utterance"),
                        }
                    ),
                    "glossary_term": "Intent",
                    "certificationStatus": "user_confirmed",
                    "confidence": 1.0,
                    "provenance": desktop_provenance,
                },
                agent_id="shopping-agent",
                confidence=1.0,
                decision_label="desktop-accept-shop",
            )
        else:
            from datetime import date as _date, timedelta as _td

            day = p.get("dayOfMonth")
            date_iso = p.get("dateISO") or None
            if date_iso:
                try:
                    day = _date.fromisoformat(str(date_iso)[:10]).day
                except Exception:
                    date_iso = None
            if day in (None, ""):
                day = (_date.today() + _td(days=1)).day
            title = p.get("title") or p.get("text") or item.get("utterance") or "Note"
            value: dict[str, Any] = {
                "title": str(title)[:80],
                "dayOfMonth": int(day),
                "person": p.get("person") or None,
                "sourceText": item.get("utterance"),
            }
            if date_iso:
                value["dateISO"] = str(date_iso)[:10]
            if p.get("startHhmm"):
                value["startHhmm"] = str(p["startHhmm"])[:5]
            written = broker.assert_fact(
                {
                    "value": json.dumps(value),
                    "glossary_term": "Commitment",
                    "certificationStatus": "user_confirmed",
                    "confidence": 1.0,
                    "provenance": desktop_provenance,
                },
                agent_id="calendar-health-agent",
                confidence=1.0,
                decision_label="desktop-accept-calendar",
            )
    except Exception as e:
        raise HTTPException(500, f"accept failed: {e}") from e

    # Index Claude/GPT captures so image/text recall can find them later.
    try:
        import chat_recall

        utter = (item.get("utterance") or p.get("text") or p.get("note") or "").strip()
        if (
            item.get("kind") != "related_chats"
            and utter
            and chat_recall.is_chat_source(str(item.get("source") or ""))
        ):
            chat_recall.index_conversation(
                broker,
                utterance=utter,
                source=str(item.get("source") or "claude-desktop"),
                operation_id=item.get("operationId"),
                provenance=desktop_provenance,
            )
    except Exception:
        logging.getLogger("residence.core").debug("conversation index skipped", exc_info=True)

    item["factId"] = written.factId if written else None
    item["factWrittenAt"] = time.time()
    # Persist the completed state without changing the public status.
    desktop_bridge._save()
    desktop_bridge.redact_resolved(req.id)
    return {
        "ok": True,
        "status": "accepted",
        "id": req.id,
        "actionApp": action,
        "factId": written.factId if written else None,
    }


@app.get("/explain/latest-block")
def explain_block() -> dict[str, Any]:
    return explain_latest_block(broker)


class AnalyticsAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    use_llm: bool = False


@app.get("/ack/status")
def ack_status() -> dict[str, Any]:
    """Agent Context Kit availability against this GMS."""
    return ack_bridge.status()


@app.get("/ack/search")
def ack_search(q: str = "Budget", limit: int = 8) -> dict[str, Any]:
    """Official ACK search tool proxy (datahub-agent-context)."""
    return ack_bridge.ack_search(q, num_results=max(1, min(limit, 25)))


@app.get("/ack/lineage")
def ack_lineage(urn: str, upstream: bool = True, hops: int = 2) -> dict[str, Any]:
    return ack_bridge.ack_get_lineage(urn, upstream=upstream, max_hops=max(1, min(hops, 5)))


@app.get("/skills")
def list_skills() -> dict[str, Any]:
    skills = ack_bridge.load_skills()
    official = [s for s in skills if str(s.get("source", "")).startswith("datahub-project")]
    return {
        "ok": True,
        "count": len(skills),
        "officialCount": len(official),
        "officialSource": "datahub-project/datahub-skills",
        "skillsLock": "skills-lock.json",
        "skills": skills,
        "runtimePatterns": [
            "datahub-search",
            "datahub-lineage",
            "datahub-enrich",
            "datahub-quality",
            "datahub-setup",
            "datahub-personal-context",
        ],
    }


@app.post("/analytics/ask")
def analytics_ask(req: AnalyticsAskRequest) -> dict[str, Any]:
    """Analytics Agent — ACK discover warehouse table → Text-to-SQL → answer."""
    return analytics_agent.ask(req.question, broker=broker, use_llm=req.use_llm)


@app.post("/warehouse/sync")
def warehouse_sync() -> dict[str, Any]:
    """Sync Facts → SQLite warehouse and register tables in DataHub for ACK discovery."""
    import fact_warehouse

    counts = fact_warehouse.sync_from_broker(broker)
    urns = fact_warehouse.register_datasets(broker.client)
    return {
        "ok": True,
        "counts": counts,
        "registered": urns,
        "db": str(fact_warehouse.db_path()),
    }


@app.get("/graph")
def full_graph() -> dict[str, Any]:
    """The whole personal context graph as DataHub sees it — nodes + edges."""
    try:
        return graph_api.build_graph(broker)
    except Exception as e:
        raise HTTPException(500, f"graph build failed: {e}") from e


@app.get("/glossary")
def glossary() -> dict[str, Any]:
    """Business Glossary terms with live fact counts."""
    try:
        return graph_api.glossary_summary(broker)
    except Exception as e:
        raise HTTPException(500, f"glossary failed: {e}") from e


@app.get("/facts/{fact_id}/history")
def fact_history(fact_id: str) -> dict[str, Any]:
    """Supersede chain — how this fact evolved over time."""
    out = graph_api.fact_history(broker, fact_id)
    if not out.get("ok"):
        raise HTTPException(404, out.get("error") or "not found")
    return out


@app.post("/demo/smart-memory")
def smart_memory_demo() -> dict[str, Any]:
    """Seed shared Facts, then show many cross-app prompts that reuse that memory."""
    scenarios_in = [
        {"id": "same_day", "label": "Same-day clash", "text": "Book lunch with Alex on the 15th", "expect": ["cross.same_day_conflict"]},
        {"id": "ask_times", "label": "Two bookings → ask times", "text": "Book dentist and lunch with Sam both on the 15th", "expect": ["cross.ask_times"]},
        {"id": "trip_clash", "label": "Trip day clash", "text": "Schedule a dentist appointment on the 22nd", "expect": ["cross.trip_clash"]},
        {"id": "priority", "label": "Exam + social", "text": "Birthday dinner party on exam day", "expect": ["cross.priority_clash"]},
        {"id": "youtube", "label": "YouTube → watch later", "text": "Watch this youtube video https://youtube.com/watch?v=dQw4w9WgXcQ later today", "expect": ["cross.watch_later", "cross.watch_calendar"]},
        {"id": "gmail", "label": "Gmail invite clash", "text": "You're invited to a Zoom meeting on the 15th — RSVP via Gmail", "expect": ["cross.email_invite_clash"]},
        {"id": "contradiction", "label": "Contradiction", "text": "I'm not allergic to nickel anymore", "expect": ["memory.contradiction"]},
        {"id": "budget_guard", "label": "Budget → Shop", "text": "I want to buy Everyday Runners for $95", "expect": ["memory.budget_guard"]},
        {"id": "allergy_shop", "label": "Allergy → Shop", "text": "thinking of buying a nickel watch chain", "expect": ["memory.allergy_guard"]},
        {"id": "gift_memory", "label": "Calendar → Gift", "text": "I should get Sam a present", "expect": ["memory.gift_from_calendar"]},
        {"id": "meal_allergy", "label": "Meal vs allergy", "text": "Book sushi dinner with peanuts sauce tonight", "expect": ["cross.meal_allergy"]},
        {"id": "shopping_list", "label": "Amazon shopping", "text": "Shopping: Noise headphones\nhttps://amazon.com/dp/abc\nCheck budget before buying?", "expect": ["cross.shopping_list", "cross.shopping_budget"]},
        {"id": "maps_place", "label": "Maps place", "text": "Place: Blue Bottle Coffee\nhttps://maps.google.com/?q=blue\nSave this place for later?", "expect": ["cross.maps_place"]},
        {"id": "linkedin", "label": "LinkedIn follow-up", "text": "LinkedIn: Message from Jordan\nhttps://linkedin.com/in/jordan\nSchedule a follow-up?", "expect": ["cross.linkedin_followup"]},
        {"id": "github", "label": "GitHub review", "text": "Code thread: Fix auth #42\nhttps://github.com/org/repo/pull/42\nRemind me to review this later?", "expect": ["cross.github_review"]},
        {"id": "ride", "label": "Uber vs Calendar", "text": "Ride: Uber to downtown on the 15th\nDoes this ride conflict?", "expect": ["cross.ride_clash", "cross.ride_eta"]},
        {"id": "read_later", "label": "Read later", "text": "Read later: Why context graphs win\nhttps://news.ycombinator.com/item?id=1", "expect": ["cross.read_later"]},
        {"id": "work_focus", "label": "Linear focus", "text": "Task: RES-12 ship HUD\nhttps://linear.app/team/issue/RES-12\nBlock focus time?", "expect": ["cross.work_focus"]},
        {"id": "trip_prep", "label": "Tokyo trip prep", "text": "Tokyo packing list before the trip", "expect": ["memory.trip_prep"]},
        {"id": "exam_focus", "label": "Exam focus", "text": "I'm nervous about Exam prep", "expect": ["memory.exam_focus", "memory.stress_checkin"]},
        {"id": "open_commitment", "label": "Open commitment", "text": "Remind me about Sam", "expect": ["memory.open_commitment"]},
        {"id": "music", "label": "Music focus", "text": "Music: Deep Focus by Lo-Fi\nSave for focus later or add a listen reminder?", "expect": ["cross.music_save"]},
    ]

    # Seed memory the apps will reuse
    seeds: list[dict[str, Any]] = []
    budget = broker.assert_fact(
        {
            "value": json.dumps({"ceilingWeeklyUsd": 40, "currency": "USD", "demo": "smart"}),
            "glossary_term": "Budget",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
            "ttlSeconds": 7 * 24 * 3600,
        },
        agent_id="finance-agent",
        confidence=1.0,
        sensitivity_tag=SensitivityTag.financial,
        decision_label="smart-seed-budget",
    )
    seeds.append({"kind": "Budget", "factId": budget.factId, "value": "$40/week"})

    allergy = broker.assert_fact(
        {
            "value": json.dumps({"note": "allergic to nickel — avoid jewelry with nickel"}),
            "glossary_term": "Health Condition",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="mentor-user",
        confidence=1.0,
        sensitivity_tag=SensitivityTag.health,
        decision_label="smart-seed-allergy",
    )
    seeds.append({"kind": "Health", "factId": allergy.factId, "value": "allergic to nickel"})

    food = broker.assert_fact(
        {
            "value": json.dumps({"note": "allergic to peanuts — check restaurant menus"}),
            "glossary_term": "Health Condition",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="mentor-user",
        confidence=1.0,
        sensitivity_tag=SensitivityTag.health,
        decision_label="smart-seed-food-allergy",
    )
    seeds.append({"kind": "Health", "factId": food.factId, "value": "allergic to peanuts"})

    bday = broker.assert_fact(
        {
            "value": json.dumps(
                {
                    "title": "Sam birthday",
                    "dayOfMonth": 15,
                    "person": "Sam",
                    "occasion": "birthday",
                }
            ),
            "glossary_term": "Commitment",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="calendar-health-agent",
        confidence=1.0,
        decision_label="smart-seed-birthday",
    )
    seeds.append({"kind": "Commitment", "factId": bday.factId, "value": "Sam birthday · 15"})

    exam = broker.assert_fact(
        {
            "value": json.dumps(
                {"title": "Exam", "dayOfMonth": date.today().day, "person": None}
            ),
            "glossary_term": "Commitment",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="calendar-health-agent",
        confidence=1.0,
        decision_label="smart-seed-exam",
    )
    seeds.append({"kind": "Commitment", "factId": exam.factId, "value": "Exam"})

    trip = broker.assert_fact(
        {
            "value": json.dumps(
                {"title": "Tokyo trip", "dayOfMonth": 22, "city": "Tokyo", "person": None}
            ),
            "glossary_term": "Commitment",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="calendar-health-agent",
        confidence=1.0,
        decision_label="smart-seed-trip",
    )
    seeds.append({"kind": "Commitment", "factId": trip.factId, "value": "Tokyo trip"})

    scenarios: list[dict[str, Any]] = []
    all_notes: list[dict[str, Any]] = []
    expected_hits: list[str] = []
    missing: list[str] = []
    for sc in scenarios_in:
        inferred = engine.infer(
            sc["text"],
            source_app="voice",
            persist=False,
            agent_id="mentor-user",
            use_llm=False,
        )
        notes = inferred.get("notifications") or []
        intent_types = [
            i.get("type")
            for i in (inferred.get("intents") or [])
            if str(i.get("type", "")).startswith(("memory.", "cross."))
        ]
        memory_types = intent_types or [
            n.get("type")
            for n in notes
            if n.get("fromMemory")
            or str(n.get("type", "")).startswith(("memory.", "cross."))
        ]
        expect = sc.get("expect") or []
        hit = any(e in memory_types for e in expect) if expect else bool(memory_types)
        if expect:
            expected_hits.extend(expect)
            if not hit:
                missing.append(sc["id"])
        scenarios.append(
            {
                "id": sc["id"],
                "label": sc["label"],
                "text": sc["text"],
                "notifications": notes,
                "memoryTypes": memory_types,
                "expect": expect,
                "hit": hit,
                "apps": [n.get("actionApp") for n in notes],
            }
        )
        all_notes.extend(notes)

    # Showcase distinct memory use-cases (one banner per family)
    prefer = [
        "cross.same_day_conflict",
        "cross.ask_times",
        "cross.trip_clash",
        "cross.priority_clash",
        "cross.watch_later",
        "cross.email_invite_clash",
        "cross.meal_allergy",
        "cross.shopping_list",
        "cross.maps_place",
        "cross.linkedin_followup",
        "cross.github_review",
        "cross.ride_clash",
        "cross.read_later",
        "cross.work_focus",
        "cross.music_save",
        "memory.contradiction",
        "memory.budget_guard",
        "memory.gift_from_calendar",
        "memory.allergy_guard",
        "memory.trip_prep",
        "memory.exam_focus",
        "memory.stress_checkin",
        "memory.open_commitment",
        "shop.gift",
        "calendar.commitment",
    ]
    banners: list[dict[str, Any]] = []
    seen_types: set[str] = set()
    by_type: dict[str, dict[str, Any]] = {}
    for n in all_notes:
        t = n.get("type")
        if t and t not in by_type:
            by_type[t] = n
    for t in prefer:
        n = by_type.get(t)
        if not n or t in seen_types:
            continue
        seen_types.add(t)
        banners.append(n)
        if len(banners) >= 10:
            break
    if len(banners) < 8:
        for n in all_notes:
            t = n.get("type") or ""
            if t in seen_types:
                continue
            seen_types.add(t)
            banners.append(n)
            if len(banners) >= 10:
                break

    coverage = {
        "scenarios": len(scenarios_in),
        "hit": sum(1 for s in scenarios if s.get("hit")),
        "missing": missing,
        "bannerTypes": [b.get("type") for b in banners],
    }

    return {
        "ok": True,
        "strictOk": len(missing) == 0,
        "coverage": coverage,
        "seeds": seeds,
        "scenarios": scenarios,
        "notifications": banners,
        "steps": [
            {
                "id": "seed",
                "title": "Shared memory seeded",
                "detail": (
                    f"Budget $40 · nickel · peanuts · Sam(15) · Exam · Tokyo(22) · "
                    f"{coverage['hit']}/{coverage['scenarios']} scenarios hit"
                ),
            },
            *[
                {
                    "id": s["id"],
                    "title": s["label"],
                    "detail": f"“{s['text'][:70]}” → {', '.join((s.get('memoryTypes') or s['apps'])[:3]) or '—'}",
                }
                for s in scenarios
            ],
        ],
    }


@app.post("/demo/judge")
def judge_demo() -> dict[str, Any]:
    """Deterministic end-to-end story for judging — all real broker/infer writes."""
    steps: list[dict[str, Any]] = []

    # Guarantee Shop cannot read health for the sensitivity beat
    try:
        broker.client.update_agent_scopes(
            "shopping-agent",
            read_scopes=["none", "financial"],
            write_scopes=["Intent", "Commitment"],
        )
    except Exception as e:
        return {
            "ok": False,
            "blocked": False,
            "leaked": True,
            "error": f"shopping-agent scope update failed: {e}",
            "steps": [],
            "notifications": [],
            "utterance": "",
        }

    # 1) Tight certified budget
    budget = broker.assert_fact(
        {
            "value": json.dumps({"ceilingWeeklyUsd": 40, "currency": "USD", "demo": "judge"}),
            "glossary_term": "Budget",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
            "ttlSeconds": 7 * 24 * 3600,
        },
        agent_id="mentor-user",
        confidence=1.0,
        sensitivity_tag=SensitivityTag.financial,
        decision_label="judge-budget",
    )
    steps.append(
        {
            "id": "wallet",
            "title": "Wallet locked $40 / week",
            "detail": "Certified Budget fact written to DataHub.",
            "factId": budget.factId,
        }
    )

    # 2) Voice-like utterance → multi-app inference
    uttered = "Sam birthday on the 15th, I want shoes, balance isn't much only $40"
    inferred = engine.infer(
        uttered, source_app="voice", persist=True, agent_id="mentor-user", use_llm=False
    )
    steps.append(
        {
            "id": "voice",
            "title": "Voice understood the moment",
            "detail": uttered,
            "apps": [n["actionApp"] for n in inferred.get("notifications", [])],
            "notifications": inferred.get("notifications", []),
        }
    )

    # 3) Shopping evaluation against live budget
    budgets = broker.query_facts("ceilingWeeklyUsd", "shopping-agent", "Budget")
    live = next((r for r in budgets.results if not r.stale), None)
    ceiling = None
    if live:
        ceiling = float(json.loads(live.fact.value).get("ceilingWeeklyUsd"))
    product = {"id": "sh-1", "title": "Everyday Runners", "price": 95}
    blocked = ceiling is not None and product["price"] > ceiling
    decision = broker.assert_fact(
        {
            "value": json.dumps(
                {
                    "productId": product["id"],
                    "title": product["title"],
                    "price": product["price"],
                    "blocked": blocked,
                    "ceiling": ceiling,
                }
            ),
            "glossary_term": "Intent",
            "confidence": 0.9,
        },
        agent_id="shopping-agent",
        confidence=0.9,
        decision_label=f"{'blocked' if blocked else 'approved'}-purchase:{product['id']}",
    )
    if live:
        broker.client.add_lineage_edge(live.fact.factId, decision.factId)
    steps.append(
        {
            "id": "shop",
            "title": (
                f"Shop paused {product['title']}"
                if blocked
                else f"Shop approved {product['title']}"
            ),
            "detail": (
                f"${product['price']} vs weekly ${ceiling}"
                if ceiling is not None
                else "No budget in scope"
            ),
            "factId": decision.factId,
            "blocked": blocked,
        }
    )

    # 4) Health sensitivity proof
    health = broker.assert_fact(
        {
            "value": json.dumps({"note": "allergic to nickel", "demo": "judge"}),
            "glossary_term": "Health Condition",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="calendar-health-agent",
        confidence=1.0,
        sensitivity_tag=SensitivityTag.health,
        decision_label="judge-health",
    )
    shop_health = broker.query_facts("nickel", "shopping-agent", "Health Condition")
    mentor_health = broker.query_facts("nickel", "mentor-user", "Health Condition")
    steps.append(
        {
            "id": "wellness",
            "title": "Wellness kept private from Shop",
            "detail": (
                f"Mentor sees {len(mentor_health.results)} · Shop sees {len(shop_health.results)}"
            ),
            "factId": health.factId,
            "leaked": len(shop_health.results) > 0,
        }
    )

    why = explain_latest_block(broker)

    # Analytics Agent (ACK) — prove Agent Context Kit search + lineage on the same Facts
    analytics = analytics_agent.ask(
        "Why was Everyday Runners blocked?", broker=broker, use_llm=False
    )
    steps.append(
        {
            "id": "analytics",
            "title": "Analytics Agent (ACK) answered Why",
            "detail": (analytics.get("answer") or "")[:160],
            "skills": analytics.get("skills") or [],
            "via": analytics.get("via"),
        }
    )

    return {
        "ok": True,
        "blocked": blocked,
        "leaked": len(shop_health.results) > 0,
        "steps": steps,
        "notifications": inferred.get("notifications", []),
        "why": why,
        "analytics": analytics,
        "utterance": uttered,
        "closing": {
            "headline": "DataHub won — not five private silos",
            "bullets": [
                "Budget Fact certified in DataHub Glossary + Personal Context domain",
                "Shop Intent linked by native lineage to that Budget",
                "CorpUser scopes hid Health from shopping-agent",
                "Conflict resolution wrote a real DataHub Assertion + run event",
                "Analytics Agent: ACK discover warehouse.* → Text-to-SQL → lineage Why",
                "Official datahub-skills pack (.agents/skills) + DataHub MCP + Residence MCP",
            ],
            "say": (
                "Apps stopped lying because Facts live in DataHub — "
                "glossary, ownership, lineage, domains, assertions, sensitivity, "
                "Agent Context Kit, Skills, and a Text-to-SQL Analytics Agent."
            ),
            "openGraph": True,
        },
    }


@app.post("/facts/assert")
def assert_fact(req: AssertFactRequest) -> dict[str, Any]:
    try:
        fact = broker.assert_fact(
            fact_payload=req.fact,
            agent_id=req.agent_id,
            confidence=req.confidence,
            sensitivity_tag=req.sensitivity_tag,
            glossary_term=req.glossary_term,
            decision_label=req.decision_label,
        )
        return {"fact": fact.model_dump()}
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"assert_fact failed: {e}") from e


@app.post("/facts/query")
def query_facts(req: QueryFactsRequest) -> dict[str, Any]:
    try:
        resp = broker.query_facts(
            query=req.query,
            requesting_agent_id=req.requesting_agent_id,
            glossary_term=req.glossary_term,
        )
        return resp.model_dump()
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e


@app.post("/facts/{fact_id}/certify")
def certify(fact_id: str) -> dict[str, Any]:
    try:
        fact = broker.certify(fact_id)
        return {"fact": fact.model_dump()}
    except KeyError as e:
        raise HTTPException(404, str(e)) from e


@app.get("/facts/{fact_id}/lineage")
def lineage(fact_id: str) -> dict[str, Any]:
    return broker.lineage(fact_id)


@app.get("/facts/{fact_id}/impact")
def impact(fact_id: str) -> dict[str, Any]:
    return broker.impact_analysis(fact_id)


@app.post("/facts/{downstream_id}/link/{upstream_id}")
def link_facts(downstream_id: str, upstream_id: str) -> dict[str, Any]:
    broker.client.add_lineage_edge(upstream_id, downstream_id)
    broker._skill("datahub-lineage")
    return {"ok": True, "upstream": upstream_id, "downstream": downstream_id}


class TrustUpdate(BaseModel):
    readScopes: list[str] = Field(default_factory=list)
    writeScopes: list[str] = Field(default_factory=list)


@app.get("/agents")
def list_agents() -> dict[str, Any]:
    ids = [
        "shopping-agent",
        "finance-agent",
        "calendar-health-agent",
        "claude-wrapper",
        "chatgpt-wrapper",
        "mentor-user",
    ]
    agents = []
    for i in ids:
        a = broker.client.get_agent(i)
        if a:
            agents.append(a.model_dump())
    return {"agents": agents}


@app.get("/agents/{agent_id}")
def get_agent(agent_id: str) -> dict[str, Any]:
    a = broker.client.get_agent(agent_id)
    if not a:
        raise HTTPException(404, "agent not found")
    return a.model_dump()


@app.put("/agents/{agent_id}/trust")
def update_trust(agent_id: str, body: TrustUpdate) -> dict[str, Any]:
    try:
        a = broker.client.update_agent_scopes(agent_id, body.readScopes, body.writeScopes)
        return a.model_dump()
    except KeyError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/demo/clear")
def clear_demo() -> dict[str, Any]:
    """Wipe Facts so the phone starts with empty history (no reseed)."""
    if not settings.allow_reset:
        raise HTTPException(403, "reset disabled in this environment")
    n = broker.client.soft_delete_all_facts()
    return {"ok": True, "deleted": n, "reseeding": False}


@app.post("/demo/reset")
def reset_demo() -> dict[str, Any]:
    if not settings.allow_reset:
        raise HTTPException(403, "reset disabled in this environment")
    import subprocess

    seed = Path(__file__).resolve().parent.parent / "datahub-setup" / "seed.py"
    n = broker.client.soft_delete_all_facts()
    subprocess.check_call(
        [sys.executable, str(seed)],
        env={**os.environ},
    )
    return {"deleted": n, "reseeding": True}


@app.get("/backup/facts")
def backup_facts() -> dict[str, Any]:
    """Export live Facts for disaster recovery / migration."""
    try:
        resp = broker.query_facts("", "mentor-user", None)
    except Exception as e:
        raise HTTPException(500, f"backup failed: {e}") from e
    rows = []
    for r in resp.results:
        if r.stale:
            continue
        rows.append(r.fact.model_dump())
    return {
        "ok": True,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(rows),
        "facts": rows,
        "env": settings.env,
        "version": "1.0.0",
    }


@app.get("/config")
def config() -> dict[str, Any]:
    ack = ack_bridge.status()
    return {
        "tier": os.getenv("DATAHUB_TIER", "oss"),
        "anthropicConfigured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "openaiConfigured": bool(os.getenv("OPENAI_API_KEY")),
        "corePublicUrl": os.getenv("CORE_PUBLIC_URL", "http://localhost:8700"),
        "datahubUiUrl": settings.datahub_ui_url,
        "datahubGmsUrl": settings.datahub_gms_url,
        "env": settings.env,
        "authRequired": settings.require_auth,
        "allowReset": settings.allow_reset,
        "rateLimitPerMinute": settings.rate_limit_per_minute,
        "agentContextKit": ack,
        "skillsCount": len(ack_bridge.load_skills()),
        "datahubMcp": {
            "package": "mcp-server-datahub",
            "launch": "./scripts/datahub-mcp.sh",
            "claudeConfig": "desktop/mcp/claude_desktop_config.example.json",
        },
        "analyticsAgent": {
            "endpoint": "POST /analytics/ask",
            "via": "agent-context-kit+text-to-sql",
            "warehouse": "POST /warehouse/sync",
        },
        "skillsOfficial": "datahub-project/datahub-skills → .agents/skills (skills-lock.json)",
        "version": "1.2.0",
    }


def run() -> None:
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
