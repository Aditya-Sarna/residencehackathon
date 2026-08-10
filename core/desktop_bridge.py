"""Desktop inbox — pending Accept/Decline permissions for the Mac app + MCP.

Persists to disk so a Core restart does not drop the permission queue.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("residence.desktop")

_lock = threading.Lock()
_pending: list[dict[str, Any]] = []
_captures: dict[str, str] = {}
_activity: list[dict[str, Any]] = []
_loaded = False
MAX_ITEMS = 200
MAX_ACTIVITY = 500


def _persist_path() -> Path:
    base = Path(os.getenv("RESIDENCE_PERSIST_DIR", str(Path.home() / ".residence")))
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError:
        base = Path(os.getenv("TMPDIR", "/tmp")) / "residence"
        base.mkdir(parents=True, exist_ok=True)
    return base / "desktop_pending.json"


def _load() -> None:
    global _pending, _captures, _activity, _loaded
    if _loaded:
        return
    path = _persist_path()
    try:
        if path.exists():
            data = json.loads(path.read_text())
            # v1 persisted a plain list. v2 is a durable inbox state object.
            if isinstance(data, list):
                _pending = data
            elif isinstance(data, dict):
                _pending = list(data.get("items") or [])
                _captures = {
                    str(k): str(v) for k, v in (data.get("captures") or {}).items()
                }
                _activity = list(data.get("activity") or [])
    except Exception as e:
        log.warning("pending load failed: %s", e)
        _pending = []
    _loaded = True


def _save() -> None:
    path = _persist_path()
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(
                {
                    "version": 2,
                    "items": _pending[:MAX_ITEMS],
                    "captures": _captures,
                    "activity": _activity[:MAX_ACTIVITY],
                },
                indent=2,
            )
        )
        tmp.replace(path)
    except Exception as e:
        log.warning("pending save failed: %s", e)


def _preview(value: str, limit: int = 280) -> str:
    normalized = " ".join((value or "").split())
    return normalized[:limit] + ("…" if len(normalized) > limit else "")


def _record(event: str, **data: Any) -> dict[str, Any]:
    row = {"id": str(uuid.uuid4()), "at": time.time(), "event": event, **data}
    _activity.insert(0, row)
    del _activity[MAX_ACTIVITY:]
    return row


def register_capture(
    operation_id: str, source: str, method: str, text: str, content_hash: str
) -> bool:
    """Returns False for a retried capture already seen by Core."""
    global _captures
    with _lock:
        _load()
        if operation_id in _captures:
            return False
        _captures[operation_id] = content_hash
        _record(
            "captured",
            operationId=operation_id,
            source=source,
            method=method,
            preview=_preview(text),
            contentHash=content_hash,
        )
        # Keep a bounded idempotency registry; it is not an unbounded text store.
        if len(_captures) > MAX_ITEMS:
            _captures = dict(list(_captures.items())[-MAX_ITEMS:])
        _save()
        return True


def push_permission(item: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _load()
        operation_id = str(item.get("operationId") or "")
        if operation_id:
            for existing in _pending:
                if (
                    existing.get("operationId") == operation_id
                    and existing.get("status") == "pending"
                ):
                    return existing
        row = {
            "id": str(uuid.uuid4()),
            "createdAt": time.time(),
            "status": "pending",
            **item,
        }
        _pending.insert(0, row)
        _record(
            "decision_queued",
            permissionId=row["id"],
            operationId=operation_id or None,
            source=row.get("source"),
            actionApp=row.get("actionApp"),
            preview=_preview(str(row.get("utterance") or row.get("body") or "")),
        )
        del _pending[MAX_ITEMS:]
        _save()
        return row


def list_pending(
    status: str = "pending", offset: int = 0, limit: int = 50
) -> list[dict[str, Any]]:
    with _lock:
        _load()
        rows = _pending if status == "all" else [p for p in _pending if p.get("status") == status]
        return rows[max(0, offset) : max(0, offset) + min(max(1, limit), 100)]


def resolve(perm_id: str, accept: bool) -> Optional[dict[str, Any]]:
    with _lock:
        _load()
        for p in _pending:
            if p.get("id") == perm_id:
                if p.get("status") != "pending":
                    # Idempotent resolve: a retry gets the immutable outcome.
                    return p
                p["status"] = "accepted" if accept else "declined"
                p["resolvedAt"] = time.time()
                _record(
                    "decision_resolved",
                    permissionId=perm_id,
                    operationId=p.get("operationId"),
                    outcome=p["status"],
                    source=p.get("source"),
                    actionApp=p.get("actionApp"),
                )
                _save()
                return p
        return None


def record_writeback(
    operation_id: str, permission_id: str, result: dict[str, Any]
) -> None:
    with _lock:
        _load()
        _record(
            "native_writeback",
            operationId=operation_id,
            permissionId=permission_id,
            outcome="succeeded" if result.get("ok") else "pending_retry",
            writes=result.get("writes") or [],
            error=result.get("error"),
        )
        _save()


def redact_resolved(perm_id: str) -> None:
    """Drop raw capture content after resolution; retain minimal audit metadata."""
    with _lock:
        _load()
        for item in _pending:
            if item.get("id") != perm_id or item.get("status") == "pending":
                continue
            raw = str(item.get("utterance") or item.get("payload", {}).get("text") or "")
            item["capturePreview"] = _preview(raw)
            item.pop("utterance", None)
            # Payload can contain raw email/note text. Resolution has already used it.
            item.pop("payload", None)
            _record(
                "capture_redacted",
                permissionId=perm_id,
                operationId=item.get("operationId"),
            )
            _save()
            return


def record_undo(
    fact_id: str, permission_id: Optional[str] = None, operation_id: Optional[str] = None
) -> None:
    with _lock:
        _load()
        _record(
            "decision_undone",
            factId=fact_id,
            permissionId=permission_id,
            operationId=operation_id,
        )
        _save()


def list_activity(offset: int = 0, limit: int = 100) -> list[dict[str, Any]]:
    with _lock:
        _load()
        return _activity[max(0, offset) : max(0, offset) + min(max(1, limit), 200)]


_SHOP_RE = re.compile(
    r"\b(buy|purchase|order|amazon|cart|checkout|product|sku|shipping|add to cart|"
    r"shopping|price|\$\d)\b",
    re.I,
)
_EVENT_RE = re.compile(
    r"\b(meet(?:ing)?|lunch|dinner|brunch|appointment|calendar|event|standup|"
    r"sync|call with|interview|birthday|wedding|flight|trip|tomorrow|tonight|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    re.I,
)
_BUDGET_RE = re.compile(
    r"\b(budget|ceiling|weekly spend|spend limit|afford only|\$\d+.*/\s*week)\b",
    re.I,
)
_HEALTH_RE = re.compile(r"\b(allerg(?:y|ic)|health condition|can'?t eat|can'?t wear)\b", re.I)
_REVISION_RE = re.compile(
    r"(?i)\b(?:"
    r"no longer|not true|never was|incorrect|strike that|"
    r"correction:|actually,\s+|actually\s+i(?:'m| am)|"
    r"update that|update my note|change that to|replace that with|"
    r"forget what i said|not going to(?:\s+the)?|"
    r"cancel(?:ling)? that|scratch that"
    r")"
)


def _is_shop(text: str) -> bool:
    return bool(_SHOP_RE.search(text or ""))


def _is_event(text: str) -> bool:
    return bool(_EVENT_RE.search(text or ""))


def _is_budget(text: str) -> bool:
    t = text or ""
    return bool(_BUDGET_RE.search(t)) or "ceilingweeklyusd" in t.lower()


def _is_health(text: str) -> bool:
    return bool(_HEALTH_RE.search(text or ""))


def _orthogonal_domains(a: str, b: str) -> bool:
    """Purchase ↔ event (and similar) are parallel Facts — not contradictions."""
    a_shop, b_shop = _is_shop(a), _is_shop(b)
    a_event, b_event = _is_event(a), _is_event(b)
    a_budget, b_budget = _is_budget(a), _is_budget(b)
    a_health, b_health = _is_health(a), _is_health(b)
    # Classic false positive: product purchase vs calendar event
    if (a_shop and b_event and not a_event) or (b_shop and a_event and not b_event):
        return True
    # Budget/health are only comparable within their own domain
    if (a_budget and not b_budget and (b_event or b_shop)) or (
        b_budget and not a_budget and (a_event or a_shop)
    ):
        return True
    if (a_health and not b_health and (b_event or b_shop or b_budget)) or (
        b_health and not a_health and (a_event or a_shop or a_budget)
    ):
        return True
    return False


def find_contradictions(text: str, existing_notes: list[str]) -> list[dict[str, str]]:
    """Contradiction detector — same-domain only (allergy / budget / note revision).

    Orthogonal Facts (e.g. a product purchase and a calendar event) are never
    treated as contradictions.
    """
    lower = text.lower().strip()
    out: list[dict[str, str]] = []
    if not lower or not existing_notes:
        return out

    m = re.search(
        r"\b(?:not|no longer|aren't|am not|i'm not)\s+allergic to ([a-z0-9\-]+(?:\s+[a-z0-9\-]+)?)",
        lower,
    )
    if m:
        substance = m.group(1).strip()
        substance = re.sub(
            r"\s+(?:anymore|any more|now|either|though|really)$", "", substance
        ).strip()
        for note in existing_notes:
            if _orthogonal_domains(lower, note):
                continue
            if "allergic" in note.lower() and substance in note.lower():
                out.append(
                    {
                        "kind": "allergy_flip",
                        "existing": note,
                        "incoming": text.strip(),
                        "summary": f"Notes say you’re allergic to {substance}; Claude said you’re not.",
                    }
                )

    # Budget conflicts require explicit budget language on BOTH sides —
    # not bare "$" on a purchase vs "week" on a calendar note.
    incoming_budget = _is_budget(lower)
    new_money = re.findall(r"\$\s?(\d+(?:\.\d+)?)", lower)
    if not new_money:
        new_money = re.findall(r"\b(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)\b", lower)
    if incoming_budget and new_money:
        for note in existing_notes:
            if not _is_budget(note) or _orthogonal_domains(lower, note):
                continue
            old_money = re.findall(r"\$\s?(\d+(?:\.\d+)?)", note.lower())
            if not old_money:
                old_money = re.findall(
                    r"ceilingweeklyusd[\"']?\s*:\s*(\d+(?:\.\d+)?)", note.lower()
                )
            if old_money and float(new_money[0]) != float(old_money[0]):
                out.append(
                    {
                        "kind": "budget_conflict",
                        "existing": note,
                        "incoming": text.strip(),
                        "summary": f"Notes/Wallet have ${old_money[0]}; new text says ${new_money[0]}.",
                    }
                )

    # Note revisions: require explicit correction language, and never across domains.
    if _REVISION_RE.search(lower):
        for note in existing_notes:
            if _orthogonal_domains(lower, note):
                continue
            # Skip comparing shopping/events unless both look like the same domain
            if (_is_shop(lower) and _is_event(note)) or (_is_event(lower) and _is_shop(note)):
                continue
            core = re.sub(r"[^\w\s]", "", note.lower())
            stop = {
                "that",
                "this",
                "with",
                "from",
                "have",
                "been",
                "were",
                "your",
                "about",
                "into",
                "next",
                "week",
                "only",
            }
            words = [w for w in core.split() if len(w) > 3 and w not in stop][:6]
            if len(words) >= 2 and all(w in lower for w in words[:2]):
                out.append(
                    {
                        "kind": "note_revision",
                        "existing": note,
                        "incoming": text.strip(),
                        "summary": "New text looks like a revision of an existing note.",
                    }
                )
    seen = set()
    uniq = []
    for c in out:
        if c["summary"] not in seen:
            seen.add(c["summary"])
            uniq.append(c)
    return uniq
