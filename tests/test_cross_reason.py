from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from cross_reason import cross_reason
from inference import extract_slots
from memory_inference import MemoryBundle


def _mem(**kwargs):
    return MemoryBundle(
        budget=kwargs.get("budget", 40),
        health_notes=kwargs.get("health_notes", []),
        commitments=kwargs.get(
            "commitments",
            [
                {"title": "Sam birthday", "dayOfMonth": 15, "person": "Sam"},
                {"title": "Exam", "dayOfMonth": 15, "person": None},
                {"title": "Tokyo trip", "dayOfMonth": 22, "city": "Tokyo"},
            ],
        ),
        note_strings=[],
    )


def test_same_day_asks_for_time():
    text = "Book lunch with Alex on the 15th"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    types = {i.type for i in out}
    assert "cross.same_day_conflict" in types
    assert any(i.payload.get("needsTime") for i in out)


def test_two_bookings_ask_times():
    text = "Book dentist and lunch with Sam both on the 15th"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.ask_times" for i in out)


def test_trip_clash():
    text = "Schedule a dentist appointment on the 22nd"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.trip_clash" for i in out)


def test_youtube_watch_later():
    text = "Watch this youtube video https://youtube.com/watch?v=abc later today"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type.startswith("cross.watch") for i in out)


def test_gmail_invite_clash():
    text = "You're invited to a Zoom meeting on the 15th — RSVP via Gmail"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.email_invite_clash" for i in out)


def test_exam_day_social_priority():
    text = "Birthday dinner party on exam day"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.priority_clash" for i in out)


def test_shopping_list():
    text = "Shopping: Noise-cancelling headphones\nhttps://amazon.com/dp/abc\nCheck budget / allergy before buying?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem(budget=40))
    assert any(i.type == "cross.shopping_list" for i in out)


def test_shopping_budget():
    text = "Buy this on amazon for $120 — check budget"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem(budget=40))
    assert any(i.type == "cross.shopping_budget" for i in out)


def test_maps_place():
    text = "Place: Blue Bottle Coffee\nhttps://maps.google.com/?q=blue+bottle\nSave this place for later?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.maps_place" for i in out)


def test_linkedin_followup():
    text = "LinkedIn: Message from Jordan\nhttps://linkedin.com/in/jordan\nSchedule a follow-up?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.linkedin_followup" for i in out)


def test_github_review():
    text = "Code thread: Fix auth race #42\nhttps://github.com/org/repo/pull/42\nRemind me to review this later?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.github_review" for i in out)


def test_music_save():
    text = "Music: Deep Focus by Lo-Fi\nSave for focus later or add a listen reminder?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.music_save" for i in out)


def test_ride_clash():
    text = "Ride: Uber to downtown on the 15th\nDoes this ride conflict with a Calendar commitment?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.ride_clash" for i in out)


def test_read_later():
    text = "Read later: Why context graphs win\nhttps://news.ycombinator.com/item?id=1"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.read_later" for i in out)


def test_work_focus():
    text = "Task: RES-12 ship desktop HUD\nhttps://linear.app/team/issue/RES-12\nBlock focus time?"
    slots = extract_slots(text)
    out = cross_reason(text, slots, [], _mem())
    assert any(i.type == "cross.work_focus" for i in out)
