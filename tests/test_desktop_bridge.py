import desktop_bridge
from desktop_bridge import (
    find_contradictions,
    list_activity,
    list_pending,
    push_permission,
    redact_resolved,
    register_capture,
    resolve,
)


def test_allergy_flip_detected():
    hits = find_contradictions(
        "I'm not allergic to peanuts anymore",
        ["allergic to peanuts — avoid"],
    )
    assert hits and hits[0]["kind"] == "allergy_flip"


def test_budget_conflict():
    hits = find_contradictions(
        "new weekly budget is $25",
        ['{"ceilingWeeklyUsd": 40, "note": "budget $40/week"}'],
    )
    assert any(h["kind"] == "budget_conflict" for h in hits)


def test_purchase_and_event_not_contradiction():
    """Orthogonal Facts — a buy and a calendar event must not conflict."""
    hits = find_contradictions(
        "Buy Everyday Runners for $95 — add to cart",
        ["Lunch with Alex on Friday", "Team standup next week"],
    )
    assert hits == []


def test_purchase_price_vs_budget_note_not_false_conflict():
    """A product price is not a budget rewrite unless budget language is explicit."""
    hits = find_contradictions(
        "Purchase these shoes for $95 only",
        ["budget $40/week"],
    )
    assert not any(h["kind"] == "budget_conflict" for h in hits)


def test_note_revision_still_works_same_domain():
    hits = find_contradictions(
        "Correction: not going to the dentist appointment anymore",
        ["dentist appointment on Friday"],
    )
    assert any(h["kind"] == "note_revision" for h in hits)


def test_pending_resolve(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    desktop_bridge._pending = []
    desktop_bridge._captures = {}
    desktop_bridge._activity = []
    desktop_bridge._loaded = False
    row = push_permission({"title": "Add?", "body": "x", "actionApp": "calendar"})
    assert row["id"] in {p["id"] for p in list_pending()}
    assert resolve(row["id"], True)["status"] == "accepted"
    assert row["id"] not in {p["id"] for p in list_pending()}


def test_capture_idempotency_and_activity(tmp_path, monkeypatch):
    monkeypatch.setenv("RESIDENCE_PERSIST_DIR", str(tmp_path))
    desktop_bridge._pending = []
    desktop_bridge._captures = {}
    desktop_bridge._activity = []
    desktop_bridge._loaded = False
    assert register_capture("op-1", "apple-notes", "selection", "hello", "hash") is True
    assert register_capture("op-1", "apple-notes", "selection", "hello", "hash") is False
    item = push_permission(
        {"operationId": "op-1", "title": "Add?", "body": "x", "actionApp": "calendar"}
    )
    # Replayed delivery resolves to the exact same pending decision
    assert (
        push_permission(
            {"operationId": "op-1", "title": "Add?", "body": "x", "actionApp": "calendar"}
        )["id"]
        == item["id"]
    )
    assert resolve(item["id"], True)["status"] == "accepted"
    assert resolve(item["id"], True)["status"] == "accepted"
    redact_resolved(item["id"])
    stored = next(p for p in desktop_bridge._pending if p["id"] == item["id"])
    assert "utterance" not in stored and "payload" not in stored
    assert {e["event"] for e in list_activity()} >= {"captured", "decision_queued", "decision_resolved"}
