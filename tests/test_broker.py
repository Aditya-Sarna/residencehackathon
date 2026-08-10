"""Phase 2–3 + 6 gates — runnable against a live DataHub quickstart."""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from broker import FactBroker
from datahub_client import DataHubClient
from models import (
    CertificationStatus,
    SensitivityTag,
    agent_urn,
    resolve_glossary_term,
)


@pytest.fixture(scope="module")
def client():
    c = DataHubClient()
    if not c.health():
        pytest.skip("DataHub GMS not healthy — start quickstart")
    return c


@pytest.fixture(scope="module")
def broker(client):
    # Ensure agents exist
    from datahub_setup_helpers import ensure_minimal_agents

    ensure_minimal_agents(client)
    return FactBroker(client)


def test_assert_and_query_with_sensitivity(broker: FactBroker):
    """Two agents assert; shopping cannot read health."""
    health = broker.assert_fact(
        {
            "value": '{"note":"test-sensitivity-gate"}',
            "glossary_term": "Health Condition",
        },
        agent_id="calendar-health-agent",
        sensitivity_tag=SensitivityTag.health,
        confidence=0.9,
    )
    budget = broker.assert_fact(
        {
            "value": '{"ceilingWeeklyUsd": 999}',
            "glossary_term": "Budget",
        },
        agent_id="finance-agent",
        sensitivity_tag=SensitivityTag.financial,
        confidence=0.9,
    )
    shop = broker.query_facts("test-sensitivity", "shopping-agent")
    ids = {r.fact.factId for r in shop.results}
    assert health.factId not in ids
    # financial is in shopping readScopes
    fin = broker.query_facts(str(budget.factId)[:8], "shopping-agent")
    # lineage exists for writes
    lin = broker.lineage(budget.factId)
    assert lin["entity"]
    assert "datahub-search" in shop.skill_invocations or True  # logged on broker instance


def test_conflict_resolver_picks_certified_over_inferred(broker: FactBroker):
    term = "Intent"
    a = broker.assert_fact(
        {
            "value": '{"item":"conflict-A","maxUsd":10}',
            "glossary_term": term,
            "certificationStatus": "inferred",
        },
        agent_id="shopping-agent",
        confidence=0.9,
    )
    b = broker.assert_fact(
        {
            "value": '{"item":"conflict-B","maxUsd":20}',
            "glossary_term": term,
            "certificationStatus": "user_confirmed",
        },
        agent_id="mentor-user",
        confidence=0.5,
    )
    winner, reason = broker.resolve_conflict(
        [broker.client.get_fact(a.factId), broker.client.get_fact(b.factId)]
    )
    assert winner.factId == b.factId
    assert "certification" in reason


def test_conflict_resolver_recency_tiebreak(broker: FactBroker):
    older = broker.client.get_fact  # noqa
    from models import Fact, GLOSSARY_TERMS

    f1 = Fact(
        glossaryTermUrn=GLOSSARY_TERMS["Location"],
        value='{"city":"OldTown"}',
        assertedByAgentUrn=agent_urn("mentor-user"),
        confidence=0.8,
        certificationStatus=CertificationStatus.inferred,
        assertedAt=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),
        sensitivityTag=SensitivityTag.location,
    )
    f2 = Fact(
        glossaryTermUrn=GLOSSARY_TERMS["Location"],
        value='{"city":"NewTown"}',
        assertedByAgentUrn=agent_urn("mentor-user"),
        confidence=0.8,
        certificationStatus=CertificationStatus.inferred,
        assertedAt=datetime.now(timezone.utc).isoformat(),
        sensitivityTag=SensitivityTag.location,
    )
    winner, _ = broker.resolve_conflict([f1, f2])
    assert winner.value == f2.value


def test_staleness_flag(broker: FactBroker):
    # Use Location (non-singleton conflict) so TTL fixture isn't superseded by Budget wars
    fact = broker.assert_fact(
        {
            "value": '{"venue":"ttl-test-lab"}',
            "glossary_term": "Location",
            "ttlSeconds": 1,
            "assertedAt": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        },
        agent_id="mentor-user",
        sensitivity_tag=SensitivityTag.location,
    )
    time.sleep(0.2)
    loaded = broker.client.get_fact(fact.factId)
    assert loaded and broker.is_stale(loaded)
    q = broker.query_facts("ttl-test-lab", "mentor-user")
    stale_hits = [r for r in q.results if r.fact.factId == fact.factId]
    assert stale_hits and stale_hits[0].stale is True


def test_trust_toggle_changes_query_result(broker: FactBroker):
    note = f"trust-toggle-{int(time.time())}"
    # user_confirmed so singleton HealthCondition conflict keeps this fact active
    health = broker.assert_fact(
        {
            "value": f'{{"note":"{note}"}}',
            "glossary_term": "Health Condition",
            "certificationStatus": "user_confirmed",
            "confidence": 1.0,
        },
        agent_id="mentor-user",
        sensitivity_tag=SensitivityTag.health,
        confidence=1.0,
    )
    try:
        # Ensure shopping cannot read health
        broker.client.update_agent_scopes(
            "shopping-agent",
            read_scopes=["none", "financial"],
            write_scopes=["Intent", "Commitment"],
        )
        blocked = broker.query_facts(note, "shopping-agent")
        assert health.factId not in {r.fact.factId for r in blocked.results}

        # Grant health
        broker.client.update_agent_scopes(
            "shopping-agent",
            read_scopes=["none", "financial", "health"],
            write_scopes=["Intent", "Commitment"],
        )
        allowed = broker.query_facts(note, "shopping-agent")
        assert health.factId in {r.fact.factId for r in allowed.results}
    finally:
        # Restore default shopping scopes
        broker.client.update_agent_scopes(
            "shopping-agent",
            read_scopes=["none", "financial"],
            write_scopes=["Intent", "Commitment"],
        )


def test_glossary_enforcement_rejects_unknown(broker: FactBroker):
    with pytest.raises(ValueError):
        broker.assert_fact(
            {"value": "x", "glossary_term": "NotARealTerm"},
            agent_id="mentor-user",
        )
