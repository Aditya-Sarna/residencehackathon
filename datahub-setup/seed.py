#!/usr/bin/env python3
"""Phase 1 — seed glossary, agents (CorpUser), and example facts into DataHub OSS."""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))
load_dotenv(ROOT / ".env")

from datahub_client import DataHubClient
from models import (
    GLOSSARY_TERMS,
    Agent,
    CertificationStatus,
    Fact,
    SensitivityTag,
    agent_urn,
)


AGENTS = [
    Agent(
        agentId="shopping-agent",
        displayName="Shopping Agent",
        readScopes=[SensitivityTag.none, SensitivityTag.financial],
        writeScopes=["Intent", "Commitment"],
        implementation="in_house_app",
    ),
    Agent(
        agentId="finance-agent",
        displayName="Finance Agent",
        readScopes=[SensitivityTag.none, SensitivityTag.financial],
        writeScopes=["Budget"],
        implementation="in_house_app",
    ),
    Agent(
        agentId="calendar-health-agent",
        displayName="Calendar/Health Agent",
        readScopes=[
            SensitivityTag.none,
            SensitivityTag.health,
            SensitivityTag.location,
        ],
        writeScopes=["Commitment", "Health Condition", "Location"],
        implementation="in_house_app",
    ),
    Agent(
        agentId="claude-wrapper",
        displayName="Claude Wrapper",
        readScopes=[
            SensitivityTag.none,
            SensitivityTag.financial,
            SensitivityTag.health,
            SensitivityTag.location,
        ],
        writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
        implementation="real_api_wrapper",
    ),
    Agent(
        agentId="chatgpt-wrapper",
        displayName="ChatGPT Wrapper",
        readScopes=[
            SensitivityTag.none,
            SensitivityTag.financial,
            SensitivityTag.health,
            SensitivityTag.location,
        ],
        writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
        implementation="real_api_wrapper",
    ),
    Agent(
        agentId="mentor-user",
        displayName="Mentor (Human)",
        readScopes=[
            SensitivityTag.none,
            SensitivityTag.financial,
            SensitivityTag.health,
            SensitivityTag.location,
            SensitivityTag.biometric,
        ],
        writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
        implementation="in_house_app",
    ),
]


def wait_for_gms(client: DataHubClient, attempts: int = 60) -> None:
    for i in range(attempts):
        if client.health():
            print(f"GMS healthy at {client.gms_url}")
            return
        print(f"waiting for GMS... {i + 1}/{attempts}")
        time.sleep(5)
    raise SystemExit("DataHub GMS not healthy — run: datahub docker quickstart")


def main() -> None:
    client = DataHubClient()
    wait_for_gms(client)

    print("Seeding glossary terms...")
    definitions = {
        "Budget": "Personal spending ceiling or allocation.",
        "Health Condition": "Sensitive personal health fact.",
        "Commitment": "A calendar-worthy obligation or promise.",
        "Intent": "A purchase or action intention.",
        "Location": "A place relevant to the person.",
    }
    for name, urn in GLOSSARY_TERMS.items():
        client.upsert_glossary_term(name, urn, definitions[name])
        print("  term", name)

    print("Seeding agents as CorpUsers...")
    for agent in AGENTS:
        client.upsert_agent(agent)
        print("  agent", agent.agentId)

    now = datetime.now(timezone.utc)
    seeds = [
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Budget"],
            value='{"ceilingWeeklyUsd": 500, "currency": "USD"}',
            assertedByAgentUrn=agent_urn("finance-agent"),
            confidence=1.0,
            certificationStatus=CertificationStatus.user_confirmed,
            sensitivityTag=SensitivityTag.financial,
            ttlSeconds=7 * 24 * 3600,
            decisionLabel="weekly-budget-ceiling",
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Intent"],
            value='{"item": "running shoes", "occasion": "gift", "maxUsd": 120}',
            assertedByAgentUrn=agent_urn("claude-wrapper"),
            confidence=0.7,
            certificationStatus=CertificationStatus.inferred,
            sensitivityTag=SensitivityTag.none,
            decisionLabel="gift-intent",
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Commitment"],
            value='{"title": "Friend birthday", "dayOfMonth": 15}',
            assertedByAgentUrn=agent_urn("claude-wrapper"),
            confidence=0.75,
            certificationStatus=CertificationStatus.inferred,
            sensitivityTag=SensitivityTag.none,
            decisionLabel="birthday-commitment",
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Health Condition"],
            value='{"note": "allergic to nickel", "severity": "avoid metal jewelry"}',
            assertedByAgentUrn=agent_urn("calendar-health-agent"),
            confidence=1.0,
            certificationStatus=CertificationStatus.user_confirmed,
            sensitivityTag=SensitivityTag.health,
            decisionLabel="allergy-note",
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Location"],
            value='{"city": "Austin", "region": "TX"}',
            assertedByAgentUrn=agent_urn("mentor-user"),
            confidence=1.0,
            certificationStatus=CertificationStatus.user_confirmed,
            sensitivityTag=SensitivityTag.location,
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Budget"],
            value='{"ceilingWeeklyUsd": 200, "currency": "USD", "note": "stale draft"}',
            assertedByAgentUrn=agent_urn("finance-agent"),
            confidence=0.5,
            certificationStatus=CertificationStatus.inferred,
            sensitivityTag=SensitivityTag.financial,
            ttlSeconds=60,
            assertedAt=(now - timedelta(hours=2)).isoformat(),
            decisionLabel="stale-budget-draft",
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Intent"],
            value='{"item": "headphones", "maxUsd": 80}',
            assertedByAgentUrn=agent_urn("shopping-agent"),
            confidence=0.65,
            sensitivityTag=SensitivityTag.none,
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Commitment"],
            value='{"title": "Dentist", "dayOfMonth": 22}',
            assertedByAgentUrn=agent_urn("calendar-health-agent"),
            confidence=0.9,
            certificationStatus=CertificationStatus.user_confirmed,
            sensitivityTag=SensitivityTag.none,
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Location"],
            value='{"venue": "home studio"}',
            assertedByAgentUrn=agent_urn("mentor-user"),
            confidence=0.8,
            sensitivityTag=SensitivityTag.location,
        ),
        Fact(
            glossaryTermUrn=GLOSSARY_TERMS["Intent"],
            value='{"item": "books", "maxUsd": 40}',
            assertedByAgentUrn=agent_urn("chatgpt-wrapper"),
            confidence=0.6,
            sensitivityTag=SensitivityTag.none,
        ),
    ]

    print("Seeding facts...")
    for fact in seeds:
        client.upsert_fact(fact)
        print("  fact", fact.factId, fact.glossaryTermUrn)

    # Verify search path
    time.sleep(1)
    found = client.search_facts("fact")
    print(f"Search hydrate returned {len(found)} facts")
    if len(found) < 1:
        raise SystemExit("Phase 1 gate failed: no facts readable back from DataHub")
    sample = found[0]
    required = [
        sample.factId,
        sample.glossaryTermUrn,
        sample.sensitivityTag,
        sample.confidence,
        sample.certificationStatus,
    ]
    if not all(required):
        raise SystemExit("Phase 1 gate failed: fact missing required schema fields")
    print("Phase 1 gate PASSED")


if __name__ == "__main__":
    main()
