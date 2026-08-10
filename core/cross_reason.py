"""Cross-reasoning over saved Facts + the new utterance.

Examples:
- Two bookings on the same day → ask for times / reschedule
- Local meeting on a travel day → clash
- Exam day + social plan → priority conflict
- Packed day (3+) → warn before adding more
- Meal plan vs allergy
- YouTube watch on a busy day → watch later / move
- Missing time when the day already has something
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from inference import Intent, Slots


def _day_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _relative_day(when: Optional[str]) -> Optional[int]:
    today = date.today()
    if when == "today" or when == "tonight":
        return today.day
    if when == "tomorrow":
        # naive +1 day (good enough for demo personal OS)
        from datetime import timedelta

        return (today + timedelta(days=1)).day
    return None


def _proposed_day(slots: Slots) -> Optional[int]:
    if slots.day_of_month:
        return int(slots.day_of_month)
    return _relative_day(slots.relative_when)


def _is_booking(text: str, slots: Slots) -> bool:
    lower = text.lower()
    return bool(
        slots.day_of_month
        or slots.relative_when
        or slots.is_trip
        or re.search(
            r"\b(book|schedule|meet|meeting|lunch|dinner|coffee|call|dentist|"
            r"interview|appointment|reserve|hold|put on (?:my )?calendar|"
            r"add to calendar|sync|invite)\b",
            lower,
        )
    )


def _eventish_chunks(text: str) -> list[str]:
    """Split an utterance that books multiple things: 'dentist and lunch with Sam'."""
    lower = text.lower()
    # Split on and / then / also / plus between event-like phrases
    parts = re.split(r"\b(?:and also|and then|plus|, then|;\s*|/\s*)\b|\band\b", lower)
    chunks = [p.strip() for p in parts if p and p.strip()]
    event_words = (
        "meet",
        "lunch",
        "dinner",
        "coffee",
        "call",
        "dentist",
        "doctor",
        "interview",
        "exam",
        "flight",
        "trip",
        "party",
        "birthday",
        "sync",
        "standup",
        "book",
        "appointment",
        "yoga",
        "gym",
    )
    out = []
    for c in chunks:
        if "youtube" in c or "youtu.be" in c:
            continue
        if any(w in c for w in event_words) or re.search(r"\bwith [a-z]{2,}", c):
            out.append(c)
    return out if len(out) >= 2 else []


def _commitments_on_day(memory_commitments: list[dict], day: int) -> list[dict]:
    """Match by dayOfMonth, or by dateISO day when Facts carry real dates."""
    out: list[dict] = []
    for c in memory_commitments:
        iso = c.get("dateISO")
        if iso:
            try:
                from datetime import date as _date

                if _date.fromisoformat(str(iso)[:10]).day == day:
                    out.append(c)
                    continue
            except Exception:
                pass
        if _day_int(c.get("dayOfMonth")) == day:
            out.append(c)
    return out


def _has_time(text: str, slots: Slots) -> bool:
    if slots.time_hhmm:
        return True
    return bool(
        re.search(
            r"\b(\d{1,2}(:\d{2})?\s*(am|pm)|noon|midnight|morning|afternoon|evening)\b",
            text.lower(),
        )
    )


def _is_trip_commitment(c: dict) -> bool:
    blob = f"{c.get('title') or ''} {c.get('city') or ''} {c.get('sourceText') or ''}".lower()
    return bool(c.get("city")) or bool(
        re.search(r"\b(trip|flight|fly|travel|tokyo|paris|london)\b", blob)
    )


def _is_focus_commitment(c: dict) -> bool:
    blob = f"{c.get('title') or ''}".lower()
    return bool(re.search(r"\b(exam|interview|deadline|focus|study)\b", blob))


def cross_reason(
    text: str,
    slots: Slots,
    intents: list[Intent],
    memory: Any,
) -> list[Intent]:
    """Return high-priority cross-reasoning Intent prompts."""
    lower = text.lower().strip()
    if not lower:
        return []

    commitments = getattr(memory, "commitments", []) or []
    health = getattr(memory, "health_notes", []) or []
    budget = getattr(memory, "budget", None)
    extra: list[Intent] = []
    seen: set[str] = set()

    def add(intent: Intent) -> None:
        if intent.type in seen:
            return
        seen.add(intent.type)
        extra.append(intent)

    proposed_day = _proposed_day(slots)
    # “on exam day” / “on interview day” → use that commitment’s day
    if proposed_day is None:
        for c in commitments:
            title_l = str(c.get("title") or "").lower()
            if not title_l:
                continue
            key = title_l.split()[0]
            if len(key) >= 4 and f"{key} day" in lower:
                proposed_day = _day_int(c.get("dayOfMonth"))
                break

    booking = _is_booking(text, slots) or any(
        i.type.startswith("calendar.") for i in intents
    )
    has_time = _has_time(text, slots)
    same_day = _commitments_on_day(commitments, proposed_day) if proposed_day else []
    multi = _eventish_chunks(text)

    # 1) Same utterance books 2+ things without distinct times
    if len(multi) >= 2 and not (has_time and lower.count("am") + lower.count("pm") >= 2):
        add(
            Intent(
                type="cross.ask_times",
                confidence=0.93,
                target_app="calendar",
                title="Two things — what times?",
                body=f"I heard “{multi[0][:40]}” and “{multi[1][:40]}”. Pick times or reschedule one?",
                payload={
                    "events": " | ".join(multi[:3]),
                    "dayOfMonth": proposed_day or "",
                    "title": (slots.person and f"With {slots.person}") or multi[0][:60],
                    "text": text,
                    "needsTime": True,
                    "fromMemory": True,
                    "reason": "multi_book",
                },
            )
        )

    trips_on_day = [c for c in same_day if _is_trip_commitment(c)] if same_day else []
    focus_on_day = [c for c in same_day if _is_focus_commitment(c)] if same_day else []

    # 2) New booking lands on a day that already has something
    # Prefer specialized clash (trip / priority) over generic same-day when applicable.
    if booking and proposed_day and same_day and not trips_on_day:
        existing_titles = ", ".join(
            (c.get("title") or "event") for c in same_day[:3]
        )
        social = bool(
            re.search(r"\b(party|birthday|dinner|drinks|celebrate|hang out)\b", lower)
        ) or bool(slots.occasion in ("birthday", "party"))
        if focus_on_day and social:
            pass  # handled in priority_clash below
        elif not has_time:
            add(
                Intent(
                    type="cross.same_day_conflict",
                    confidence=0.94,
                    target_app="calendar",
                    title="That day is taken — time or move?",
                    body=f"Day {proposed_day} already has: {existing_titles}. Add a time, or reschedule?",
                    payload={
                        "dayOfMonth": proposed_day,
                        "existing": existing_titles,
                        "title": slots.person
                        and f"Meet {slots.person}"
                        or (slots.occasion or text[:60]),
                        "person": slots.person or "",
                        "text": text,
                        "needsTime": True,
                        "fromMemory": True,
                        "reason": "same_day",
                    },
                )
            )
        else:
            add(
                Intent(
                    type="cross.same_day_stack",
                    confidence=0.88,
                    target_app="calendar",
                    title="Stack on a busy day?",
                    body=f"Day {proposed_day} already has {existing_titles}. Keep both with your time, or move one?",
                    payload={
                        "dayOfMonth": proposed_day,
                        "existing": existing_titles,
                        "title": text[:60],
                        "text": text,
                        "time": slots.time_hhmm or "",
                        "fromMemory": True,
                        "reason": "same_day_timed",
                    },
                )
            )

    # 3) Packed day (3+ existing) — discourage another
    if booking and proposed_day and len(same_day) >= 3:
        add(
            Intent(
                type="cross.packed_day",
                confidence=0.9,
                target_app="calendar",
                title="That day is packed",
                body=f"{len(same_day)} things already on day {proposed_day}. Reschedule to another day?",
                payload={
                    "dayOfMonth": proposed_day,
                    "count": len(same_day),
                    "title": text[:60],
                    "text": text,
                    "fromMemory": True,
                },
            )
        )

    # 4) Local appointment vs travel day
    if booking and proposed_day and not slots.is_trip and trips_on_day:
        city = trips_on_day[0].get("city") or trips_on_day[0].get("title") or "your trip"
        add(
            Intent(
                type="cross.trip_clash",
                confidence=0.95,
                target_app="calendar",
                title="You’re traveling that day",
                body=f"Calendar has {city} on day {proposed_day}. Keep the local plan, or move it?",
                payload={
                    "dayOfMonth": proposed_day,
                    "city": city,
                    "title": text[:60],
                    "text": text,
                    "needsTime": True,
                    "fromMemory": True,
                },
            )
        )

    # 5) Social / party on exam·interview day
    if booking and proposed_day and focus_on_day:
        social = bool(
            re.search(r"\b(party|birthday|dinner|drinks|celebrate|hang out)\b", lower)
        ) or bool(slots.occasion in ("birthday", "party"))
        if social:
            add(
                Intent(
                    type="cross.priority_clash",
                    confidence=0.94,
                    target_app="calendar",
                    title="Exam day + social plan",
                    body=f"“{focus_on_day[0].get('title')}” is already on day {proposed_day}. Reschedule the social plan?",
                    payload={
                        "dayOfMonth": proposed_day,
                        "focus": focus_on_day[0].get("title"),
                        "title": text[:60],
                        "text": text,
                        "fromMemory": True,
                    },
                )
            )

    # 6) Meal / restaurant vs *food* allergy (not nickel/latex)
    food_allergens = []
    for note in health:
        m = re.search(r"allergic to ([a-z0-9\-]+)", note.lower())
        if not m:
            continue
        a = m.group(1)
        if a in (
            "peanut",
            "peanuts",
            "shellfish",
            "gluten",
            "dairy",
            "milk",
            "egg",
            "eggs",
            "soy",
            "wheat",
            "fish",
            "sesame",
            "tree",
        ):
            food_allergens.append(a)
    if food_allergens and re.search(
        r"\b(dinner|lunch|brunch|restaurant|sushi|thai|eat|order food)\b", lower
    ):
        hit = next((a for a in food_allergens if a in lower), food_allergens[0])
        add(
            Intent(
                type="cross.meal_allergy",
                confidence=0.9,
                target_app="wellness",
                title="Allergy check before you book",
                body=f"Wellness has allergy to {hit}. Confirm the place is safe?",
                payload={
                    "note": f"Check menu for {hit} before: {text[:120]}",
                    "allergen": hit,
                    "text": text,
                    "fromMemory": True,
                },
            )
        )

    # 7) YouTube / watch intent on a busy day
    youtubeish = bool(
        re.search(r"\b(youtube|watch later|watch this|video)\b", lower)
    ) or "youtube.com" in lower
    if youtubeish:
        busy_day = proposed_day or _relative_day("today")
        busy = _commitments_on_day(commitments, busy_day) if busy_day else commitments[:3]
        if busy:
            add(
                Intent(
                    type="cross.watch_later",
                    confidence=0.86,
                    target_app="calendar",
                    title="Busy day — watch later?",
                    body="Calendar looks full. Save this video as a reminder instead of now?",
                    payload={
                        "title": "Watch later",
                        "text": text[:200],
                        "dayOfMonth": busy_day or "",
                        "q": "youtube",
                        "fromMemory": True,
                    },
                )
            )
        else:
            add(
                Intent(
                    type="cross.watch_calendar",
                    confidence=0.8,
                    target_app="calendar",
                    title="Block time to watch?",
                    body="Add a short watch block to Calendar, or a Reminders watch-later?",
                    payload={
                        "title": "Watch · " + text.split("\n")[0][:50],
                        "text": text[:200],
                        "dayOfMonth": busy_day or date.today().day,
                        "fromMemory": True,
                    },
                )
            )

    # 8) Gmail / invite language → calendar + conflict awareness
    gmailish = bool(
        re.search(
            r"\b(gmail|invite|rsvp|zoom\.us|meet\.google|calendar\.google|"
            r"you('re| are) invited|join (the )?meeting)\b",
            lower,
        )
    ) or "mail.google.com" in lower
    if gmailish:
        day = proposed_day or date.today().day
        clash = _commitments_on_day(commitments, day)
        if clash:
            add(
                Intent(
                    type="cross.email_invite_clash",
                    confidence=0.9,
                    target_app="calendar",
                    title="Invite clashes with your day",
                    body=f"Day {day} already has: "
                    + ", ".join((c.get("title") or "event") for c in clash[:2])
                    + ". Accept invite time or propose a new one?",
                    payload={
                        "dayOfMonth": day,
                        "title": "Meeting from email",
                        "text": text[:200],
                        "needsTime": True,
                        "fromMemory": True,
                    },
                )
            )
        else:
            add(
                Intent(
                    type="cross.email_invite",
                    confidence=0.84,
                    target_app="calendar",
                    title="Add this invite to Calendar?",
                    body="Looks like a meeting invite — save it to shared Facts + Calendar?",
                    payload={
                        "dayOfMonth": day,
                        "title": "Meeting from email",
                        "text": text[:200],
                        "fromMemory": True,
                    },
                )
            )

    # 9) Expensive trip / flight vs tight budget
    if budget is not None and (
        slots.is_trip
        or re.search(r"\b(flight|hotel|airbnb|book(?:ing)?\.com)\b", lower)
    ):
        price = slots.money[0] if slots.money else None
        if price is not None and price > budget:
            add(
                Intent(
                    type="cross.travel_budget",
                    confidence=0.9,
                    target_app="wallet",
                    title="Trip blows the weekly budget",
                    body=f"${price:g} vs ${budget:g}/week ceiling. Raise budget, or cheaper option?",
                    payload={
                        "ceilingWeeklyUsd": budget,
                        "text": text,
                        "fromMemory": True,
                    },
                )
            )

    # 10) Missing time on any new commitment when user said “book/schedule”
    if (
        booking
        and not has_time
        and not same_day
        and "cross.ask_times" not in seen
        and "cross.same_day_conflict" not in seen
        and re.search(r"\b(book|schedule|appointment|meeting|meet)\b", lower)
    ):
        add(
            Intent(
                type="cross.missing_time",
                confidence=0.78,
                target_app="calendar",
                title="What time works?",
                body="I can save the day — add a clock time so nothing else collides later.",
                payload={
                    "dayOfMonth": proposed_day or "",
                    "title": text[:60],
                    "text": text,
                    "needsTime": True,
                    "fromMemory": True,
                },
            )
        )

    # 11) Shopping / Amazon → list + budget awareness
    shoppingish = bool(
        re.search(
            r"\b(amazon|shopping list|buy this|add to cart|check budget|"
            r"walmart|etsy|ebay)\b",
            lower,
        )
    ) or "amazon." in lower
    if shoppingish:
        price = slots.money[0] if slots.money else None
        if budget is not None and price is not None and price > budget:
            add(
                Intent(
                    type="cross.shopping_budget",
                    confidence=0.9,
                    target_app="wallet",
                    title="Purchase exceeds weekly budget",
                    body=f"${price:g} vs ${budget:g}/week. Save to list, or raise the ceiling?",
                    payload={
                        "q": "shopping",
                        "ceilingWeeklyUsd": budget,
                        "title": text.split("\n")[0][:80],
                        "text": text[:200],
                        "fromMemory": True,
                    },
                )
            )
        else:
            add(
                Intent(
                    type="cross.shopping_list",
                    confidence=0.84,
                    target_app="shop",
                    title="Save to shopping list?",
                    body="Add this product to Reminders and keep an eye on budget / allergens.",
                    payload={
                        "q": "shopping",
                        "title": text.split("\n")[0][:80],
                        "text": text[:200],
                        "fromMemory": True,
                    },
                )
            )

    # 12) Maps / place save
    mapsish = bool(
        re.search(r"\b(save this place|maps\.google|maps\.apple|openstreetmap)\b", lower)
    ) or "place:" in lower
    if mapsish:
        add(
            Intent(
                type="cross.maps_place",
                confidence=0.86,
                target_app="notes",
                title="Save this place?",
                body="Keep the location in Notes and a visit Reminder for later.",
                payload={
                    "q": "maps",
                    "title": text.split("\n")[0][:80].replace("Place: ", ""),
                    "text": text[:200],
                    "fromMemory": True,
                },
            )
        )

    # 13) LinkedIn networking follow-up
    linkedinish = bool(
        re.search(r"\b(linkedin|networking note|schedule a follow-up)\b", lower)
    ) or "linkedin.com" in lower
    if linkedinish:
        day = proposed_day or date.today().day
        add(
            Intent(
                type="cross.linkedin_followup",
                confidence=0.85,
                target_app="calendar",
                title="Schedule a networking follow-up?",
                body="Save a Reminder (and optional Calendar block) so this connection doesn’t drop.",
                payload={
                    "q": "linkedin",
                    "dayOfMonth": day,
                    "title": "LinkedIn follow-up",
                    "text": text[:200],
                    "fromMemory": True,
                },
            )
        )

    # 14) GitHub / PR review later
    githubish = bool(
        re.search(r"\b(github|gitlab|pull request|review this later)\b", lower)
    ) or "github.com" in lower or "gitlab.com" in lower
    if githubish:
        add(
            Intent(
                type="cross.github_review",
                confidence=0.84,
                target_app="notes",
                title="Remind me to review this?",
                body="Park the PR/issue in Reminders for a free block later.",
                payload={
                    "q": "github",
                    "title": text.split("\n")[0][:80],
                    "text": text[:200],
                    "fromMemory": True,
                },
            )
        )

    # 15) Music / focus listen later
    musicish = bool(
        re.search(r"\b(spotify|apple music|listen reminder|save for focus|music:)\b", lower)
    ) or "music.apple.com" in lower or "open.spotify.com" in lower
    if musicish:
        add(
            Intent(
                type="cross.music_save",
                confidence=0.8,
                target_app="notes",
                title="Save for a focus listen?",
                body="Add a listen-later Reminder — useful before deep work.",
                payload={
                    "q": "music",
                    "title": text.split("\n")[0][:80],
                    "text": text[:200],
                    "fromMemory": True,
                },
            )
        )

    # 16) Rideshare vs calendar
    rideish = bool(
        re.search(r"\b(uber|lyft|rideshare|ride conflict)\b", lower)
    ) or "uber.com" in lower or "lyft.com" in lower
    if rideish:
        day = proposed_day or date.today().day
        clash = _commitments_on_day(commitments, day)
        if clash:
            add(
                Intent(
                    type="cross.ride_clash",
                    confidence=0.88,
                    target_app="calendar",
                    title="Ride may collide with a commitment",
                    body="Day already has: "
                    + ", ".join((c.get("title") or "event") for c in clash[:2])
                    + ". Leave earlier, or move the ride?",
                    payload={
                        "q": "rideshare",
                        "dayOfMonth": day,
                        "title": "Ride",
                        "text": text[:200],
                        "fromMemory": True,
                    },
                )
            )
        else:
            add(
                Intent(
                    type="cross.ride_eta",
                    confidence=0.8,
                    target_app="calendar",
                    title="Add ride buffer to Calendar?",
                    body="Save a leave-time Reminder so you don’t cut it close.",
                    payload={
                        "q": "rideshare",
                        "dayOfMonth": day,
                        "title": "Ride",
                        "text": text[:200],
                        "fromMemory": True,
                    },
                )
            )

    # 17) Read-later articles when the day is packed
    readish = bool(
        re.search(r"\b(read later|hacker news|reddit\.com)\b", lower)
    ) or "news.ycombinator.com" in lower or "x.com/" in lower
    if readish:
        busy_day = proposed_day or date.today().day
        busy = _commitments_on_day(commitments, busy_day)
        add(
            Intent(
                type="cross.read_later",
                confidence=0.8,
                target_app="notes",
                title="Save for a free block?",
                body=(
                    "Calendar looks full — park this as read-later."
                    if busy
                    else "Add a read-later Reminder for when you have space."
                ),
                payload={
                    "q": "read-later",
                    "title": text.split("\n")[0][:80],
                    "text": text[:200],
                    "fromMemory": True,
                },
            )
        )

    # 18) Work tracker / deadline focus
    workish = bool(
        re.search(
            r"\b(linear\.app|jira|asana|trello|deadline|focus time|ticket)\b",
            lower,
        )
    )
    if workish:
        day = proposed_day or date.today().day
        add(
            Intent(
                type="cross.work_focus",
                confidence=0.82,
                target_app="calendar",
                title="Block focus time?",
                body="Turn this ticket into a Calendar focus block or a deadline Reminder.",
                payload={
                    "dayOfMonth": day,
                    "title": text.split("\n")[0][:80],
                    "text": text[:200],
                    "needsTime": True,
                    "fromMemory": True,
                },
            )
        )

    return extra
