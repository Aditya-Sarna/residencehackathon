"""Analytics Agent — official DataHub pattern: discover → Text-to-SQL → answer.

1. Sync personal Facts into the SQLite warehouse + register tables in GMS
2. ACK `search` finds the trustworthy warehouse dataset
3. Generate SQL (templates; optional LLM)
4. Execute SELECT against the warehouse
5. Return rows + lineage context
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import ack_bridge
import fact_warehouse
from explain import explain_latest_block


def _summarize_hits(hits: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    out = []
    for h in hits[:limit]:
        ent = h.get("entity") or h
        urn = ent.get("urn") or ""
        props = ent.get("properties") or {}
        name = (
            props.get("name")
            or props.get("displayName")
            or ent.get("name")
            or ent.get("username")
            or urn.split(":")[-1]
        )
        out.append(
            {
                "urn": urn,
                "type": ent.get("type"),
                "name": name,
                "description": (props.get("description") or "")[:200],
            }
        )
    return out


def ask(
    question: str,
    broker: Any = None,
    *,
    use_llm: bool = False,
) -> dict[str, Any]:
    q = (question or "").strip()
    if not q:
        return {"ok": False, "error": "empty question", "skills": []}

    skills: list[str] = ["datahub-search", "datahub-setup"]
    steps: list[dict[str, str]] = []
    lower = q.lower()

    # Sync warehouse from live Facts + publish schemas to GMS
    sync_counts: dict[str, int] = {}
    registered: list[str] = []
    if broker is not None:
        sync_counts = fact_warehouse.sync_from_broker(broker)
        steps.append(
            {
                "id": "sync",
                "title": "Warehouse sync",
                "detail": ", ".join(f"{k}={v}" for k, v in sync_counts.items() if v),
            }
        )
        try:
            registered = fact_warehouse.register_datasets(broker.client)
            if registered:
                skills.append("datahub-enrich")
                steps.append(
                    {
                        "id": "register",
                        "title": "ACK catalog publish",
                        "detail": f"{len(registered)} warehouse.* datasets in GMS",
                    }
                )
        except Exception:
            pass

    # Why-blocked → SQL on intents + lineage explain
    if re.search(r"\b(why|blocked|pause[d]?|over budget)\b", lower):
        table, sql = fact_warehouse.sql_for_question(q)
        skills.append("datahub-quality")
        # ACK discover the warehouse table first (Analytics Agent step 1)
        search = ack_bridge.ack_search(f"warehouse {table}", num_results=5)
        entities = _summarize_hits(search.get("searchResults") or [])
        steps.append(
            {
                "id": "discover",
                "title": "ACK search · warehouse table",
                "detail": f"warehouse.{table} · hits={search.get('total', 0)}",
            }
        )
        sql_out = fact_warehouse.run_sql(sql)
        skills.append("datahub-search")
        steps.append(
            {
                "id": "sql",
                "title": "Text-to-SQL execute",
                "detail": sql_out.get("sql") or sql,
            }
        )
        why = explain_latest_block(broker) if broker is not None else {"ok": False}
        if why.get("decisionFactId"):
            urn = (
                f"urn:li:dataset:(urn:li:dataPlatform:residence,"
                f"fact.{why['decisionFactId']},PROD)"
            )
            lin = ack_bridge.ack_get_lineage(urn, upstream=True, max_hops=2)
            skills.append("datahub-lineage")
            steps.append({"id": "lineage", "title": "ACK get_lineage", "detail": urn[-40:]})
        else:
            lin = None

        row_bit = ""
        if sql_out.get("ok") and sql_out.get("rows"):
            r0 = sql_out["rows"][0]
            row_bit = (
                f" SQL on `warehouse.{table}` returned "
                f"{sql_out.get('rowCount')} row(s); top: {json.dumps(r0)[:160]}."
            )
        answer = (why.get("because") or why.get("headline") or "No blocked purchase.") + row_bit
        answer += (
            " Pattern: Agent Context Kit search → Text-to-SQL on Residence warehouse → lineage."
        )
        return {
            "ok": bool(why.get("ok") or sql_out.get("ok")),
            "agent": "analytics-agent",
            "via": "agent-context-kit+text-to-sql",
            "question": q,
            "headline": why.get("headline") or f"Analytics Agent · {table}",
            "answer": answer,
            "skills": list(dict.fromkeys(skills)),
            "steps": steps,
            "entities": entities,
            "sql": sql_out,
            "warehouse": {"table": table, "sync": sync_counts, "registered": registered},
            "ackLineage": lin,
            "evidence": why,
        }

    # General Text-to-SQL path
    table, sql = fact_warehouse.sql_for_question(q)
    if use_llm:
        llm_sql = _llm_sql(q, table)
        if llm_sql:
            sql = llm_sql
            steps.append({"id": "llm-sql", "title": "LLM SQL draft", "detail": sql[:120]})

    search_q = f"warehouse {table}"
    search = ack_bridge.ack_search(search_q, num_results=5)
    entities = _summarize_hits(search.get("searchResults") or [])
    # Prefer the exact warehouse URN even if search is cold
    wh_urn = f"urn:li:dataset:(urn:li:dataPlatform:residence,warehouse.{table},PROD)"
    if not any(e.get("urn") == wh_urn for e in entities):
        entities.insert(
            0,
            {
                "urn": wh_urn,
                "type": "DATASET",
                "name": f"warehouse.{table}",
                "description": "Residence personal warehouse (SQLite)",
            },
        )
    steps.append(
        {
            "id": "discover",
            "title": "ACK search · trustworthy table",
            "detail": f"{search_q} · GMS hits={search.get('total', 0)}",
        }
    )

    # Schema via get_entities (ACK)
    ent_detail = ack_bridge.ack_get_entities([wh_urn])
    if ent_detail.get("ok"):
        skills.append("datahub-enrich")
        steps.append(
            {"id": "schema", "title": "ACK get_entities · schema", "detail": wh_urn[-48:]}
        )

    sql_out = fact_warehouse.run_sql(sql)
    steps.append(
        {
            "id": "sql",
            "title": "Text-to-SQL execute",
            "detail": (sql_out.get("sql") or sql)[:160],
        }
    )

    if not sql_out.get("ok"):
        answer = f"SQL failed on warehouse.{table}: {sql_out.get('error')}"
        ok = False
    elif not sql_out.get("rows"):
        answer = (
            f"Discovered `warehouse.{table}` via Agent Context Kit, ran "
            f"`{sql_out.get('sql')}`, but the warehouse is empty — run the judge demo to seed Facts."
        )
        ok = False
    else:
        preview = sql_out["rows"][:3]
        answer = (
            f"Analytics Agent: ACK found `warehouse.{table}`, generated SQL, executed on the "
            f"personal Fact warehouse → {sql_out['rowCount']} row(s). "
            f"Preview: {json.dumps(preview)[:280]}"
        )
        ok = True
        if use_llm:
            polished = _llm_polish(q, answer, preview)
            if polished:
                answer = polished

    return {
        "ok": ok,
        "agent": "analytics-agent",
        "via": "agent-context-kit+text-to-sql",
        "question": q,
        "headline": f"Analytics Agent · Text-to-SQL · {table}",
        "answer": answer,
        "skills": list(dict.fromkeys(skills)),
        "steps": steps,
        "entities": entities,
        "sql": sql_out,
        "warehouse": {"table": table, "sync": sync_counts, "registered": registered},
        "ackSearch": {"total": search.get("total"), "ok": search.get("ok"), "query": search_q},
        "ackEntities": ent_detail,
    }


def _llm_sql(question: str, table: str) -> Optional[str]:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        prompt = (
            f"Write one SQLite SELECT for table `{table}` answering: {question}\n"
            "Only output SQL, no markdown. Read-only SELECT."
        )
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 120,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=12.0,
        )
        if r.status_code >= 400:
            return None
        blocks = r.json().get("content") or []
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
        text = text.strip("`").replace("sql\n", "").strip()
        if text.upper().startswith("SELECT"):
            return text
    except Exception:
        return None
    return None


def _llm_polish(question: str, draft: str, rows: list[dict[str, Any]]) -> Optional[str]:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        prompt = (
            "You are DataHub Analytics Agent. 2 short sentences. Cite SQL result numbers.\n"
            f"Q: {question}\nDraft: {draft}\nRows: {json.dumps(rows)[:400]}"
        )
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 160,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=12.0,
        )
        if r.status_code >= 400:
            return None
        blocks = r.json().get("content") or []
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip() or None
    except Exception:
        return None
