from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))


def ensure_minimal_agents(client) -> None:
    from models import Agent, SensitivityTag

    agents = [
        Agent(
            agentId="shopping-agent",
            displayName="Shopping Agent",
            readScopes=[SensitivityTag.none, SensitivityTag.financial],
            writeScopes=["Intent", "Commitment"],
        ),
        Agent(
            agentId="finance-agent",
            displayName="Finance Agent",
            readScopes=[SensitivityTag.none, SensitivityTag.financial],
            writeScopes=["Budget"],
        ),
        Agent(
            agentId="calendar-health-agent",
            displayName="Calendar/Health Agent",
            readScopes=[SensitivityTag.none, SensitivityTag.health, SensitivityTag.location],
            writeScopes=["Commitment", "Health Condition", "Location"],
        ),
        Agent(
            agentId="mentor-user",
            displayName="Mentor",
            readScopes=[
                SensitivityTag.none,
                SensitivityTag.financial,
                SensitivityTag.health,
                SensitivityTag.location,
                SensitivityTag.biometric,
            ],
            writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
        ),
        Agent(
            agentId="claude-wrapper",
            displayName="Claude Wrapper",
            readScopes=[SensitivityTag.none, SensitivityTag.financial, SensitivityTag.health],
            writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
            implementation="real_api_wrapper",
        ),
        Agent(
            agentId="chatgpt-wrapper",
            displayName="ChatGPT Wrapper",
            readScopes=[SensitivityTag.none, SensitivityTag.financial, SensitivityTag.health],
            writeScopes=["Commitment", "Intent", "Budget", "Location", "Health Condition"],
            implementation="real_api_wrapper",
        ),
    ]
    for a in agents:
        client.upsert_agent(a)


# Alias module name used by tests
_helper = ModuleType("datahub_setup_helpers")
_helper.ensure_minimal_agents = ensure_minimal_agents
sys.modules["datahub_setup_helpers"] = _helper
