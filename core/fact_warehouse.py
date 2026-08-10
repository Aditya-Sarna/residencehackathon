"""Personal Fact warehouse — SQLite tables registered in DataHub for Text-to-SQL.

Analytics Agent flow (official pattern):
  ACK search → pick trustworthy warehouse table → generate SQL → execute here.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("residence.warehouse")

TABLES = (
    "budgets",
    "commitments",
    "intents",
    "health_conditions",
    "facts",
)

DDL = """
CREATE TABLE IF NOT EXISTS facts (
  fact_id TEXT PRIMARY KEY,
  glossary_term TEXT,
  value TEXT,
  agent TEXT,
  asserted_at TEXT,
  confidence REAL,
  certification TEXT,
  sensitivity TEXT,
  decision_label TEXT
);
CREATE TABLE IF NOT EXISTS budgets (
  fact_id TEXT PRIMARY KEY,
  ceiling_weekly_usd REAL,
  currency TEXT,
  asserted_at TEXT,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS commitments (
  fact_id TEXT PRIMARY KEY,
  title TEXT,
  day_of_month INTEGER,
  person TEXT,
  city TEXT,
  occasion TEXT,
  asserted_at TEXT,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS intents (
  fact_id TEXT PRIMARY KEY,
  title TEXT,
  price REAL,
  blocked INTEGER,
  ceiling REAL,
  product_id TEXT,
  decision_label TEXT,
  asserted_at TEXT,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS health_conditions (
  fact_id TEXT PRIMARY KEY,
  note TEXT,
  asserted_at TEXT,
  agent TEXT
);
"""


def db_path() -> Path:
    root = Path(os.getenv("RESIDENCE_PERSIST_DIR") or (Path.home() / ".residence"))
    root.mkdir(parents=True, exist_ok=True)
    return root / "facts_warehouse.db"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    conn.executescript(DDL)
    return conn


def _parse(value: str) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return value


def _term_name(urn_or_name: str) -> str:
    s = urn_or_name or ""
    if "glossaryTerm:" in s:
        return s.split("glossaryTerm:")[-1].replace("residence.", "").replace("HealthCondition", "Health Condition")
    return s


def sync_from_broker(broker: Any) -> dict[str, int]:
    """Pull Facts via broker (GMS-backed) into relational warehouse tables."""
    counts = {t: 0 for t in TABLES}
    if broker is None:
        return counts
    conn = connect()
    try:
        conn.execute("DELETE FROM facts")
        conn.execute("DELETE FROM budgets")
        conn.execute("DELETE FROM commitments")
        conn.execute("DELETE FROM intents")
        conn.execute("DELETE FROM health_conditions")

        # Broad pulls per glossary term
        pulls = [
            ("Budget", "Budget"),
            ("Commitment", "Commitment"),
            ("Intent", "Intent"),
            ("Health Condition", "Health Condition"),
        ]
        seen: set[str] = set()
        for q, term in pulls:
            try:
                resp = broker.query_facts(q, "mentor-user", term)
            except Exception as e:
                log.warning("warehouse sync query failed %s: %s", term, e)
                continue
            for row in resp.results or []:
                fact = row.fact
                if fact.factId in seen:
                    continue
                seen.add(fact.factId)
                term_name = _term_name(fact.glossaryTermUrn)
                agent = (fact.assertedByAgentUrn or "").split(":")[-1]
                conn.execute(
                    "INSERT OR REPLACE INTO facts VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        fact.factId,
                        term_name,
                        fact.value,
                        agent,
                        fact.assertedAt,
                        float(fact.confidence or 0),
                        getattr(fact.certificationStatus, "value", str(fact.certificationStatus)),
                        getattr(fact.sensitivityTag, "value", str(fact.sensitivityTag)),
                        fact.decisionLabel or "",
                    ),
                )
                counts["facts"] += 1
                val = _parse(fact.value)
                if term_name.lower().startswith("budget") and isinstance(val, dict):
                    conn.execute(
                        "INSERT OR REPLACE INTO budgets VALUES (?,?,?,?,?)",
                        (
                            fact.factId,
                            float(val.get("ceilingWeeklyUsd") or 0),
                            val.get("currency") or "USD",
                            fact.assertedAt,
                            agent,
                        ),
                    )
                    counts["budgets"] += 1
                elif term_name.lower().startswith("commitment") and isinstance(val, dict):
                    day = val.get("dayOfMonth")
                    try:
                        day_i = int(day) if day is not None else None
                    except Exception:
                        day_i = None
                    conn.execute(
                        "INSERT OR REPLACE INTO commitments VALUES (?,?,?,?,?,?,?,?)",
                        (
                            fact.factId,
                            str(val.get("title") or ""),
                            day_i,
                            val.get("person"),
                            val.get("city"),
                            val.get("occasion"),
                            fact.assertedAt,
                            agent,
                        ),
                    )
                    counts["commitments"] += 1
                elif term_name.lower().startswith("intent") and isinstance(val, dict):
                    conn.execute(
                        "INSERT OR REPLACE INTO intents VALUES (?,?,?,?,?,?,?,?,?)",
                        (
                            fact.factId,
                            str(val.get("title") or ""),
                            float(val["price"]) if val.get("price") is not None else None,
                            1 if val.get("blocked") else 0,
                            float(val["ceiling"]) if val.get("ceiling") is not None else None,
                            val.get("productId"),
                            fact.decisionLabel or "",
                            fact.assertedAt,
                            agent,
                        ),
                    )
                    counts["intents"] += 1
                elif "health" in term_name.lower():
                    note = val.get("note") if isinstance(val, dict) else str(val)
                    conn.execute(
                        "INSERT OR REPLACE INTO health_conditions VALUES (?,?,?,?)",
                        (fact.factId, note or "", fact.assertedAt, agent),
                    )
                    counts["health_conditions"] += 1
        conn.commit()
    finally:
        conn.close()
    return counts


def register_datasets(client: Any) -> list[str]:
    """Register warehouse tables as DataHub datasets (schema + domain) for ACK discovery."""
    if client is None:
        return []
    try:
        from datahub.emitter.mcp import MetadataChangeProposalWrapper
        from datahub.metadata.schema_classes import (
            DatasetPropertiesClass,
            DomainsClass,
            OtherSchemaClass,
            SchemaFieldClass,
            SchemaFieldDataTypeClass,
            SchemaMetadataClass,
            NumberTypeClass,
            StringTypeClass,
            BooleanTypeClass,
            StatusClass,
        )
    except Exception as e:
        log.warning("warehouse register imports failed: %s", e)
        return []

    schemas: dict[str, list[tuple[str, str]]] = {
        "budgets": [
            ("fact_id", "string"),
            ("ceiling_weekly_usd", "number"),
            ("currency", "string"),
            ("asserted_at", "string"),
            ("agent", "string"),
        ],
        "commitments": [
            ("fact_id", "string"),
            ("title", "string"),
            ("day_of_month", "number"),
            ("person", "string"),
            ("city", "string"),
            ("occasion", "string"),
            ("asserted_at", "string"),
            ("agent", "string"),
        ],
        "intents": [
            ("fact_id", "string"),
            ("title", "string"),
            ("price", "number"),
            ("blocked", "boolean"),
            ("ceiling", "number"),
            ("product_id", "string"),
            ("decision_label", "string"),
            ("asserted_at", "string"),
            ("agent", "string"),
        ],
        "health_conditions": [
            ("fact_id", "string"),
            ("note", "string"),
            ("asserted_at", "string"),
            ("agent", "string"),
        ],
        "facts": [
            ("fact_id", "string"),
            ("glossary_term", "string"),
            ("value", "string"),
            ("agent", "string"),
            ("asserted_at", "string"),
            ("confidence", "number"),
            ("certification", "string"),
            ("sensitivity", "string"),
            ("decision_label", "string"),
        ],
    }

    def field_type(kind: str):
        if kind == "number":
            return SchemaFieldDataTypeClass(type=NumberTypeClass())
        if kind == "boolean":
            return SchemaFieldDataTypeClass(type=BooleanTypeClass())
        return SchemaFieldDataTypeClass(type=StringTypeClass())

    urns: list[str] = []
    domain = None
    try:
        domain = client.ensure_domain()
    except Exception:
        pass

    for table, cols in schemas.items():
        urn = f"urn:li:dataset:(urn:li:dataPlatform:residence,warehouse.{table},PROD)"
        fields = [
            SchemaFieldClass(
                fieldPath=name,
                type=field_type(kind),
                nativeDataType=kind,
                description=f"{table}.{name}",
                nullable=True,
            )
            for name, kind in cols
        ]
        mcps = [
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=DatasetPropertiesClass(
                    name=f"warehouse.{table}",
                    description=(
                        f"Residence personal warehouse table `{table}` — "
                        "SQLite mirror of DataHub Facts for Analytics Agent Text-to-SQL."
                    ),
                    customProperties={
                        "residenceEntity": "WarehouseTable",
                        "table": table,
                        "engine": "sqlite",
                        "path": str(db_path()),
                    },
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=StatusClass(removed=False),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=SchemaMetadataClass(
                    schemaName=f"residence.warehouse.{table}",
                    platform="urn:li:dataPlatform:residence",
                    version=0,
                    hash="",
                    platformSchema=OtherSchemaClass(
                        rawSchema=json.dumps({"table": table, "columns": cols})
                    ),
                    fields=fields,
                ),
            ),
        ]
        if domain:
            mcps.append(
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=DomainsClass(domains=[domain]),
                )
            )
        try:
            client._emit(*mcps)
            urns.append(urn)
        except Exception as e:
            log.warning("register %s failed: %s", table, e)
    return urns


_SAFE_SQL = re.compile(
    r"^\s*SELECT\b",
    re.I | re.S,
)
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|PRAGMA|CREATE|REPLACE|VACUUM)\b",
    re.I,
)


def run_sql(sql: str, limit: int = 50) -> dict[str, Any]:
    """Execute read-only SELECT against the personal warehouse."""
    text = (sql or "").strip().rstrip(";")
    if not text or not _SAFE_SQL.match(text) or _FORBIDDEN.search(text):
        return {"ok": False, "error": "only single SELECT statements allowed", "rows": []}
    # soft limit
    if "limit" not in text.lower():
        text = f"{text} LIMIT {int(limit)}"
    conn = connect()
    try:
        cur = conn.execute(text)
        cols = [d[0] for d in cur.description or []]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return {"ok": True, "sql": text, "columns": cols, "rows": rows, "rowCount": len(rows)}
    except Exception as e:
        return {"ok": False, "error": str(e), "sql": text, "rows": []}
    finally:
        conn.close()


def sql_for_question(question: str) -> tuple[str, str]:
    """Deterministic Text-to-SQL templates (LLM optional later)."""
    q = (question or "").lower()
    if re.search(r"\bblocked|pause|over budget|runners?\b", q):
        return (
            "intents",
            "SELECT title, price, ceiling, blocked, decision_label, asserted_at "
            "FROM intents WHERE blocked = 1 ORDER BY asserted_at DESC",
        )
    if re.search(r"\bbudget|ceiling|spend|wallet\b", q):
        return (
            "budgets",
            "SELECT ceiling_weekly_usd, currency, agent, asserted_at "
            "FROM budgets ORDER BY asserted_at DESC",
        )
    if re.search(r"\bcommit|birthday|exam|trip|calendar|tokyo\b", q):
        return (
            "commitments",
            "SELECT title, day_of_month, person, city, occasion, asserted_at "
            "FROM commitments ORDER BY day_of_month IS NULL, day_of_month",
        )
    if re.search(r"\ballerg|health|nickel|peanut\b", q):
        return (
            "health_conditions",
            "SELECT note, agent, asserted_at FROM health_conditions ORDER BY asserted_at DESC",
        )
    if re.search(r"\bavg|average|sum|count|how many\b", q) and "intent" in q:
        return (
            "intents",
            "SELECT COUNT(*) AS intent_count, "
            "SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS blocked_count, "
            "AVG(price) AS avg_price FROM intents",
        )
    return (
        "facts",
        "SELECT glossary_term, COUNT(*) AS n FROM facts GROUP BY glossary_term ORDER BY n DESC",
    )
