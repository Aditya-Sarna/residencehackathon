"""Use saved Facts to prompt elsewhere — contradictions, events, shop guards, gifts."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from desktop_bridge import find_contradictions
from inference import Intent, Slots


@dataclass
class MemoryBundle:
    budget: Optional[float] = None
    health_notes: list[str] = field(default_factory=list)
    commitments: list[dict[str, Any]] = field(default_factory=list)
    note_strings: list[str] = field(default_factory=list)


def _parse_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return raw


def load_memory(broker: Any) -> MemoryBundle:
    mem = MemoryBundle()
    mem.broker = broker  # type: ignore[attr-defined]  # used by related-chat recall
    if not broker:
        return mem

    # Budget — finance-agent first, mentor-user fallback (demo seeds differ)
    for agent in ("finance-agent", "mentor-user"):
        if mem.budget is not None:
            break
        try:
            resp = broker.query_facts("ceilingWeeklyUsd", agent, "Budget")
            for r in resp.results:
                if r.stale:
                    continue
                val = _parse_value(r.fact.value)
                if isinstance(val, dict) and val.get("ceilingWeeklyUsd") is not None:
                    mem.budget = float(val["ceilingWeeklyUsd"])
                    mem.note_strings.append(f"budget ${mem.budget}/week")
                    break
        except Exception:
            pass

    # Health
    try:
        resp = broker.query_facts("Health", "mentor-user", "Health Condition")
        for r in resp.results:
            if r.stale:
                continue
            val = _parse_value(r.fact.value)
            note = str(val.get("note") if isinstance(val, dict) else val)
            if note:
                mem.health_notes.append(note)
                mem.note_strings.append(note)
    except Exception:
        pass

    # Commitments
    try:
        resp = broker.query_facts("Commitment", "calendar-health-agent", "Commitment")
        for r in resp.results:
            if r.stale:
                continue
            val = _parse_value(r.fact.value)
            if not isinstance(val, dict):
                continue
            row = {
                "title": str(val.get("title") or ""),
                "dayOfMonth": val.get("dayOfMonth"),
                "dateISO": val.get("dateISO"),
                "startHhmm": val.get("startHhmm"),
                "person": val.get("person"),
                "city": val.get("city"),
                "occasion": val.get("occasion"),
                "sourceText": val.get("sourceText"),
            }
            mem.commitments.append(row)
            bits = [row["title"]]
            if row.get("person"):
                bits.append(str(row["person"]))
            mem.note_strings.append(" ".join(b for b in bits if b))
    except Exception:
        pass

    return mem


_ALLERGEN_RE = re.compile(
    r"allergic to ([a-z0-9][a-z0-9 \-]{1,40})|"
    r"allergy to ([a-z0-9][a-z0-9 \-]{1,40})|"
    r"can'?t (?:eat|have|wear) ([a-z0-9][a-z0-9 \-]{1,40})",
    re.I,
)


def allergens_from_notes(notes: list[str]) -> list[str]:
    out: list[str] = []
    for note in notes:
        for m in _ALLERGEN_RE.finditer(note):
            g = next((x for x in m.groups() if x), None)
            if g:
                token = g.strip().lower()
                token = re.sub(r"\s+(anymore|any more|now)$", "", token).strip()
                if token and token not in out:
                    out.append(token)
        # bare "nickel" style wellness chips
        low = note.lower()
        for word in ("nickel", "peanut", "shellfish", "gluten", "latex", "dairy"):
            if word in low and word not in out:
                out.append(word)
    return out


def product_hits_allergen(text: str, allergen: str) -> bool:
    low = text.lower()
    a = allergen.lower()
    if a not in low:
        return False
    # "nickel-free" / "without peanuts" is safe
    if re.search(rf"\b{re.escape(a)}\s*-?\s*free\b", low):
        return False
    if re.search(rf"\b(?:no|without|free of)\s+{re.escape(a)}\b", low):
        return False
    return True


def memory_augment(
    text: str,
    slots: Slots,
    intents: list[Intent],
    memory: MemoryBundle,
) -> list[Intent]:
    """Append Intent prompts that reuse saved Facts in a new context."""
    lower = text.lower().strip()
    if not lower:
        return intents

    existing_types = {i.type for i in intents}
    extra: list[Intent] = []

    # --- Cross-reasoning (same-day clash, ask times, trip clash, …) ---
    from cross_reason import cross_reason

    for intent in cross_reason(text, slots, intents, memory):
        extra.append(intent)

    # --- Contradictions vs saved notes ---
    for c in find_contradictions(text, memory.note_strings):
        app = "wallet" if c["kind"] == "budget_conflict" else "wellness"
        extra.append(
            Intent(
                type="memory.contradiction",
                confidence=0.92,
                target_app=app,
                title="Your notes disagree — fix?",
                body=c["summary"],
                payload={
                    "kind": c["kind"],
                    "existing": c["existing"],
                    "incoming": c["incoming"],
                    "note": c["incoming"],
                    "text": text,
                    "fromMemory": True,
                },
            )
        )

    allergens = allergens_from_notes(memory.health_notes)
    # Avoid bare "get"/"need" (too common) — require real shopping language
    shopping = bool(
        re.search(r"\b(buy|purchase|order|shop(?:ping)?|looking for)\b", lower)
    ) or bool(slots.product_hints)

    # --- Allergy guard when shopping / mentioning products ---
    if allergens and (
        shopping
        or any(k in lower for k in ("watch", "shoes", "jewelry", "chain", "bracelet"))
    ):
        hit = None
        blob = " ".join([lower, *slots.product_hints])
        for a in allergens:
            if a in blob and product_hits_allergen(blob, a):
                hit = a
                break
        if hit and "memory.allergy_guard" not in existing_types:
            extra.append(
                Intent(
                    type="memory.allergy_guard",
                    confidence=0.9,
                    target_app="shop",
                    title="Hold — allergy on file",
                    body=f"Wellness remembers you’re allergic to {hit}. Skip risky items?",
                    payload={
                        "allergen": hit,
                        "q": "safe",
                        "blocked": True,
                        "fromMemory": True,
                    },
                )
            )

    # --- Commitment person → gift / calendar reuse (before budget so gift wins Shop) ---
    for c in memory.commitments:
        person = (c.get("person") or "").strip()
        title = (c.get("title") or "").strip()
        day = c.get("dayOfMonth")
        city = (c.get("city") or "").strip()
        person_l = person.lower()
        title_l = title.lower()

        mentions_person = bool(person_l) and person_l in lower
        mentions_title = bool(title_l) and len(title_l) > 3 and title_l in lower
        title_words = set(re.findall(r"[a-z]{4,}", title_l))
        utter_words = set(re.findall(r"[a-z]{4,}", lower))
        related_event = bool(title_words & utter_words) or mentions_person or mentions_title

        if mentions_person and (
            slots.wants_gift or any(k in lower for k in ("gift", "present", "souvenir"))
        ):
            if "memory.gift_from_calendar" not in existing_types and "shop.gift" not in existing_types:
                extra.append(
                    Intent(
                        type="memory.gift_from_calendar",
                        confidence=0.9,
                        target_app="shop",
                        title=f"Shop a gift for {person}?",
                        body=f"Calendar has “{title or 'an event'}”"
                        + (f" on the {day}" if day else "")
                        + " — use that?",
                        payload={
                            "who": person,
                            "title": title,
                            "day": str(day or ""),
                            "q": "gift",
                            "fromMemory": True,
                        },
                    )
                )

        # Soft nudge only with follow-through language (avoids noisy person mentions)
        if (
            mentions_person
            and not slots.wants_gift
            and re.search(
                r"\b(remind|confirm|pull up|check on|follow up|what about|open)\b",
                lower,
            )
            and "memory.open_commitment" not in existing_types
            and not any(i.type == "calendar.commitment" for i in intents)
        ):
            extra.append(
                Intent(
                    type="memory.open_commitment",
                    confidence=0.82,
                    target_app="calendar",
                    title=f"Pull up {person}’s event?",
                    body=f"Saved: {title or 'commitment'}"
                    + (f" · day {day}" if day else ""),
                    payload={
                        "title": title or f"See {person}",
                        "dayOfMonth": day,
                        "person": person,
                        "text": text,
                        "fromMemory": True,
                    },
                )
            )

        # Trip city mentioned → wellness prep with allergy-aware checklist
        if city and city.lower() in lower and "memory.trip_prep" not in existing_types:
            allergens = allergens_from_notes(memory.health_notes)
            checklist = ["meds", "charger", "comfortable shoes", "ID / passport"]
            if allergens:
                checklist.append(f"avoid {', '.join(allergens[:2])}")
            extra.append(
                Intent(
                    type="memory.trip_prep",
                    confidence=0.85,
                    target_app="wellness",
                    title=f"Prep for {city}?",
                    body="Calendar has this trip — save a packing / health note?",
                    payload={
                        "note": f"Trip prep for {city}: " + ", ".join(checklist),
                        "city": city,
                        "checklist": checklist,
                        "fromMemory": True,
                    },
                )
            )

        # Exam / interview language only when it matches that saved event
        if related_event and any(
            k in lower for k in ("exam", "interview", "study", "nervous", "stress", "prep", "focus")
        ):
            if "memory.exam_focus" not in existing_types:
                extra.append(
                    Intent(
                        type="memory.exam_focus",
                        confidence=0.86,
                        target_app="calendar",
                        title="Block focus time?",
                        body=f"You already have “{title or 'that event'}” — add a prep block?",
                        payload={
                            "title": f"Prep · {title}"[:80] if title else "Focus / prep",
                            "dayOfMonth": day,
                            "person": person,
                            "text": text,
                            "fromMemory": True,
                        },
                    )
                )
            if any(k in lower for k in ("stress", "anxious", "nervous", "overwhelmed")):
                if "memory.stress_checkin" not in existing_types:
                    extra.append(
                        Intent(
                            type="memory.stress_checkin",
                            confidence=0.84,
                            target_app="wellness",
                            title="Log how you’re feeling?",
                            body="Wellness can keep this private — Calendar already has the date.",
                            payload={
                                "note": text.strip()[:200],
                                "fromMemory": True,
                            },
                        )
                    )

    # --- Saved budget guards shop (skip pure gift prompts — gift intent owns Shop) ---
    giftish = slots.wants_gift or any(
        i.type in ("memory.gift_from_calendar", "shop.gift") for i in (extra + intents)
    )
    if (
        memory.budget is not None
        and shopping
        and not giftish
        and "youtube" not in lower
        and "youtu.be" not in lower
        and "shop.caution" not in existing_types
        and "memory.budget_guard" not in existing_types
        and "memory.allergy_guard" not in {i.type for i in extra}
    ):
        price_hint = slots.money[0] if slots.money else None
        over = price_hint is not None and price_hint > memory.budget
        extra.append(
            Intent(
                type="memory.budget_guard",
                confidence=0.88 if over else 0.78,
                target_app="shop",
                title="Wallet says stay under budget",
                body=(
                    f"${price_hint:g} is over your ${memory.budget:g}/week ceiling."
                    if over
                    else f"You locked ${memory.budget:g}/week — I’ll prefer cheaper picks."
                ),
                payload={
                    "ceilingWeeklyUsd": memory.budget,
                    "tight": True,
                    "q": "books" if (price_hint or 0) > (memory.budget or 0) else "gift",
                    "fromMemory": True,
                },
            )
        )

    # --- Upcoming commitment when user says “tomorrow / today” without new details ---
    if (
        slots.relative_when in ("tomorrow", "today", "tonight")
        and memory.commitments
        and not any(i.type.startswith("calendar.") for i in intents)
        and "memory.upcoming" not in existing_types
    ):
        from datetime import date, timedelta

        today = date.today()
        target_day = (
            today.day
            if slots.relative_when in ("today", "tonight")
            else (today + timedelta(days=1)).day
        )
        matched = next(
            (
                c
                for c in memory.commitments
                if c.get("dayOfMonth") is not None and int(c["dayOfMonth"]) == target_day
            ),
            None,
        )
        c = matched or memory.commitments[0]
        extra.append(
            Intent(
                type="memory.upcoming",
                confidence=0.82 if matched else 0.75,
                target_app="calendar",
                title="Use a saved event?",
                body=f"“{c.get('title') or 'Saved commitment'}” is on file"
                + (f" (day {c.get('dayOfMonth')})" if c.get("dayOfMonth") else "")
                + ".",
                payload={
                    "title": c.get("title") or "Saved commitment",
                    "dayOfMonth": c.get("dayOfMonth"),
                    "person": c.get("person") or "",
                    "text": text,
                    "fromMemory": True,
                },
            )
        )

    # --- Related Claude/GPT chats (text recall ask) ---
    try:
        import chat_recall

        broker = getattr(memory, "broker", None)
        if (
            broker is not None
            and chat_recall.is_recall_ask(text)
            and "memory.related_chats" not in existing_types
        ):
            hits = chat_recall.search_conversations(broker, text, limit=5)
            summary = chat_recall.summarize_related(text, hits, use_llm=False)
            extra.append(
                Intent(
                    type="memory.related_chats",
                    confidence=0.9 if hits else 0.7,
                    target_app="notes",
                    title="Related Claude/GPT chats" if hits else "No related chats yet",
                    body=summary[:280],
                    payload={
                        "q": "related_chats",
                        "summary": summary,
                        "note": summary,
                        "text": summary,
                        "title": "Related chats",
                        "fromMemory": True,
                        "hitCount": len(hits),
                    },
                )
            )
    except Exception:
        pass

    # Prefer memory prompts early so they win the per-app notification slot
    if extra:
        return extra + intents
    return intents


def memory_summary(memory: MemoryBundle) -> dict[str, Any]:
    return {
        "budget": memory.budget,
        "allergens": allergens_from_notes(memory.health_notes),
        "healthNotes": memory.health_notes[:8],
        "commitments": memory.commitments[:8],
    }
