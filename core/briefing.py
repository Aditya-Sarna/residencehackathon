"""Daily usefulness — morning briefing + Calendar → Fact import proposals."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

from memory_inference import allergens_from_notes, load_memory


def _norm_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    t = re.sub(r"^\[residence.*?\]\s*", "", t)
    return t[:80]


def _parse_iso(raw: Any) -> Optional[date]:
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except Exception:
        return None


def commitment_on_date(c: dict[str, Any], day: date) -> bool:
    iso = _parse_iso(c.get("dateISO"))
    if iso is not None:
        return iso == day
    dom = c.get("dayOfMonth")
    if dom is None or dom == "":
        return False
    try:
        return int(dom) == day.day
    except Exception:
        return False


def build_briefing(
    broker: Any,
    *,
    calendar_events: Optional[list[dict[str, Any]]] = None,
    pending_count: int = 0,
) -> dict[str, Any]:
    """Assemble a Today digest from Facts (+ optional Apple Calendar rows)."""
    mem = load_memory(broker)
    today = date.today()
    today_iso = today.isoformat()

    today_facts = [c for c in mem.commitments if commitment_on_date(c, today)]
    upcoming = []
    for c in mem.commitments:
        iso = _parse_iso(c.get("dateISO"))
        if iso and today < iso <= date.fromordinal(today.toordinal() + 7):
            upcoming.append(c)
        elif c.get("dayOfMonth") is not None and not iso:
            try:
                if int(c["dayOfMonth"]) != today.day:
                    upcoming.append(c)
            except Exception:
                pass

    cal_today = []
    for ev in calendar_events or []:
        iso = _parse_iso(ev.get("dateISO"))
        if iso == today:
            cal_today.append(ev)

    clashes: list[dict[str, Any]] = []
    fact_titles = {_norm_title(str(c.get("title") or "")) for c in today_facts}
    for ev in cal_today:
        t = _norm_title(str(ev.get("title") or ""))
        if not t:
            continue
        # Clash = Calendar event on a day that already has a *different* Fact commitment
        others = [c for c in today_facts if _norm_title(str(c.get("title") or "")) != t]
        if others and t not in fact_titles:
            clashes.append(
                {
                    "kind": "calendar_fact_overlap",
                    "calendar": ev.get("title"),
                    "facts": [c.get("title") for c in others[:4]],
                    "dateISO": today_iso,
                }
            )
        elif len(cal_today) + len(today_facts) >= 3 and t not in fact_titles:
            clashes.append(
                {
                    "kind": "packed_day",
                    "calendar": ev.get("title"),
                    "facts": [c.get("title") for c in today_facts[:4]],
                    "dateISO": today_iso,
                }
            )

    allergens = allergens_from_notes(mem.health_notes)
    n_events = len(cal_today)
    n_facts = len(today_facts)
    bits = []
    if n_events:
        bits.append(f"{n_events} Calendar")
    if n_facts:
        bits.append(f"{n_facts} Residence")
    if mem.budget is not None:
        bits.append(f"${mem.budget:g}/wk budget")
    if allergens:
        bits.append(f"allergy: {', '.join(allergens[:2])}")
    if pending_count:
        bits.append(f"{pending_count} waiting Accept")
    if clashes:
        bits.append(f"{len(clashes)} clash")

    if bits:
        headline = "Today · " + " · ".join(bits[:5])
    else:
        headline = "Today · clear — capture with ⌘⇧R when plans change"

    lines: list[str] = []
    for ev in cal_today[:5]:
        hh = ev.get("startHhmm") or ""
        lines.append(f"📅 {hh} {ev.get('title') or 'Event'}".strip())
    for c in today_facts[:5]:
        lines.append(f"● {c.get('title') or 'Commitment'}")
    if mem.budget is not None:
        lines.append(f"Wallet ceiling ${mem.budget:g}/week")
    if allergens:
        lines.append("Avoid: " + ", ".join(allergens[:4]))
    for clash in clashes[:3]:
        lines.append(
            f"⚠ {clash.get('calendar')} overlaps "
            + ", ".join(str(x) for x in (clash.get("facts") or [])[:2])
        )
    if pending_count:
        lines.append(f"{pending_count} item(s) in Accept inbox (⌘⇧I)")

    return {
        "ok": True,
        "dateISO": today_iso,
        "headline": headline,
        "summary": "\n".join(lines) if lines else "No commitments on file for today.",
        "today": {
            "calendar": cal_today[:12],
            "commitments": today_facts[:12],
        },
        "upcoming": upcoming[:8],
        "budget": mem.budget,
        "allergens": allergens,
        "healthNotes": mem.health_notes[:6],
        "pendingCount": pending_count,
        "clashes": clashes[:8],
        "habit": {
            "capture": "⌘⇧R",
            "inbox": "⌘⇧I",
            "briefing": "residence://briefing",
        },
    }


def propose_calendar_imports(
    broker: Any,
    events: list[dict[str, Any]],
    *,
    push_permission,
    source: str = "apple-calendar-sync",
) -> dict[str, Any]:
    """Queue Accept items for Calendar events not already mirrored as Commitments."""
    mem = load_memory(broker)
    known: set[tuple[str, str]] = set()
    for c in mem.commitments:
        title = _norm_title(str(c.get("title") or ""))
        iso = _parse_iso(c.get("dateISO"))
        if iso and title:
            known.add((title, iso.isoformat()))
        elif title and c.get("dayOfMonth") is not None:
            try:
                # Approximate: same day-of-month this month
                approx = date.today().replace(day=int(c["dayOfMonth"]))
                known.add((title, approx.isoformat()))
            except Exception:
                pass

    queued: list[dict[str, Any]] = []
    skipped = 0
    clashes: list[dict[str, Any]] = []

    for ev in events[:40]:
        title = str(ev.get("title") or "").strip()
        iso_d = _parse_iso(ev.get("dateISO"))
        if not title or not iso_d:
            skipped += 1
            continue
        key = (_norm_title(title), iso_d.isoformat())
        if key in known:
            skipped += 1
            continue

        same_day = [c for c in mem.commitments if commitment_on_date(c, iso_d)]
        if same_day:
            clashes.append(
                {
                    "kind": "same_day_conflict",
                    "calendar": title,
                    "facts": [c.get("title") for c in same_day[:4]],
                    "dateISO": iso_d.isoformat(),
                }
            )

        body = f"Import “{title}” from Apple Calendar into Residence Facts?"
        if same_day:
            body += " Day already has: " + ", ".join(
                str(c.get("title") or "?") for c in same_day[:3]
            )

        op = f"cal-sync:{key[0][:40]}:{iso_d.isoformat()}:{ev.get('startHhmm') or ''}"
        row = push_permission(
            {
                "kind": "calendar_import",
                "source": source,
                "operationId": op,
                "captureMethod": "calendar-sync",
                "consentMode": "explicit",
                "title": "Import Calendar event?",
                "body": body[:280],
                "actionApp": "calendar",
                "payload": {
                    "title": title[:80],
                    "dayOfMonth": iso_d.day,
                    "dateISO": iso_d.isoformat(),
                    "startHhmm": ev.get("startHhmm") or "",
                    "text": title,
                    "fromCalendarSync": True,
                },
                "utterance": f"{title} on {iso_d.isoformat()}"
                + (f" at {ev.get('startHhmm')}" if ev.get("startHhmm") else ""),
            }
        )
        queued.append(row)
        known.add(key)

    return {
        "ok": True,
        "proposed": len(queued),
        "skipped": skipped,
        "queued": queued,
        "clashes": clashes[:12],
        "eventsSeen": len(events),
    }


def parse_event_row(line: str) -> Optional[dict[str, Any]]:
    """Parse `title\\tdateISO\\tHH:MM` lines from macOS AppleScript."""
    parts = line.split("\t")
    if len(parts) < 2:
        return None
    title = parts[0].strip()
    iso = parts[1].strip()
    hhmm = parts[2].strip() if len(parts) > 2 else ""
    if not title or not _parse_iso(iso):
        return None
    return {"title": title[:120], "dateISO": iso[:10], "startHhmm": hhmm[:5]}
