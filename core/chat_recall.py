"""Cross-inference: index Claude/GPT captures and recall related chats by text/image caption."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional

log = logging.getLogger("residence.chat_recall")

CHAT_SOURCES = frozenset(
    {
        "claude-desktop",
        "ai-chat",
        "claude-mcp",
        "chatgpt",
        "claude",
        "openai",
        "claude-wrapper",
        "chatgpt-wrapper",
    }
)

_STOP = frozenset(
    """
    a an the and or but for with from that this these those into onto about
    have has had were was are is been being will would could should can may
    your you me my we our they them their what when where which who how why
    just like also into over under again more most some any all not
    """.split()
)

_RECALL_ASK = re.compile(
    r"(?i)\b("
    r"what did (?:we|i) (?:talk|discuss|say|chat)|"
    r"related chats?|from (?:claude|chatgpt|gpt|openai)|"
    r"remind me what .+ (?:said|discussed|talked)|"
    r"conversation(?:s)? (?:about|on|with)|"
    r"summar(?:y|ise|ize).*(?:claude|gpt|chat)"
    r")\b"
)


def is_chat_source(source: Optional[str]) -> bool:
    s = (source or "").strip().lower()
    if s in CHAT_SOURCES:
        return True
    return any(k in s for k in ("claude", "chatgpt", "openai", "gpt"))


def is_recall_ask(text: str) -> bool:
    return bool(_RECALL_ASK.search(text or ""))


def extract_topics(text: str, limit: int = 12) -> list[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", (text or "").lower())
    out: list[str] = []
    seen: set[str] = set()
    for w in words:
        if w in _STOP or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= limit:
            break
    return out


def index_conversation(
    broker: Any,
    *,
    utterance: str,
    source: str,
    operation_id: Optional[str] = None,
    provenance: Optional[dict[str, Any]] = None,
) -> Optional[Any]:
    """Persist a searchable Intent Fact for a Claude/GPT capture."""
    text = (utterance or "").strip()
    if not text or not is_chat_source(source):
        return None
    topics = extract_topics(text)
    value = {
        "q": "conversation",
        "intent": "conversation_snippet",
        "source": source,
        "excerpt": text[:1200],
        "topics": topics,
        "title": text[:80],
        "capturedAt": time.time(),
        "operationId": operation_id,
    }
    try:
        return broker.assert_fact(
            {
                "value": json.dumps(value),
                "glossary_term": "Intent",
                "certificationStatus": "user_confirmed",
                "confidence": 0.95,
                "provenance": provenance or {"source": source},
            },
            agent_id="shopping-agent",
            confidence=0.95,
            decision_label="desktop-index-conversation",
        )
    except Exception as e:
        log.warning("index_conversation failed: %s", e)
        return None


def _parse_fact_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return raw


def _load_conversation_facts(broker: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not broker:
        return rows
    for agent in ("mentor-user", "shopping-agent", "claude-wrapper"):
        try:
            resp = broker.query_facts("conversation", agent, "Intent")
        except Exception:
            continue
        for r in getattr(resp, "results", []) or []:
            if getattr(r, "stale", False):
                continue
            val = _parse_fact_value(r.fact.value)
            if not isinstance(val, dict):
                continue
            if val.get("q") != "conversation" and val.get("intent") != "conversation_snippet":
                # Still keep Intent facts that look like chat excerpts from chat sources
                src = str(val.get("source") or "")
                if not is_chat_source(src):
                    continue
            rows.append(
                {
                    "factId": getattr(r.fact, "factId", None),
                    "source": val.get("source") or "claude",
                    "excerpt": str(val.get("excerpt") or val.get("title") or val.get("note") or "")[
                        :1200
                    ],
                    "topics": list(val.get("topics") or extract_topics(str(val.get("excerpt") or ""))),
                    "capturedAt": val.get("capturedAt") or getattr(r.fact, "assertedAt", None),
                    "title": str(val.get("title") or "")[:80],
                }
            )
    return rows


def _load_activity_fallback() -> list[dict[str, Any]]:
    try:
        import desktop_bridge

        rows = []
        for ev in desktop_bridge.list_activity(limit=200):
            if ev.get("event") != "captured":
                continue
            src = str(ev.get("source") or "")
            if not is_chat_source(src):
                continue
            preview = str(ev.get("preview") or "").strip()
            if not preview:
                continue
            rows.append(
                {
                    "factId": None,
                    "source": src,
                    "excerpt": preview,
                    "topics": extract_topics(preview),
                    "capturedAt": ev.get("at") or ev.get("ts"),
                    "title": preview[:80],
                    "fromActivity": True,
                }
            )
        return rows
    except Exception as e:
        log.debug("activity fallback failed: %s", e)
        return []


def _score(query_topics: list[str], query_lower: str, row: dict[str, Any]) -> float:
    if not query_lower and not query_topics:
        return 0.0
    excerpt = (row.get("excerpt") or "").lower()
    topics = {t.lower() for t in (row.get("topics") or [])}
    score = 0.0
    for t in query_topics:
        if t in topics:
            score += 2.0
        if t in excerpt:
            score += 1.0
    # Phrase overlap for longer queries
    q_words = [w for w in re.findall(r"[a-z]{4,}", query_lower) if w not in _STOP]
    if q_words:
        hits = sum(1 for w in q_words if w in excerpt)
        score += hits * 0.5
    return score


def search_conversations(
    broker: Any, query: str, *, limit: int = 6
) -> list[dict[str, Any]]:
    q = (query or "").strip()
    topics = extract_topics(q)
    corpus = _load_conversation_facts(broker) + _load_activity_fallback()
    # Dedupe by excerpt prefix
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for row in corpus:
        key = (row.get("excerpt") or "")[:160]
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(row)

    scored: list[tuple[float, dict[str, Any]]] = []
    ql = q.lower()
    for row in uniq:
        s = _score(topics, ql, row)
        if s > 0:
            scored.append((s, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for s, row in scored[: max(1, min(limit, 12))]:
        out.append({**row, "score": round(s, 2)})
    return out


def summarize_related(
    query: str,
    hits: list[dict[str, Any]],
    *,
    caption: Optional[str] = None,
    use_llm: bool = False,
) -> str:
    """Build a short digest of related chats (extractive; optional LLM polish)."""
    if not hits:
        cue = caption or query or "this"
        return (
            f"No related Claude/GPT chats found for “{str(cue)[:80]}”. "
            "Capture more conversations from Claude or ChatGPT, Accept them, then retry."
        )

    lines = [
        f"Related chats for “{(caption or query or 'your capture')[:80]}”:",
    ]
    for i, h in enumerate(hits[:4], 1):
        src = h.get("source") or "chat"
        excerpt = re.sub(r"\s+", " ", str(h.get("excerpt") or "")).strip()
        if len(excerpt) > 160:
            excerpt = excerpt[:157] + "…"
        lines.append(f"{i}. [{src}] {excerpt}")

    digest = "\n".join(lines)
    if not use_llm:
        return digest

    try:
        import claude_bridge

        prompt = (
            "Summarize these prior AI chats the user had, in 2-4 short bullets. "
            "Say which app (Claude/ChatGPT) when known. No preamble.\n\n"
            f"Query: {caption or query}\n\n{digest}"
        )
        out = claude_bridge.chat(prompt, [])
        if out.get("ok") and out.get("reply"):
            return out["reply"].strip()
    except Exception as e:
        log.debug("summarize llm skipped: %s", e)
    return digest


def seed_demo_conversation(broker: Any) -> Optional[Any]:
    """Seed a wardrobe/backstage chat so drink image recall demos cleanly."""
    text = (
        "Claude chat: For the backstage shoot, wear the navy velvet blazer over a white shirt, "
        "keep hydration with water between takes, vanity lighting is fine — wardrobe and drink "
        "ready for the dressing-room photo."
    )
    return index_conversation(
        broker,
        utterance=text,
        source="claude-desktop",
        operation_id="seed-drink-recall",
        provenance={"source": "seed", "demo": "drink_recall"},
    )
