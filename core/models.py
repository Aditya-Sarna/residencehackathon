"""Canonical Fact / Agent / Assertion schemas — import from here, never redefine."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class CertificationStatus(str, Enum):
    inferred = "inferred"
    user_confirmed = "user_confirmed"
    superseded = "superseded"


class SensitivityTag(str, Enum):
    none = "none"
    health = "health"
    financial = "financial"
    location = "location"
    biometric = "biometric"


GLOSSARY_TERMS = {
    "Budget": "urn:li:glossaryTerm:residence.Budget",
    "Health Condition": "urn:li:glossaryTerm:residence.HealthCondition",
    "Commitment": "urn:li:glossaryTerm:residence.Commitment",
    "Intent": "urn:li:glossaryTerm:residence.Intent",
    "Location": "urn:li:glossaryTerm:residence.Location",
}

TERM_ALIASES = {
    "budget": "Budget",
    "health": "Health Condition",
    "health condition": "Health Condition",
    "commitment": "Commitment",
    "intent": "Intent",
    "location": "Location",
}


class Fact(BaseModel):
    factId: str = Field(default_factory=lambda: str(uuid4()))
    glossaryTermUrn: str
    value: str
    assertedByAgentUrn: str
    assertedAt: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    confidence: float = 0.6
    certificationStatus: CertificationStatus = CertificationStatus.inferred
    sensitivityTag: SensitivityTag = SensitivityTag.none
    ttlSeconds: Optional[int] = None
    supersedesFactId: Optional[str] = None
    # Soft lineage helpers (also mirrored into DataHub lineage)
    decisionLabel: Optional[str] = None
    # Explicit desktop provenance, mirrored into DataHub custom properties.
    provenance: Optional[dict[str, Any]] = None


class Agent(BaseModel):
    agentId: str
    displayName: str
    readScopes: list[SensitivityTag] = Field(default_factory=list)
    writeScopes: list[str] = Field(default_factory=list)
    implementation: str = "in_house_app"

    @property
    def urn(self) -> str:
        return f"urn:li:corpuser:{self.agentId}"


class Assertion(BaseModel):
    assertionId: str = Field(default_factory=lambda: str(uuid4()))
    resolvedFactId: str
    competingFactIds: list[str]
    resolutionReason: str
    resolvedAt: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AssertFactRequest(BaseModel):
    fact: dict[str, Any]
    agent_id: str
    confidence: float = 0.6
    sensitivity_tag: SensitivityTag = SensitivityTag.none
    glossary_term: Optional[str] = None
    decision_label: Optional[str] = None


class QueryFactsRequest(BaseModel):
    query: str
    requesting_agent_id: str
    glossary_term: Optional[str] = None


class FactResult(BaseModel):
    fact: Fact
    stale: bool = False
    provenance: str = ""


class QueryFactsResponse(BaseModel):
    results: list[FactResult]
    skill_invocations: list[str] = Field(default_factory=list)


def resolve_glossary_term(name_or_urn: str) -> Optional[str]:
    if name_or_urn.startswith("urn:li:glossaryTerm:"):
        if name_or_urn in GLOSSARY_TERMS.values():
            return name_or_urn
        return None
    key = TERM_ALIASES.get(name_or_urn.strip().lower(), name_or_urn.strip())
    return GLOSSARY_TERMS.get(key)


def agent_urn(agent_id: str) -> str:
    return f"urn:li:corpuser:{agent_id}"


def fact_urn(fact_id: str) -> str:
    return f"urn:li:dataset:(urn:li:dataPlatform:residence,fact.{fact_id},PROD)"
