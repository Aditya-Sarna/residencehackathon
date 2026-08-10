"""Offline contract: every smart-memory scenario fires an expected memory/cross intent."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from inference import extract_slots
from memory_inference import MemoryBundle, memory_augment

SCENARIOS = [
    ("same_day", "Book lunch with Alex on the 15th", ["cross.same_day_conflict"]),
    ("ask_times", "Book dentist and lunch with Sam both on the 15th", ["cross.ask_times"]),
    ("trip_clash", "Schedule a dentist appointment on the 22nd", ["cross.trip_clash"]),
    ("priority", "Birthday dinner party on exam day", ["cross.priority_clash"]),
    (
        "youtube",
        "Watch this youtube video https://youtube.com/watch?v=dQw4w9WgXcQ later today",
        ["cross.watch_later", "cross.watch_calendar"],
    ),
    (
        "gmail",
        "You're invited to a Zoom meeting on the 15th — RSVP via Gmail",
        ["cross.email_invite_clash"],
    ),
    ("contradiction", "I'm not allergic to nickel anymore", ["memory.contradiction"]),
    ("budget_guard", "I want to buy Everyday Runners for $95", ["memory.budget_guard"]),
    ("allergy_shop", "thinking of buying a nickel watch chain", ["memory.allergy_guard"]),
    ("gift_memory", "I should get Sam a present", ["memory.gift_from_calendar"]),
    ("meal_allergy", "Book sushi dinner with peanuts sauce tonight", ["cross.meal_allergy"]),
    (
        "shopping_list",
        "Shopping: Noise headphones\nhttps://amazon.com/dp/abc\nCheck budget before buying?",
        ["cross.shopping_list", "cross.shopping_budget"],
    ),
    (
        "maps_place",
        "Place: Blue Bottle Coffee\nhttps://maps.google.com/?q=blue\nSave this place for later?",
        ["cross.maps_place"],
    ),
    (
        "linkedin",
        "LinkedIn: Message from Jordan\nhttps://linkedin.com/in/jordan\nSchedule a follow-up?",
        ["cross.linkedin_followup"],
    ),
    (
        "github",
        "Code thread: Fix auth #42\nhttps://github.com/org/repo/pull/42\nRemind me to review this later?",
        ["cross.github_review"],
    ),
    (
        "ride",
        "Ride: Uber to downtown on the 15th\nDoes this ride conflict?",
        ["cross.ride_clash", "cross.ride_eta"],
    ),
    (
        "read_later",
        "Read later: Why context graphs win\nhttps://news.ycombinator.com/item?id=1",
        ["cross.read_later"],
    ),
    (
        "work_focus",
        "Task: RES-12 ship HUD\nhttps://linear.app/team/issue/RES-12\nBlock focus time?",
        ["cross.work_focus"],
    ),
    ("trip_prep", "Tokyo packing list before the trip", ["memory.trip_prep"]),
    ("exam_focus", "I'm nervous about Exam prep", ["memory.exam_focus", "memory.stress_checkin"]),
    ("open_commitment", "Remind me about Sam", ["memory.open_commitment"]),
    (
        "music",
        "Music: Deep Focus by Lo-Fi\nSave for focus later or add a listen reminder?",
        ["cross.music_save"],
    ),
]


def test_all_smart_memory_scenarios_hit():
    mem = MemoryBundle(
        budget=40,
        health_notes=[
            "allergic to nickel — avoid jewelry with nickel",
            "allergic to peanuts — check restaurant menus",
        ],
        note_strings=["allergic to nickel", "budget $40/week", "Sam birthday"],
        commitments=[
            {"title": "Sam birthday", "dayOfMonth": 15, "person": "Sam", "city": None},
            {"title": "Exam", "dayOfMonth": date.today().day, "person": None, "city": None},
            {"title": "Tokyo trip", "dayOfMonth": 22, "person": None, "city": "Tokyo"},
        ],
    )
    missing = []
    for sid, text, expect in SCENARIOS:
        types = {i.type for i in memory_augment(text, extract_slots(text), [], mem)}
        if not any(e in types for e in expect):
            missing.append(sid)
    assert not missing, f"scenarios missed expected intents: {missing}"
    assert len(SCENARIOS) >= 20
