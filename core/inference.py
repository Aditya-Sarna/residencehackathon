"""Cross-app inference — production NLU that routes natural language to apps.

Pipeline:
1. Normalize text (voice transcript or typed)
2. Extract slots: money, dates, times, people, places, health, urgency
3. Score intents (calendar / clock / wallet / shop / gifts / wellness / travel / kitchen)
4. Optionally refine with LLM when ANTHROPIC_API_KEY or OPENAI_API_KEY is set
5. Persist Facts via FactBroker when requested
6. Emit user-facing notifications derived from slots (never hardcoded demo scripts)
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from models import CertificationStatus, SensitivityTag

log = logging.getLogger("residence.inference")

# Ordinal / relative day phrases → day of month (best-effort for personal OS)
_DAY_WORDS = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
    "eleventh": 11,
    "twelfth": 12,
    "thirteenth": 13,
    "fourteenth": 14,
    "fifteenth": 15,
    "sixteenth": 16,
    "seventeenth": 17,
    "eighteenth": 18,
    "nineteenth": 19,
    "twentieth": 20,
    "twenty first": 21,
    "twenty-first": 21,
    "twenty second": 22,
    "twenty-second": 22,
    "twenty third": 23,
    "twenty-third": 23,
    "twenty fourth": 24,
    "twenty-fourth": 24,
    "twenty fifth": 25,
    "twenty-fifth": 25,
    "twenty sixth": 26,
    "twenty-sixth": 26,
    "twenty seventh": 27,
    "twenty-seventh": 27,
    "twenty eighth": 28,
    "twenty-eighth": 28,
    "twenty ninth": 29,
    "twenty-ninth": 29,
    "thirtieth": 30,
    "thirty first": 31,
    "thirty-first": 31,
}

_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

# Residence ships exactly five apps. Secondary intents remap into them.
CANONICAL_APPS = ("voice", "calendar", "wallet", "shop", "wellness")

APP_ALIASES = {
    "clock": "calendar",
    "reminders": "calendar",
    "gifts": "shop",
    "travel": "calendar",
    "kitchen": "shop",
    "people": "calendar",
    "notes": "voice",
    "photos": "voice",
}

APP_COLORS = {
    "voice": "#ff6a2b",
    "calendar": "#2f6f8f",
    "wallet": "#1f6b45",
    "shop": "#e85d2c",
    "wellness": "#c44d66",
}

APP_LABELS = {
    "voice": "Voice",
    "calendar": "Calendar",
    "wallet": "Wallet",
    "shop": "Shop",
    "wellness": "Wellness",
}


def canonical_app(app_id: str) -> str:
    a = APP_ALIASES.get(app_id, app_id)
    return a if a in CANONICAL_APPS else "voice"


@dataclass
class Slots:
    raw: str
    money: list[float] = field(default_factory=list)
    day_of_month: Optional[int] = None
    month: Optional[int] = None
    time_hhmm: Optional[str] = None
    relative_when: Optional[str] = None  # today / tomorrow / tonight / morning
    person: Optional[str] = None
    place: Optional[str] = None
    occasion: Optional[str] = None
    health_notes: list[str] = field(default_factory=list)
    product_hints: list[str] = field(default_factory=list)
    budget_tight: bool = False
    wants_gift: bool = False
    wants_buy: bool = False
    wants_remind: bool = False
    is_trip: bool = False
    is_meal: bool = False


@dataclass
class Intent:
    type: str
    confidence: float
    target_app: str
    title: str
    body: str
    payload: dict[str, Any]
    glossary_term: Optional[str] = None
    sensitivity: str = "none"
    should_persist: bool = False
    fact_value: Optional[dict[str, Any]] = None


def _normalize(text: str) -> str:
    t = text.strip()
    t = re.sub(r"\s+", " ", t)
    return t


def extract_slots(text: str) -> Slots:
    raw = _normalize(text)
    lower = raw.lower()
    slots = Slots(raw=raw)

    # Money
    for m in re.finditer(
        r"(?:\$|usd\s*)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd)",
        lower,
    ):
        val = m.group(1) or m.group(2)
        if val:
            slots.money.append(float(val))
    # bare numbers near budget language
    if re.search(r"\b(budget|spend|ceiling|balance|afford|left|only)\b", lower):
        for m in re.finditer(r"\b(\d{2,5})(?:\.\d{1,2})?\b", lower):
            n = float(m.group(1))
            if n not in slots.money and n < 100_000:
                slots.money.append(n)

    slots.budget_tight = bool(
        re.search(
            r"\b(can'?t afford|cannot afford|broke|tight|low balance|not enough|"
            r"running low|only have|barely|overspend|over budget|too expensive|"
            r"balance isn'?t|isn'?t much|isn'?t enough|don'?t have enough)\b",
            lower,
        )
    )

    # Day of month: 15th, day 15, on the 15
    m = re.search(r"\b(?:on\s+the\s+|day\s+)?(\d{1,2})(st|nd|rd|th)?\b", lower)
    if m:
        d = int(m.group(1))
        if 1 <= d <= 31:
            slots.day_of_month = d
    for phrase, day in _DAY_WORDS.items():
        if phrase in lower:
            slots.day_of_month = day
            break

    for name, num in _MONTHS.items():
        if re.search(rf"\b{name}\b", lower):
            slots.month = num
            break

    # Clock / time
    tm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", lower)
    if tm:
        h = int(tm.group(1))
        mi = int(tm.group(2) or "0")
        ap = tm.group(3)
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        slots.time_hhmm = f"{h:02d}:{mi:02d}"
        slots.wants_remind = True
    if re.search(r"\b(at\s+\d{1,2}|o'?clock|remind me|alarm|wake me|tonight at)\b", lower):
        slots.wants_remind = True
    for rel in ("tonight", "tomorrow", "this morning", "this evening", "this afternoon", "today"):
        if rel in lower:
            slots.relative_when = rel
            if rel in ("tonight", "this morning", "this evening", "this afternoon") or "remind" in lower:
                slots.wants_remind = True

    # People — "Sam's birthday", "Sam birthday", "for Maya", "with Jordan"
    person = None
    m = re.search(
        r"\b([A-Z][a-z]{1,20})(?:'s|’s)?\s+(birthday|anniversary|wedding|party|dinner)",
        raw,
    )
    if m:
        person = m.group(1)
        slots.occasion = m.group(2)
    if not person:
        m = re.search(
            r"\b([a-z]{2,20})(?:'s|’s)?\s+(birthday|anniversary|wedding|party|dinner)\b",
            lower,
        )
        if m and m.group(1) not in {"my", "the", "a", "our", "his", "her", "their"}:
            person = m.group(1).title()
            slots.occasion = m.group(2)
    if not person:
        m = re.search(r"\b(?:for|with|meet)\s+([A-Z][a-z]{1,20})\b", raw)
        if m and m.group(1).lower() not in {"i", "my", "the", "a"}:
            person = m.group(1)
    slots.person = person

    if re.search(r"\b(birthday|anniversary|wedding|party|celebration)\b", lower):
        slots.occasion = slots.occasion or re.search(
            r"\b(birthday|anniversary|wedding|party|celebration)\b", lower
        ).group(1)
        slots.wants_gift = True

    # Places / travel
    m = re.search(
        r"\b(?:to|in|visit|flying to|trip to|going to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
        raw,
    )
    if m:
        slots.place = m.group(1)
        slots.is_trip = True
    if re.search(r"\b(flight|trip|travel|vacation|hotel|airport)\b", lower):
        slots.is_trip = True

    # Health
    health_pats = [
        (r"allergic to ([a-z0-9 \-]{2,40})", "allergic to {}"),
        (r"allergy to ([a-z0-9 \-]{2,40})", "allergy to {}"),
        (r"\b(lactose intolerant|gluten free|gluten-free|nut allergy|nickel)\b", "{}"),
        (r"can'?t eat ([a-z0-9 \-]{2,40})", "can't eat {}"),
        (r"\b(feeling (?:sick|tired|anxious|stressed|burned out))\b", "{}"),
        (r"\b(migraine|headache|insomnia|panic attack)\b", "{}"),
    ]
    for pat, fmt in health_pats:
        m = re.search(pat, lower)
        if m:
            slots.health_notes.append(fmt.format(*(m.groups() or (m.group(0),))))

    # Commerce
    slots.wants_buy = bool(
        re.search(r"\b(buy|purchase|order|get|need|looking for|shop for)\b", lower)
    )
    slots.wants_gift = slots.wants_gift or bool(
        re.search(r"\b(gift|present|souvenir)\b", lower)
    )
    for hint in (
        "shoes",
        "sneakers",
        "runners",
        "watch",
        "headphones",
        "books",
        "loafers",
        "gift",
        "jacket",
        "hoodie",
        "backpack",
        "bottle",
        "lamp",
        "keyboard",
    ):
        if hint in lower:
            slots.product_hints.append(hint)

    # Kitchen
    slots.is_meal = bool(
        re.search(r"\b(cook|dinner|lunch|breakfast|recipe|meal|ingredients)\b", lower)
    )

    return slots


def _score_intents(slots: Slots, live_budget: Optional[float]) -> list[Intent]:
    intents: list[Intent] = []
    lower = slots.raw.lower()

    # Calendar — dated commitments / occasions / exams & deadlines
    cal_score = 0.0
    if slots.day_of_month or slots.month:
        cal_score += 0.45
    if slots.occasion:
        cal_score += 0.35
    if re.search(r"\b(meeting|appointment|birthday|anniversary|calendar|schedule)\b", lower):
        cal_score += 0.35
    if re.search(
        r"\b(exam|test|quiz|midterm|final|deadline|due|homework|assignment|interview|flight|shift)\b",
        lower,
    ):
        cal_score += 0.5
    if re.search(r"\b(watch|stream|youtube|movie|episode)\b", lower) and slots.relative_when:
        cal_score += 0.4
    if slots.relative_when in ("tomorrow", "today", "tonight", "this evening", "this afternoon"):
        cal_score += 0.35
    if re.search(r"\b(next week|this weekend|on monday|on tuesday|on wednesday|on thursday|on friday)\b", lower):
        cal_score += 0.4
    if slots.person and (slots.day_of_month or slots.occasion):
        cal_score += 0.15
    if cal_score >= 0.4:
        title_bits = []
        if slots.person and slots.occasion:
            title_bits.append(f"{slots.person}'s {slots.occasion}")
        elif slots.occasion:
            title_bits.append(slots.occasion.title())
        elif re.search(r"\b(exam|test|quiz|midterm|final|interview)\b", lower):
            kind = re.search(r"\b(exam|test|quiz|midterm|final|interview)\b", lower).group(1).title()
            when = slots.relative_when or "soon"
            title_bits.append(f"{kind} {when}")
        elif re.search(r"\b(watch|stream|youtube|movie|episode)\b", lower):
            title_bits.append(slots.raw[:48])
        elif slots.person:
            title_bits.append(f"Plan with {slots.person}")
        else:
            title_bits.append(slots.raw[:48])
        label = title_bits[0]
        day = slots.day_of_month
        if day is None and slots.relative_when in ("tomorrow", "tonight", "this evening"):
            from datetime import date as _date, timedelta as _td

            day = (_date.today() + _td(days=1 if slots.relative_when == "tomorrow" else 0)).day
        body = label
        if day:
            body = f"{label} — day {day}"
        intents.append(
            Intent(
                type="calendar.commitment",
                confidence=min(0.98, cal_score),
                target_app="calendar",
                title="Convert this into a note?",
                body=body,
                payload={
                    "title": label,
                    "dayOfMonth": day,
                    "person": slots.person,
                    "occasion": slots.occasion,
                    "when": slots.relative_when,
                },
                glossary_term="Commitment",
                should_persist=True,
                fact_value={
                    "title": label,
                    "dayOfMonth": day,
                    "person": slots.person,
                    "occasion": slots.occasion,
                    "sourceText": slots.raw,
                    "when": slots.relative_when,
                },
            )
        )

    # Clock — specific times / alarms / remind-at
    clock_score = 0.0
    if slots.time_hhmm:
        clock_score += 0.55
    if slots.wants_remind:
        clock_score += 0.35
    if slots.relative_when in ("tonight", "this morning", "this evening", "this afternoon"):
        clock_score += 0.2
    if clock_score >= 0.4:
        when = slots.time_hhmm or slots.relative_when or "later"
        intents.append(
            Intent(
                type="calendar.reminder",
                confidence=min(0.97, clock_score),
                target_app="calendar",
                title="Put this on Calendar?",
                body=f"I heard {when}"
                + (f" — {slots.raw[:60]}" if len(slots.raw) < 80 else ""),
                payload={
                    "time": slots.time_hhmm,
                    "when": slots.relative_when,
                    "text": slots.raw,
                    "title": slots.raw[:48],
                },
                glossary_term="Commitment",
                should_persist=False,
            )
        )

    # Wallet — money / tight balance
    wallet_score = 0.0
    if slots.money:
        wallet_score += 0.4
    if slots.budget_tight:
        wallet_score += 0.55
    if re.search(r"\b(budget|spend|ceiling|balance|wallet|afford)\b", lower):
        wallet_score += 0.3
    if wallet_score >= 0.4:
        amt = slots.money[0] if slots.money else live_budget
        if slots.budget_tight:
            title = "Your balance sounds tight"
            body = (
                f"I heard you may only have about ${amt:g}."
                if amt is not None
                else "I heard money is tight — want to lower this week’s spend?"
            )
            if amt is not None:
                body += " Want Wallet to lock that in?"
        else:
            title = "Update weekly spend?"
            body = f"Set weekly spend to ${amt:g}?" if amt is not None else "Open Wallet to adjust spend."
        intents.append(
            Intent(
                type="wallet.budget",
                confidence=min(0.97, wallet_score),
                target_app="wallet",
                title=title,
                body=body,
                payload={"ceilingWeeklyUsd": amt, "tight": slots.budget_tight},
                glossary_term="Budget",
                sensitivity="financial",
                should_persist=bool(amt is not None),
                fact_value={
                    "ceilingWeeklyUsd": amt,
                    "currency": "USD",
                    "sourceText": slots.raw,
                    "tight": slots.budget_tight,
                }
                if amt is not None
                else None,
            )
        )

    # Gifts fold into Shop
    if slots.wants_gift or (slots.occasion and slots.person):
        who = slots.person or "them"
        occ = slots.occasion or "something special"
        intents.append(
            Intent(
                type="shop.gift",
                confidence=0.82 if slots.wants_gift else 0.7,
                target_app="shop",
                title=f"Find a gift for {who}?",
                body=f"Based on “{occ}”"
                + (f" on day {slots.day_of_month}" if slots.day_of_month else ""),
                payload={
                    "who": slots.person,
                    "occasion": slots.occasion,
                    "title": f"{who}'s {occ}" if slots.person else occ,
                    "day": str(slots.day_of_month or ""),
                    "q": "gift",
                },
                glossary_term="Intent",
                should_persist=False,
            )
        )

    # Shop — buy intent or product hints; also if budget tight + product
    if slots.wants_buy or slots.product_hints:
        q = slots.product_hints[0] if slots.product_hints else "gift" if slots.wants_gift else "shoes"
        body = f"Looking for {q}."
        if live_budget is not None:
            body += f" Weekly spend is ${live_budget:g}."
        if slots.budget_tight:
            body += " I’ll stick to what’s affordable."
        intents.append(
            Intent(
                type="shop.search",
                confidence=0.78,
                target_app="shop",
                title="Search Shop?",
                body=body,
                payload={"q": q, "tight": slots.budget_tight},
                glossary_term="Intent",
                should_persist=False,
            )
        )

    # Wellness
    for note in slots.health_notes:
        intents.append(
            Intent(
                type="wellness.note",
                confidence=0.9,
                target_app="wellness",
                title="Save this for Wellness?",
                body=note,
                payload={"note": note},
                glossary_term="Health Condition",
                sensitivity="health",
                should_persist=True,
                fact_value={"note": note, "sourceText": slots.raw},
            )
        )

    # Travel → Calendar
    if slots.is_trip and slots.place:
        intents.append(
            Intent(
                type="calendar.trip",
                confidence=0.8,
                target_app="calendar",
                title="Block this trip?",
                body=f"Trip — {slots.place}",
                payload={
                    "title": f"Trip — {slots.place}",
                    "dayOfMonth": slots.day_of_month,
                    "city": slots.place,
                },
                glossary_term="Commitment",
                should_persist=True,
                fact_value={
                    "title": f"Trip — {slots.place}",
                    "dayOfMonth": slots.day_of_month,
                    "city": slots.place,
                    "kind": "trip",
                    "sourceText": slots.raw,
                },
            )
        )

    # Kitchen / meals → Shop for ingredients
    if slots.is_meal:
        intents.append(
            Intent(
                type="shop.ingredients",
                confidence=0.7,
                target_app="shop",
                title="Need ingredients?",
                body="I can look for staples that fit this week’s spend.",
                payload={"q": "groceries", "meal": slots.raw},
                should_persist=False,
            )
        )

    # People without a dated event → still surface on Calendar
    if slots.person and not any(i.type.startswith("calendar") for i in intents):
        intents.append(
            Intent(
                type="calendar.person",
                confidence=0.6,
                target_app="calendar",
                title=f"Something about {slots.person}?",
                body="I heard their name — add a date when you know it.",
                payload={"person": slots.person, "title": slots.person},
                should_persist=False,
            )
        )

    # Deduplicate by target_app+type keeping highest confidence
    best: dict[str, Intent] = {}
    for intent in intents:
        key = f"{intent.target_app}:{intent.type}"
        if key not in best or intent.confidence > best[key].confidence:
            best[key] = intent
    out = sorted(best.values(), key=lambda i: i.confidence, reverse=True)
    return out


def _llm_refine(text: str, slots: Slots, intents: list[Intent]) -> list[Intent]:
    """Optional LLM pass — only when keys exist. Never invents if parse fails."""
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not anthropic_key and not openai_key:
        return intents

    schema_hint = (
        'Return JSON {"intents":[{"type":"calendar.commitment|clock.reminder|wallet.budget|'
        'gifts.plan|shop.search|wellness.note|travel.plan","confidence":0-1,'
        '"target_app":"calendar|clock|wallet|shop|gifts|wellness|travel",'
        '"title":"...","body":"...","payload":{}}]}'
    )
    prompt = (
        "You route personal life utterances to phone apps. "
        "Only emit intents clearly supported by the text. No fluff.\n"
        f"TEXT: {text}\nSLOTS: {json.dumps(slots.__dict__, default=str)}\n"
        f"CURRENT: {json.dumps([i.__dict__ for i in intents], default=str)}\n"
        f"{schema_hint}"
    )
    try:
        if anthropic_key:
            import httpx

            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-3-5-haiku-latest",
                    "max_tokens": 800,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20,
            )
            r.raise_for_status()
            content = r.json()["content"][0]["text"]
        else:
            import httpx

            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                },
                timeout=20,
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]

        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            return intents
        data = json.loads(m.group(0))
        # Merge: LLM may improve wording/confidence, but must never strip the
        # Fact-persistence fields the regex pass established.
        by_type = {i.type: i for i in intents}
        refined: list[Intent] = []
        seen_types: set[str] = set()
        for item in data.get("intents") or []:
            itype = item.get("type", "notes.capture")
            seen_types.add(itype)
            base = by_type.get(itype)
            if base:
                base.title = item.get("title") or base.title
                base.body = item.get("body") or base.body
                base.confidence = max(base.confidence, float(item.get("confidence", 0.0)))
                refined.append(base)
            else:
                refined.append(
                    Intent(
                        type=itype,
                        confidence=float(item.get("confidence", 0.7)),
                        target_app=item.get("target_app", "notes"),
                        title=item.get("title", "Take a look?"),
                        body=item.get("body", text[:100]),
                        payload=item.get("payload") or {},
                        should_persist=False,
                    )
                )
        # Keep persisting regex intents the LLM dropped entirely
        for i in intents:
            if i.should_persist and i.type not in seen_types:
                refined.append(i)
        return refined or intents
    except Exception as e:
        log.warning("LLM refine skipped: %s", e)
        return intents


class InferenceEngine:
    def __init__(self, broker: Any = None) -> None:
        self.broker = broker

    def _live_budget(self) -> Optional[float]:
        if not self.broker:
            return None
        try:
            resp = self.broker.query_facts("ceilingWeeklyUsd", "finance-agent", "Budget")
            for r in resp.results:
                if r.stale:
                    continue
                val = json.loads(r.fact.value)
                return float(val.get("ceilingWeeklyUsd"))
        except Exception:
            return None
        return None

    def infer(
        self,
        text: str,
        source_app: str = "voice",
        persist: bool = True,
        agent_id: str = "mentor-user",
        use_llm: bool = True,
    ) -> dict[str, Any]:
        if not text or not text.strip():
            return {
                "ok": False,
                "error": "empty_text",
                "slots": {},
                "intents": [],
                "notifications": [],
                "persisted": [],
            }

        slots = extract_slots(text)
        live = self._live_budget()
        intents = _score_intents(slots, live)
        if use_llm:
            intents = _llm_refine(text, slots, intents)
        memory_meta: dict[str, Any] = {}

        # Cross-link: calendar occasion → Shop gift search if not already
        types = {i.type for i in intents}
        if "calendar.commitment" in types and "shop.gift" not in types:
            cal = next(i for i in intents if i.type == "calendar.commitment")
            who = cal.payload.get("person")
            if who or cal.payload.get("occasion"):
                intents.append(
                    Intent(
                        type="shop.gift",
                        confidence=max(0.65, cal.confidence - 0.1),
                        target_app="shop",
                        title=f"Find a gift{' for ' + who if who else ''}?",
                        body=cal.body,
                        payload={
                            "who": who,
                            "title": cal.payload.get("title"),
                            "day": str(cal.payload.get("dayOfMonth") or ""),
                            "occasion": cal.payload.get("occasion"),
                            "q": "gift",
                        },
                    )
                )

        # Wallet tight → shop caution notification
        if any(i.type == "wallet.budget" and i.payload.get("tight") for i in intents):
            if not any(i.type == "shop.search" for i in intents):
                intents.append(
                    Intent(
                        type="shop.caution",
                        confidence=0.7,
                        target_app="shop",
                        title="I’ll shop carefully",
                        body="Your balance sounds limited — I’ll prefer lower-priced picks.",
                        payload={"tight": True, "q": "essentials"},
                    )
                )

        # Saved Facts → prompts in other apps (contradiction, gift, budget, allergy, events)
        if self.broker:
            from memory_inference import load_memory, memory_augment, memory_summary

            memory = load_memory(self.broker)
            if live is None and memory.budget is not None:
                live = memory.budget
            intents = memory_augment(text, slots, intents, memory)
            memory_meta = memory_summary(memory)

        persisted: list[dict[str, Any]] = []
        if persist and self.broker:
            for intent in intents:
                if not intent.should_persist or not intent.glossary_term or not intent.fact_value:
                    continue
                try:
                    fact = self.broker.assert_fact(
                        {
                            "value": json.dumps(intent.fact_value),
                            "glossary_term": intent.glossary_term,
                            "certificationStatus": CertificationStatus.inferred.value,
                            "confidence": intent.confidence,
                        },
                        agent_id=agent_id,
                        confidence=intent.confidence,
                        sensitivity_tag=SensitivityTag(intent.sensitivity),
                        decision_label=f"infer:{intent.type}",
                    )
                    persisted.append(
                        {
                            "factId": fact.factId,
                            "type": intent.type,
                            "glossary_term": intent.glossary_term,
                        }
                    )
                    intent.payload["factId"] = fact.factId
                except Exception as e:
                    log.warning("persist failed for %s: %s", intent.type, e)

        notifications = []
        # Allow one memory prompt + one fresh prompt per app (memory wins first slot)
        seen_keys: set[str] = set()
        for intent in intents:
            target = canonical_app(intent.target_app)
            intent.target_app = target
            # Don't notify the same app the user is already in (except voice)
            if target == canonical_app(source_app) and source_app != "voice":
                continue
            is_mem = (
                intent.type.startswith("memory.")
                or intent.type.startswith("cross.")
                or bool(intent.payload.get("fromMemory"))
            )
            slot_key = f"{target}:{'mem' if is_mem else 'fresh'}"
            if slot_key in seen_keys:
                continue
            # Cap total noise — prefer memory, then fresh, max 4 banners
            if len(notifications) >= 4:
                break
            seen_keys.add(slot_key)
            notifications.append(
                {
                    "fromApp": target,
                    "fromLabel": APP_LABELS.get(target, target.title()),
                    "color": APP_COLORS.get(target, "#3a3834"),
                    "title": intent.title,
                    "body": intent.body,
                    "actionApp": target,
                    "payload": {
                        k: str(v) if v is not None else "" for k, v in intent.payload.items()
                    },
                    "confidence": intent.confidence,
                    "type": intent.type,
                    "fromMemory": is_mem,
                }
            )

        return {
            "ok": True,
            "engine": "residence-nlu-v1",
            "llm": bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")),
            "source_app": source_app,
            "memory": memory_meta,
            "text": slots.raw,
            "slots": {
                "money": slots.money,
                "dayOfMonth": slots.day_of_month,
                "month": slots.month,
                "time": slots.time_hhmm,
                "when": slots.relative_when,
                "person": slots.person,
                "place": slots.place,
                "occasion": slots.occasion,
                "health": slots.health_notes,
                "products": slots.product_hints,
                "budgetTight": slots.budget_tight,
                "wantsGift": slots.wants_gift,
                "wantsBuy": slots.wants_buy,
                "wantsRemind": slots.wants_remind,
                "isTrip": slots.is_trip,
                "isMeal": slots.is_meal,
            },
            "intents": [
                {
                    "type": i.type,
                    "confidence": i.confidence,
                    "target_app": i.target_app,
                    "title": i.title,
                    "body": i.body,
                    "payload": i.payload,
                }
                for i in intents
            ],
            "notifications": notifications,
            "persisted": persisted,
            "inferredAt": datetime.now(timezone.utc).isoformat(),
        }
