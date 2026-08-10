"""Saved-memory prompts — contradictions, gifts, budget, allergy, events."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from inference import InferenceEngine, extract_slots
from memory_inference import MemoryBundle, allergens_from_notes, memory_augment, product_hits_allergen


def _mem(**kwargs):
    return MemoryBundle(
        budget=kwargs.get("budget", 40),
        health_notes=kwargs.get(
            "health_notes",
            ["allergic to nickel", "allergic to peanuts — check menus"],
        ),
        note_strings=kwargs.get(
            "note_strings",
            ["allergic to nickel", "budget $40/week", "Sam birthday"],
        ),
        commitments=kwargs.get(
            "commitments",
            [
                {"title": "Sam birthday", "dayOfMonth": 15, "person": "Sam", "city": None},
                {"title": "Exam", "dayOfMonth": 9, "person": None, "city": None},
                {"title": "Tokyo trip", "dayOfMonth": 22, "person": None, "city": "Tokyo"},
            ],
        ),
    )


def test_allergens_and_safe_products():
    assert "nickel" in allergens_from_notes(["allergic to nickel — avoid jewelry"])
    assert "peanut" in allergens_from_notes(["allergic to peanut"])
    assert product_hits_allergen("nickel chain bracelet", "nickel")
    assert not product_hits_allergen("nickel-free watch", "nickel")


def test_contradiction_and_gift_from_memory():
    mem = _mem()
    slots = extract_slots("I'm not allergic to nickel anymore")
    out = memory_augment("I'm not allergic to nickel anymore", slots, [], mem)
    assert any(i.type == "memory.contradiction" for i in out)

    slots2 = extract_slots("I should get Sam a present")
    out2 = memory_augment("I should get Sam a present", slots2, [], mem)
    assert any(i.type == "memory.gift_from_calendar" for i in out2)

    slots3 = extract_slots("I want to buy shoes for $95")
    out3 = memory_augment("I want to buy shoes for $95", slots3, [], mem)
    assert any(i.type == "memory.budget_guard" for i in out3)


def test_allergy_guard_and_trip_prep():
    mem = _mem()
    slots = extract_slots("thinking of buying a nickel watch chain")
    out = memory_augment("thinking of buying a nickel watch chain", slots, [], mem)
    assert any(i.type == "memory.allergy_guard" for i in out)

    slots2 = extract_slots("Tokyo packing list before the trip")
    out2 = memory_augment("Tokyo packing list before the trip", slots2, [], mem)
    trip = next(i for i in out2 if i.type == "memory.trip_prep")
    assert "Tokyo" in trip.title
    assert any("peanut" in str(x) for x in (trip.payload.get("checklist") or []))


def test_exam_focus_stress_and_open_commitment():
    mem = _mem()
    text = "I'm nervous about Exam prep"
    out = memory_augment(text, extract_slots(text), [], mem)
    types = {i.type for i in out}
    assert "memory.exam_focus" in types
    assert "memory.stress_checkin" in types

    text2 = "Remind me about Sam"
    out2 = memory_augment(text2, extract_slots(text2), [], mem)
    assert any(i.type == "memory.open_commitment" for i in out2)

    # Noisy person mention without follow-through should not open commitment
    text3 = "Sam said hello"
    out3 = memory_augment(text3, extract_slots(text3), [], mem)
    assert not any(i.type == "memory.open_commitment" for i in out3)


def test_engine_without_broker_still_works():
    eng = InferenceEngine(broker=None)
    out = eng.infer(
        "Interview with Priya on the 20th",
        source_app="voice",
        persist=False,
        use_llm=False,
    )
    assert out["ok"]
    assert "calendar" in {n["actionApp"] for n in out["notifications"]}
