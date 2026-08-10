"""Full Fact graph export — the DataHub graph Residence writes, render-ready."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from models import GLOSSARY_TERMS, CertificationStatus, Fact, fact_urn

log = logging.getLogger("residence.graph")

# Agents shipped by seed.py — displayed even if a fact set is empty
KNOWN_AGENTS = [
    "mentor-user",
    "calendar-health-agent",
    "finance-agent",
    "shopping-agent",
]

try:  # UpstreamLineage aspect for edge reads
    from datahub.metadata.schema_classes import UpstreamLineageClass
except Exception:  # pragma: no cover
    UpstreamLineageClass = None  # type: ignore


def _short_label(fact: Fact) -> str:
    """Human label from value / decisionLabel."""
    if fact.decisionLabel:
        return fact.decisionLabel[:38]
    try:
        v = json.loads(fact.value)
        if isinstance(v, dict):
            for key in ("title", "note", "ceilingWeeklyUsd", "intent", "q", "productId"):
                if v.get(key) not in (None, ""):
                    val = v[key]
                    if key == "ceilingWeeklyUsd":
                        return f"${float(val):g}/week"
                    return str(val)[:38]
    except Exception:
        pass
    return str(fact.value)[:38]


def _fact_id_from_urn(urn: str) -> str | None:
    if "fact." not in urn:
        return None
    return urn.split("fact.")[-1].split(",")[0]


def build_graph(broker: Any) -> dict[str, Any]:
    client = broker.client
    facts: list[Fact] = client.search_facts("")
    fact_ids = {f.factId for f in facts}

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    edge_keys: set[str] = set()
    sens_counts: dict[str, int] = {}

    def add_edge(kind: str, subtype: str, src: str, dst: str) -> None:
        key = f"{kind}:{src}->{dst}"
        if key in edge_keys or src == dst:
            return
        edge_keys.add(key)
        edges.append({"id": key, "type": kind, "subtype": subtype, "source": src, "target": dst})

    # Glossary term nodes
    for name, urn in GLOSSARY_TERMS.items():
        nodes.append(
            {
                "id": f"term:{name}",
                "urn": urn,
                "kind": "glossaryTerm",
                "label": name,
            }
        )

    # Agent nodes with live scopes
    for agent_id in KNOWN_AGENTS:
        try:
            a = client.get_agent(agent_id)
        except Exception:
            a = None
        if not a:
            continue
        nodes.append(
            {
                "id": f"agent:{a.agentId}",
                "urn": a.urn,
                "kind": "agent",
                "label": a.displayName or a.agentId,
                "readScopes": [
                    s.value if hasattr(s, "value") else str(s) for s in a.readScopes
                ],
                "writeScopes": list(a.writeScopes),
            }
        )

    term_by_urn = {urn: name for name, urn in GLOSSARY_TERMS.items()}

    # Fact nodes + classification/ownership edges
    for f in facts:
        stale = False
        try:
            stale = bool(broker.is_stale(f))
        except Exception:
            pass
        sens = f.sensitivityTag.value if hasattr(f.sensitivityTag, "value") else str(
            f.sensitivityTag
        )
        sens_counts[sens] = sens_counts.get(sens, 0) + 1
        term_name = term_by_urn.get(f.glossaryTermUrn, "Intent")
        agent_id = f.assertedByAgentUrn.split(":")[-1]
        urn = fact_urn(f.factId)
        try:
            ui = client.datahub_ui_url(urn)
        except Exception:
            ui = ""
        nodes.append(
            {
                "id": f.factId,
                "urn": urn,
                "kind": "fact",
                "label": _short_label(f),
                "glossaryTerm": term_name,
                "sensitivityTag": sens,
                "certificationStatus": (
                    f.certificationStatus.value
                    if hasattr(f.certificationStatus, "value")
                    else str(f.certificationStatus)
                ),
                "confidence": f.confidence,
                "stale": stale,
                "assertedAt": f.assertedAt,
                "decisionLabel": f.decisionLabel,
                "agentId": agent_id,
                "datahubUrl": ui,
                "provenance": f.provenance,
            }
        )
        add_edge("classifiedAs", "GLOSSARY", f.factId, f"term:{term_name}")
        add_edge("ownership", "ASSERTED_BY", f"agent:{agent_id}", f.factId)
        if f.supersedesFactId and f.supersedesFactId in fact_ids:
            add_edge("lineage", "SUPERSEDES", f.supersedesFactId, f.factId)

    # Lineage edges from UpstreamLineage aspects (one read per fact)
    if UpstreamLineageClass is not None:
        for f in facts:
            try:
                aspect = client.graph.get_aspect(fact_urn(f.factId), UpstreamLineageClass)
            except Exception:
                continue
            if not aspect or not aspect.upstreams:
                continue
            for u in aspect.upstreams:
                up_id = _fact_id_from_urn(u.dataset or "")
                if up_id and up_id in fact_ids:
                    add_edge("lineage", "DECISION", up_id, f.factId)

    lineage_count = sum(1 for e in edges if e["type"] == "lineage")
    return {
        "ok": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "factCount": len(facts),
            "agentCount": sum(1 for n in nodes if n["kind"] == "agent"),
            "lineageEdgeCount": lineage_count,
            "sensitivityCounts": sens_counts,
        },
    }


def fact_history(broker: Any, fact_id: str) -> dict[str, Any]:
    """Walk the supersede chain both directions from a fact."""
    client = broker.client
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Walk backwards (what this fact superseded)
    cursor = client.get_fact(fact_id)
    if not cursor:
        return {"ok": False, "error": "fact not found", "factId": fact_id}

    back: list[Fact] = []
    node = cursor
    while node and node.supersedesFactId and node.supersedesFactId not in seen:
        seen.add(node.factId)
        prev = client.get_fact(node.supersedesFactId)
        if not prev:
            break
        back.append(prev)
        node = prev

    # Walk forwards (facts that superseded this one)
    fwd: list[Fact] = []
    all_facts = client.search_facts("")
    frontier = {fact_id}
    while frontier:
        nxt = [f for f in all_facts if f.supersedesFactId in frontier and f.factId not in seen]
        if not nxt:
            break
        for f in nxt:
            seen.add(f.factId)
            fwd.append(f)
        frontier = {f.factId for f in nxt}

    ordered = [*reversed(back), cursor, *fwd]
    for f in ordered:
        chain.append(
            {
                "factId": f.factId,
                "value": f.value,
                "certificationStatus": (
                    f.certificationStatus.value
                    if hasattr(f.certificationStatus, "value")
                    else str(f.certificationStatus)
                ),
                "confidence": f.confidence,
                "assertedAt": f.assertedAt,
                "assertedBy": f.assertedByAgentUrn.split(":")[-1],
                "decisionLabel": f.decisionLabel,
                "isCurrent": f.factId == fact_id,
            }
        )
    return {"ok": True, "factId": fact_id, "chain": chain, "length": len(chain)}


def glossary_summary(broker: Any) -> dict[str, Any]:
    """Glossary terms + live fact counts — proof the ontology is enforced."""
    facts: list[Fact] = broker.client.search_facts("")
    counts: dict[str, int] = {}
    active: dict[str, int] = {}
    for f in facts:
        counts[f.glossaryTermUrn] = counts.get(f.glossaryTermUrn, 0) + 1
        if f.certificationStatus != CertificationStatus.superseded:
            active[f.glossaryTermUrn] = active.get(f.glossaryTermUrn, 0) + 1
    definitions = {
        "Budget": "Weekly spending ceiling certified by the user",
        "Health Condition": "Private wellness facts — sensitivity-gated",
        "Commitment": "Calendar events, trips, and promises",
        "Intent": "Agent decisions: purchases, searches, blocks",
        "Location": "Places the user cares about",
    }
    terms = []
    for name, urn in GLOSSARY_TERMS.items():
        terms.append(
            {
                "name": name,
                "urn": urn,
                "definition": definitions.get(name, ""),
                "factCount": counts.get(urn, 0),
                "activeCount": active.get(urn, 0),
            }
        )
    return {"ok": True, "terms": terms, "totalFacts": len(facts)}
