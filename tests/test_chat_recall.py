"""Chat recall — index Claude/GPT snippets and find them from captions/queries."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "core"))

import chat_recall  # noqa: E402
from desktop_bridge import find_contradictions  # noqa: E402


class _Fact:
    def __init__(self, fact_id: str, value: str):
        self.factId = fact_id
        self.value = value
        self.assertedAt = "2026-08-10T00:00:00Z"


class _Row:
    def __init__(self, fact: _Fact, stale: bool = False):
        self.fact = fact
        self.stale = stale


class _Resp:
    def __init__(self, results):
        self.results = results


class FakeBroker:
    def __init__(self):
        self.stored: list[dict] = []

    def assert_fact(self, payload, agent_id, confidence=0.9, decision_label=None, **kwargs):
        self.stored.append(payload)
        fid = f"fact-{len(self.stored)}"
        return _Fact(fid, payload["value"])

    def query_facts(self, query, agent_id, glossary_term=None):
        rows = []
        for i, p in enumerate(self.stored):
            val = json.loads(p["value"])
            blob = json.dumps(val).lower()
            if "conversation" in blob or (query and query.lower() in blob):
                rows.append(_Row(_Fact(f"fact-{i+1}", p["value"])))
        return _Resp(rows)


def test_purchase_and_event_still_orthogonal():
    hits = find_contradictions(
        "Buy Everyday Runners for $95 — add to cart",
        ["Lunch with Alex on Friday"],
    )
    assert hits == []


def test_index_and_search_finds_claude_buy_chat():
    broker = FakeBroker()
    chat_recall.index_conversation(
        broker,
        utterance="Claude: looking at Everyday Runners shoes for $95 — should I buy?",
        source="claude-desktop",
        operation_id="op-buy",
    )
    hits = chat_recall.search_conversations(broker, "runners shoes purchase $95", limit=5)
    assert hits
    assert "runners" in hits[0]["excerpt"].lower() or "shoes" in hits[0]["excerpt"].lower()


def test_unrelated_event_does_not_match_buy_query_strongly():
    broker = FakeBroker()
    chat_recall.index_conversation(
        broker,
        utterance="Claude: schedule lunch with Alex on Friday at noon",
        source="claude-desktop",
    )
    hits = chat_recall.search_conversations(broker, "Everyday Runners shoes cart checkout", limit=5)
    # May be empty or low-score; must not pretend it's a shoe purchase chat
    for h in hits:
        assert "runners" not in h["excerpt"].lower()


def test_summarize_related_empty():
    text = chat_recall.summarize_related("drink photo", [])
    assert "No related" in text


def test_summarize_related_with_hits():
    digest = chat_recall.summarize_related(
        "wardrobe",
        [
            {
                "source": "claude-desktop",
                "excerpt": "Wear the navy velvet blazer for the backstage shoot",
            }
        ],
        caption="woman in velvet blazer drinking water",
    )
    assert "velvet" in digest.lower() or "blazer" in digest.lower()
    assert "claude" in digest.lower()


def test_seed_demo_conversation():
    broker = FakeBroker()
    fact = chat_recall.seed_demo_conversation(broker)
    assert fact is not None
    hits = chat_recall.search_conversations(
        broker, "backstage vanity blazer drink water wardrobe", limit=3
    )
    assert hits


def test_is_recall_ask():
    assert chat_recall.is_recall_ask("what did we discuss about the wardrobe shoot?")
    assert not chat_recall.is_recall_ask("buy shoes tomorrow")


def test_is_chat_source():
    assert chat_recall.is_chat_source("claude-desktop")
    assert chat_recall.is_chat_source("ai-chat")
    assert not chat_recall.is_chat_source("apple-notes")
