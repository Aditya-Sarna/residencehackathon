"""Fact Broker — sole interface agents use to talk to DataHub."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from datahub_client import DataHubClient
from models import (
    Assertion,
    CertificationStatus,
    Fact,
    FactResult,
    QueryFactsResponse,
    SensitivityTag,
    agent_urn,
    resolve_glossary_term,
)

log = logging.getLogger("residence.broker")


class FactBroker:
    def __init__(self, client: Optional[DataHubClient] = None) -> None:
        self.client = client or DataHubClient()
        self.skill_log: list[str] = []

    def _skill(self, name: str) -> None:
        self.skill_log.append(name)
        log.info("skill_invocation=%s", name)

    def assert_fact(
        self,
        fact_payload: dict[str, Any],
        agent_id: str,
        confidence: float = 0.6,
        sensitivity_tag: SensitivityTag = SensitivityTag.none,
        glossary_term: Optional[str] = None,
        decision_label: Optional[str] = None,
    ) -> Fact:
        agent = self.client.get_agent(agent_id)
        if not agent:
            raise PermissionError(f"Unknown agent: {agent_id}")

        term_key = glossary_term or fact_payload.get("glossary_term") or fact_payload.get(
            "glossaryTerm"
        )
        term_urn = fact_payload.get("glossaryTermUrn") or (
            resolve_glossary_term(term_key) if term_key else None
        )
        if not term_urn:
            raise ValueError(
                "Glossary Enforcement: unresolved term. "
                "Use Budget | Health Condition | Commitment | Intent | Location"
            )

        # writeScopes: glossary category names
        term_name = term_urn.split(".")[-1]
        allowed = {s.lower() for s in agent.writeScopes}
        if allowed and term_name.lower() not in allowed and term_key:
            # also allow full names in writeScopes
            if term_key.lower() not in allowed and term_name.lower() not in {
                a.replace(" ", "").lower() for a in allowed
            }:
                # map HealthCondition <-> Health Condition
                normalized_allowed = {a.replace(" ", "").lower() for a in allowed}
                if term_name.lower() not in normalized_allowed:
                    raise PermissionError(
                        f"Agent {agent_id} cannot write glossary term {term_urn}"
                    )

        value = fact_payload.get("value")
        if value is None:
            raise ValueError("fact.value is required")
        if not isinstance(value, str):
            import json

            value = json.dumps(value)

        sens = sensitivity_tag
        if "sensitivityTag" in fact_payload:
            sens = SensitivityTag(fact_payload["sensitivityTag"])
        elif "sensitivity_tag" in fact_payload:
            sens = SensitivityTag(fact_payload["sensitivity_tag"])

        fact = Fact(
            factId=fact_payload.get("factId") or fact_payload.get("fact_id") or str(uuid4()),
            glossaryTermUrn=term_urn,
            value=value,
            assertedByAgentUrn=agent_urn(agent_id),
            confidence=float(fact_payload.get("confidence", confidence)),
            certificationStatus=CertificationStatus(
                fact_payload.get("certificationStatus", CertificationStatus.inferred.value)
            ),
            sensitivityTag=sens,
            ttlSeconds=fact_payload.get("ttlSeconds"),
            supersedesFactId=fact_payload.get("supersedesFactId"),
            decisionLabel=decision_label or fact_payload.get("decisionLabel"),
            provenance=fact_payload.get("provenance"),
        )
        if fact_payload.get("assertedAt"):
            fact.assertedAt = fact_payload["assertedAt"]

        # Conflict resolution for singleton personal terms (Budget / Health)
        singleton = term_urn.endswith("Budget") or term_urn.endswith("HealthCondition")
        existing = self._active_facts_for_term(term_urn) if singleton else []
        competitors = [f for f in existing if f.value != fact.value and f.factId != fact.factId]
        loser_edge_to_winner: Optional[str] = None
        if competitors:
            winner, reason = self.resolve_conflict([fact, *competitors])
            if winner.factId != fact.factId:
                # Incoming loses: keep prior winner active; chain loser → winner so
                # history stays walkable (no orphaned superseded records).
                fact.certificationStatus = CertificationStatus.superseded
                fact.supersedesFactId = None
                loser_edge_to_winner = winner.factId
                self.client.upsert_assertion(
                    Assertion(
                        resolvedFactId=winner.factId,
                        competingFactIds=[fact.factId],
                        resolutionReason=reason,
                    )
                )
            else:
                for c in competitors:
                    if c.factId != winner.factId:
                        c.certificationStatus = CertificationStatus.superseded
                        self.client.upsert_fact(c)
                        # Every loser links into the winner, not just the first
                        if c.factId != competitors[0].factId:
                            self.client.add_lineage_edge(c.factId, fact.factId)
                fact.supersedesFactId = competitors[0].factId
                assertion = Assertion(
                    resolvedFactId=fact.factId,
                    competingFactIds=[c.factId for c in competitors],
                    resolutionReason=reason,
                )
                self.client.upsert_assertion(assertion)
                self._skill("datahub-lineage")

        self.client.upsert_fact(fact)
        self._skill("datahub-enrich")
        # Lineage edge: agent-owned write always traced
        if fact.supersedesFactId:
            self.client.add_lineage_edge(fact.supersedesFactId, fact.factId)
            self._skill("datahub-lineage")
        if loser_edge_to_winner:
            self.client.add_lineage_edge(fact.factId, loser_edge_to_winner)
            self._skill("datahub-lineage")
        return fact

    def query_facts(
        self,
        query: str,
        requesting_agent_id: str,
        glossary_term: Optional[str] = None,
    ) -> QueryFactsResponse:
        self.skill_log = []
        agent = self.client.get_agent(requesting_agent_id)
        if not agent:
            raise PermissionError(f"Unknown agent: {requesting_agent_id}")

        self._skill("datahub-search")
        facts = self.client.search_facts(query)
        if glossary_term:
            urn = resolve_glossary_term(glossary_term)
            if urn:
                facts = [f for f in facts if f.glossaryTermUrn == urn]

        # Sensitivity Gate (compare by tag value for cache/API robustness)
        allowed = {s.value if hasattr(s, "value") else str(s) for s in agent.readScopes}
        allowed.add(SensitivityTag.none.value)
        gated = [f for f in facts if f.sensitivityTag.value in allowed]

        # Drop superseded unless querying explicitly
        gated = [f for f in gated if f.certificationStatus != CertificationStatus.superseded]

        results: list[FactResult] = []
        for f in gated:
            stale = self.is_stale(f)
            if stale:
                self._skill("datahub-quality")
            agent_name = f.assertedByAgentUrn.split(":")[-1]
            results.append(
                FactResult(
                    fact=f,
                    stale=stale,
                    provenance=f"from: {agent_name}, {f.assertedAt}",
                )
            )
        return QueryFactsResponse(results=results, skill_invocations=list(self.skill_log))

    def is_stale(self, fact: Fact) -> bool:
        """OSS staleness: ttlSeconds + assertedAt in application code."""
        if fact.ttlSeconds is None:
            return False
        try:
            asserted = datetime.fromisoformat(fact.assertedAt.replace("Z", "+00:00"))
        except Exception:
            return False
        age = (datetime.now(timezone.utc) - asserted.astimezone(timezone.utc)).total_seconds()
        return age > fact.ttlSeconds

    def resolve_conflict(self, facts: list[Fact]) -> tuple[Fact, str]:
        """certification → confidence → recency."""
        rank = {
            CertificationStatus.user_confirmed: 2,
            CertificationStatus.inferred: 1,
            CertificationStatus.superseded: 0,
        }

        def key(f: Fact):
            return (
                rank.get(f.certificationStatus, 0),
                f.confidence,
                f.assertedAt,
            )

        winner = sorted(facts, key=key, reverse=True)[0]
        reason = (
            f"Resolved by certification={winner.certificationStatus.value}, "
            f"confidence={winner.confidence}, assertedAt={winner.assertedAt}"
        )
        return winner, reason

    def _active_facts_for_term(self, term_urn: str) -> list[Fact]:
        self._skill("datahub-search")
        facts = self.client.search_facts("fact")
        return [
            f
            for f in facts
            if f.glossaryTermUrn == term_urn
            and f.certificationStatus != CertificationStatus.superseded
        ]

    def certify(self, fact_id: str) -> Fact:
        self._skill("datahub-enrich")
        return self.client.certify_fact(fact_id)

    def lineage(self, fact_id: str) -> dict[str, Any]:
        self._skill("datahub-lineage")
        return self.client.get_lineage(fact_id)

    def impact_analysis(self, fact_id: str) -> dict[str, Any]:
        """If this fact changes, which downstream decisions were affected."""
        self._skill("datahub-lineage")
        lin = self.client.get_lineage(fact_id)
        affected = []
        for edge in lin.get("downstreams", []):
            urn = edge.get("dataset") or ""
            if "fact." in urn:
                fid = urn.split("fact.")[-1].rstrip(",PROD)")
                f = self.client.get_fact(fid)
                if f:
                    affected.append(
                        {
                            "factId": f.factId,
                            "value": f.value,
                            "decisionLabel": f.decisionLabel,
                            "assertedBy": f.assertedByAgentUrn,
                        }
                    )
        return {"rootFactId": fact_id, "affectedDecisions": affected}
