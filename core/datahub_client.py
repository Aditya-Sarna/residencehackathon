"""DataHub client via official RestEmitter + Graph — load-bearing for every fact."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

from datahub.emitter.mcp import MetadataChangeProposalWrapper
from datahub.emitter.rest_emitter import DatahubRestEmitter
from datahub.metadata.schema_classes import (
    AssertionInfoClass,
    AssertionResultClass,
    AssertionResultTypeClass,
    AssertionRunEventClass,
    AssertionRunStatusClass,
    AssertionTypeClass,
    AuditStampClass,
    CorpUserEditableInfoClass,
    CorpUserInfoClass,
    CustomAssertionInfoClass,
    DatasetPropertiesClass,
    DomainPropertiesClass,
    DomainsClass,
    GlobalTagsClass,
    GlossaryTermAssociationClass,
    GlossaryTermInfoClass,
    GlossaryTermsClass,
    OtherSchemaClass,
    OwnerClass,
    OwnershipClass,
    OwnershipTypeClass,
    SchemaMetadataClass,
    StatusClass,
    TagAssociationClass,
    UpstreamClass,
    UpstreamLineageClass,
    DatasetLineageTypeClass,
)

# Personal Context domain — every Residence Fact lives here
RESIDENCE_DOMAIN_URN = "urn:li:domain:residence.personal-context"
AGENT_CACHE_TTL = int(os.getenv("RESIDENCE_AGENT_CACHE_TTL", "30"))

from models import (
    Agent,
    Assertion,
    CertificationStatus,
    Fact,
    SensitivityTag,
    agent_urn,
    fact_urn,
)

log = logging.getLogger("residence.datahub")


class DataHubClient:
    def __init__(
        self,
        gms_url: Optional[str] = None,
        token: Optional[str] = None,
    ) -> None:
        self.gms_url = (gms_url or os.getenv("DATAHUB_GMS_URL", "http://localhost:8080")).rstrip(
            "/"
        )
        self.token = token if token is not None else os.getenv("DATAHUB_GMS_TOKEN", "")
        extra = {"Authorization": f"Bearer {self.token}"} if self.token else None
        self.emitter = DatahubRestEmitter(
            gms_server=self.gms_url,
            token=self.token or None,
            extra_headers=extra,
        )
        self._graph = None
        self._domain_ready = False

    @property
    def graph(self):
        if self._graph is None:
            from datahub.ingestion.graph.client import DataHubGraph, DatahubClientConfig

            self._graph = DataHubGraph(
                DatahubClientConfig(server=self.gms_url, token=self.token or None)
            )
        return self._graph

    def health(self) -> bool:
        try:
            import httpx

            r = httpx.get(f"{self.gms_url}/health", timeout=5.0)
            return r.status_code < 500
        except Exception:
            return False

    def _emit(self, *mcps: MetadataChangeProposalWrapper) -> None:
        for mcp in mcps:
            self.emitter.emit(mcp)

    def upsert_glossary_term(self, name: str, urn: str, definition: str) -> None:
        self._emit(
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=GlossaryTermInfoClass(
                    definition=definition,
                    termSource="INTERNAL",
                    name=name,
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=StatusClass(removed=False),
            ),
        )

    def ensure_tag(self, tag_name: str) -> str:
        urn = f"urn:li:tag:{tag_name}"
        try:
            from datahub.metadata.schema_classes import TagPropertiesClass

            self._emit(
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=TagPropertiesClass(name=tag_name.split(".")[-1], description=tag_name),
                )
            )
        except Exception:
            pass
        return urn

    def upsert_agent(self, agent: Agent) -> None:
        urn = agent.urn
        meta = {
            "readScopes": [s.value for s in agent.readScopes],
            "writeScopes": agent.writeScopes,
            "implementation": agent.implementation,
            "agentId": agent.agentId,
            "displayName": agent.displayName,
        }
        self._emit(
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=CorpUserInfoClass(
                    active=True,
                    displayName=agent.displayName,
                    fullName=agent.displayName,
                    email=f"{agent.agentId}@residence.local",
                    title="Residence Agent",
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=CorpUserEditableInfoClass(
                    aboutMe=json.dumps(meta),
                    teams=["residence"],
                    skills=list(agent.writeScopes),
                ),
            ),
        )
        # Mirror scopes locally so Trust toggles are immediately consistent
        # (GMS search/aspect cache can lag); DataHub remains the emitted source of truth.
        self._save_agent_cache(agent)

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        """Prefer live GMS; fall back to TTL'd local cache only on lag/failure."""
        cached, cached_at = self._load_agent_cache_entry(agent_id)
        fresh = cached is not None and (time.time() - cached_at) < AGENT_CACHE_TTL

        # Always try GMS when cache is stale — DataHub is source of truth
        if not fresh:
            live = self._fetch_agent_from_gms(agent_id)
            if live:
                self._save_agent_cache(live)
                return live
            if cached:
                return cached
            return None

        # Cache warm: return it, but refresh in background-ish next miss
        return cached

    def _fetch_agent_from_gms(self, agent_id: str) -> Optional[Agent]:
        urn = agent_urn(agent_id)
        try:
            self._graph = None  # bust client cache
            aspect = self.graph.get_aspect(urn, CorpUserEditableInfoClass)
            info = self.graph.get_aspect(urn, CorpUserInfoClass)
        except Exception as e:
            log.warning("get_agent failed: %s", e)
            return None
        if not aspect and not info:
            return None
        meta: dict[str, Any] = {}
        if aspect and aspect.aboutMe:
            try:
                meta = json.loads(aspect.aboutMe)
            except Exception:
                meta = {}
        return Agent(
            agentId=agent_id,
            displayName=(info.displayName if info and info.displayName else agent_id),
            readScopes=[SensitivityTag(s) for s in meta.get("readScopes", [])],
            writeScopes=list(meta.get("writeScopes", [])),
            implementation=meta.get("implementation", "in_house_app"),
        )

    def _agent_cache_path(self) -> str:
        d = os.path.join(os.path.dirname(__file__), ".cache")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "agents.json")

    def _save_agent_cache(self, agent: Agent) -> None:
        path = self._agent_cache_path()
        data: dict[str, Any] = {}
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
        payload = agent.model_dump(mode="json")
        payload["_cachedAt"] = time.time()
        data[agent.agentId] = payload
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    def _load_agent_cache_entry(self, agent_id: str) -> tuple[Optional[Agent], float]:
        path = self._agent_cache_path()
        if not os.path.exists(path):
            return None, 0.0
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            return None, 0.0
        raw = data.get(agent_id)
        if not raw:
            return None, 0.0
        cached_at = float(raw.get("_cachedAt") or 0)
        return (
            Agent(
                agentId=raw["agentId"],
                displayName=raw["displayName"],
                readScopes=[SensitivityTag(s) for s in raw.get("readScopes", [])],
                writeScopes=list(raw.get("writeScopes", [])),
                implementation=raw.get("implementation", "in_house_app"),
            ),
            cached_at,
        )

    def ensure_domain(self) -> str:
        """Personal Context domain — the DataHub container for every Fact."""
        if self._domain_ready:
            return RESIDENCE_DOMAIN_URN
        try:
            self._emit(
                MetadataChangeProposalWrapper(
                    entityUrn=RESIDENCE_DOMAIN_URN,
                    aspect=DomainPropertiesClass(
                        name="Personal Context",
                        description=(
                            "Residence personal OS — Budget, Health, Commitments, "
                            "Intents, and Locations shared across apps via DataHub."
                        ),
                    ),
                ),
                MetadataChangeProposalWrapper(
                    entityUrn=RESIDENCE_DOMAIN_URN,
                    aspect=StatusClass(removed=False),
                ),
            )
            self._domain_ready = True
        except Exception as e:
            log.warning("ensure_domain failed: %s", e)
        return RESIDENCE_DOMAIN_URN

    def datahub_ui_url(self, entity_urn: str) -> str:
        """Deep-link into the DataHub UI for a fact/assertion/domain."""
        ui = (os.getenv("DATAHUB_UI_URL") or "").strip().rstrip("/")
        if not ui:
            ui = self.gms_url.replace(":8080", ":9002") if ":8080" in self.gms_url else self.gms_url
        from urllib.parse import quote

        return f"{ui}/entity/{quote(entity_urn, safe='')}"

    def update_agent_scopes(
        self, agent_id: str, read_scopes: list[str], write_scopes: list[str]
    ) -> Agent:
        agent = self.get_agent(agent_id)
        if not agent:
            raise KeyError(f"unknown agent {agent_id}")
        agent.readScopes = [SensitivityTag(s) for s in read_scopes]
        agent.writeScopes = write_scopes
        self.upsert_agent(agent)
        return agent

    def upsert_fact(self, fact: Fact) -> None:
        urn = fact_urn(fact.factId)
        cp = {
            "factId": fact.factId,
            "glossaryTermUrn": fact.glossaryTermUrn,
            "value": fact.value,
            "assertedByAgentUrn": fact.assertedByAgentUrn,
            "assertedAt": fact.assertedAt,
            "confidence": str(fact.confidence),
            "certificationStatus": fact.certificationStatus.value,
            "sensitivityTag": fact.sensitivityTag.value,
            "ttlSeconds": "" if fact.ttlSeconds is None else str(fact.ttlSeconds),
            "supersedesFactId": fact.supersedesFactId or "",
            "decisionLabel": fact.decisionLabel or "",
            "provenance": json.dumps(fact.provenance or {}, sort_keys=True),
            "residenceEntity": "Fact",
        }
        self.ensure_tag(f"residence.cert.{fact.certificationStatus.value}")
        self.ensure_tag(f"residence.sensitivity.{fact.sensitivityTag.value}")
        mcps = [
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=DatasetPropertiesClass(
                    name=f"fact.{fact.factId}",
                    description=f"Residence Fact: {fact.value}",
                    customProperties=cp,
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=StatusClass(removed=False),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=SchemaMetadataClass(
                    schemaName="residence.Fact",
                    platform="urn:li:dataPlatform:residence",
                    version=0,
                    hash="",
                    platformSchema=OtherSchemaClass(rawSchema=json.dumps(cp)),
                    fields=[],
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=OwnershipClass(
                    owners=[
                        OwnerClass(
                            owner=fact.assertedByAgentUrn,
                            type=OwnershipTypeClass.DATAOWNER,
                        )
                    ]
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=GlossaryTermsClass(
                    terms=[GlossaryTermAssociationClass(urn=fact.glossaryTermUrn)],
                    auditStamp=AuditStampClass(time=0, actor=fact.assertedByAgentUrn),
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=GlobalTagsClass(
                    tags=[
                        TagAssociationClass(
                            tag=f"urn:li:tag:residence.cert.{fact.certificationStatus.value}"
                        ),
                        TagAssociationClass(
                            tag=f"urn:li:tag:residence.sensitivity.{fact.sensitivityTag.value}"
                        ),
                    ]
                ),
            ),
            MetadataChangeProposalWrapper(
                entityUrn=urn,
                aspect=DomainsClass(domains=[self.ensure_domain()]),
            ),
        ]
        if fact.supersedesFactId:
            mcps.append(
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=UpstreamLineageClass(
                        upstreams=[
                            UpstreamClass(
                                dataset=fact_urn(fact.supersedesFactId),
                                type=DatasetLineageTypeClass.TRANSFORMED,
                            )
                        ]
                    ),
                )
            )
        self._emit(*mcps)
        self.index_fact_id(fact.factId)

    def upsert_assertion(self, assertion: Assertion) -> None:
        """Native DataHub Assertion entity + run event (not a fake dataset)."""
        assertee = fact_urn(assertion.resolvedFactId)
        urn = f"urn:li:assertion:{assertion.assertionId}"
        try:
            ts_ms = int(time.time() * 1000)
            self._emit(
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=AssertionInfoClass(
                        type=AssertionTypeClass.CUSTOM,
                        description=assertion.resolutionReason,
                        customAssertion=CustomAssertionInfoClass(
                            type="CONFLICT_RESOLUTION",
                            entity=assertee,
                            logic=(
                                f"Resolved among {len(assertion.competingFactIds) + 1} "
                                f"competing Facts by certification → confidence → recency. "
                                f"Competitors: {', '.join(assertion.competingFactIds)}"
                            ),
                        ),
                    ),
                ),
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=AssertionRunEventClass(
                        timestampMillis=ts_ms,
                        runId=assertion.assertionId,
                        asserteeUrn=assertee,
                        status=AssertionRunStatusClass.COMPLETE,
                        assertionUrn=urn,
                        result=AssertionResultClass(
                            type=AssertionResultTypeClass.SUCCESS,
                            nativeResults={
                                "resolvedFactId": assertion.resolvedFactId,
                                "competingFactIds": json.dumps(assertion.competingFactIds),
                                "resolutionReason": assertion.resolutionReason,
                                "resolvedAt": assertion.resolvedAt,
                            },
                        ),
                    ),
                ),
                MetadataChangeProposalWrapper(
                    entityUrn=urn,
                    aspect=StatusClass(removed=False),
                ),
            )
        except Exception as e:
            log.warning("native assertion emit failed (%s) — dataset fallback", e)
            # Fallback for older GMS builds
            ds = f"urn:li:dataset:(urn:li:dataPlatform:residence,assertion.{assertion.assertionId},PROD)"
            self._emit(
                MetadataChangeProposalWrapper(
                    entityUrn=ds,
                    aspect=DatasetPropertiesClass(
                        name=f"assertion.{assertion.assertionId}",
                        description=assertion.resolutionReason,
                        customProperties={
                            "residenceEntity": "Assertion",
                            "assertionId": assertion.assertionId,
                            "resolvedFactId": assertion.resolvedFactId,
                            "competingFactIds": json.dumps(assertion.competingFactIds),
                            "resolutionReason": assertion.resolutionReason,
                            "resolvedAt": assertion.resolvedAt,
                        },
                    ),
                )
            )

    def add_lineage_edge(self, upstream_fact_id: str, downstream_fact_id: str) -> None:
        down = fact_urn(downstream_fact_id)
        existing = None
        try:
            existing = self.graph.get_aspect(down, UpstreamLineageClass)
        except Exception:
            existing = None
        ups = list(existing.upstreams) if existing and existing.upstreams else []
        up_urn = fact_urn(upstream_fact_id)
        if not any(u.dataset == up_urn for u in ups):
            ups.append(
                UpstreamClass(dataset=up_urn, type=DatasetLineageTypeClass.TRANSFORMED)
            )
        self._emit(
            MetadataChangeProposalWrapper(
                entityUrn=down,
                aspect=UpstreamLineageClass(upstreams=ups),
            )
        )

    def search_facts(self, query: str) -> list[Fact]:
        """Implements datahub-search skill pattern against GMS, with index hydrate.

        Always merges the local fact index so newly written facts are visible even
        when GMS search lag returns a partial/stale urn set.
        """
        by_id: dict[str, Fact] = {}
        try:
            # Prefer urn filter scroll (DataHubGraph v1.7+)
            if hasattr(self.graph, "get_urns_by_filter"):
                urns = list(
                    self.graph.get_urns_by_filter(
                        entity_types=["dataset"],
                        query=query or "fact",
                        batch_size=200,
                    )
                )
                for urn in urns:
                    if "fact." in str(urn):
                        fact = self.get_fact_by_urn(str(urn))
                        if fact:
                            by_id[fact.factId] = fact
            elif hasattr(self.graph, "get_search_results"):
                results = self.graph.get_search_results(
                    query or "fact", entity="dataset", count=200
                )
                for el in results or []:
                    urn = getattr(el, "entity", None) or getattr(el, "urn", None)
                    if isinstance(el, dict):
                        urn = el.get("entity") or el.get("urn")
                    if urn and "fact." in str(urn):
                        fact = self.get_fact_by_urn(str(urn))
                        if fact:
                            by_id[fact.factId] = fact
        except Exception as e:
            log.warning("graph search failed (%s) — using fact index hydrate", e)
        for fact in self._hydrate_index():
            by_id.setdefault(fact.factId, fact)
        facts = list(by_id.values())
        q = (query or "").lower().strip()
        if q and q not in ("*", "fact", "residence"):
            tokens = [t for t in q.replace(",", " ").split() if t]

            def matches(f: Fact) -> bool:
                hay = " ".join(
                    [
                        f.value.lower(),
                        f.glossaryTermUrn.lower(),
                        (f.decisionLabel or "").lower(),
                        f.factId.lower(),
                        f.sensitivityTag.value.lower(),
                    ]
                )
                if q in hay:
                    return True
                return all(t in hay for t in tokens)

            facts = [f for f in facts if matches(f)]
        return facts

    def _hydrate_index(self) -> list[Fact]:
        out: list[Fact] = []
        for fid in self._load_index():
            fact = self.get_fact(fid)
            if fact:
                out.append(fact)
        return out

    def index_fact_id(self, fact_id: str) -> None:
        ids = self._load_index()
        if fact_id not in ids:
            ids.append(fact_id)
            self._save_index(ids)

    def clear_fact_index(self) -> None:
        path = self._index_path()
        if os.path.exists(path):
            os.remove(path)

    def _index_path(self) -> str:
        d = os.path.join(os.path.dirname(__file__), ".cache")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "fact_index.json")

    def _load_index(self) -> list[str]:
        path = self._index_path()
        if not os.path.exists(path):
            return []
        with open(path) as f:
            return json.load(f)

    def _save_index(self, ids: list[str]) -> None:
        with open(self._index_path(), "w") as f:
            json.dump(ids, f)

    def get_fact(self, fact_id: str) -> Optional[Fact]:
        return self.get_fact_by_urn(fact_urn(fact_id))

    def get_fact_by_urn(self, urn: str) -> Optional[Fact]:
        try:
            props = self.graph.get_aspect(urn, DatasetPropertiesClass)
        except Exception:
            return None
        if not props or not props.customProperties:
            return None
        cp = props.customProperties
        if cp.get("residenceEntity") != "Fact":
            return None
        ttl_raw = cp.get("ttlSeconds") or ""
        return Fact(
            factId=cp["factId"],
            glossaryTermUrn=cp["glossaryTermUrn"],
            value=cp["value"],
            assertedByAgentUrn=cp["assertedByAgentUrn"],
            assertedAt=cp["assertedAt"],
            confidence=float(cp.get("confidence", "0.6")),
            certificationStatus=CertificationStatus(cp.get("certificationStatus", "inferred")),
            sensitivityTag=SensitivityTag(cp.get("sensitivityTag", "none")),
            ttlSeconds=int(ttl_raw) if ttl_raw not in ("", None) else None,
            supersedesFactId=cp.get("supersedesFactId") or None,
            decisionLabel=cp.get("decisionLabel") or None,
            provenance=json.loads(cp.get("provenance") or "{}") or None,
        )

    def get_lineage(self, fact_id: str, direction: str = "BOTH") -> dict[str, Any]:
        """datahub-lineage skill pattern."""
        urn = fact_urn(fact_id)
        result: dict[str, Any] = {"entity": urn, "upstreams": [], "downstreams": []}
        try:
            aspect = self.graph.get_aspect(urn, UpstreamLineageClass)
            if aspect and aspect.upstreams:
                result["upstreams"] = [
                    {"dataset": u.dataset, "type": str(u.type)} for u in aspect.upstreams
                ]
        except Exception as e:
            log.warning("lineage upstream read failed: %s", e)
        # Downstream: scan indexed facts for edges pointing here (deduped)
        seen_downstream: set[str] = set()
        for f in self._hydrate_index():
            down_urn = fact_urn(f.factId)
            if f.supersedesFactId == fact_id and down_urn not in seen_downstream:
                seen_downstream.add(down_urn)
                result["downstreams"].append({"dataset": down_urn, "type": "TRANSFORMED"})
            try:
                la = self.graph.get_aspect(down_urn, UpstreamLineageClass)
                if la and la.upstreams:
                    for u in la.upstreams:
                        if u.dataset == urn and down_urn not in seen_downstream:
                            seen_downstream.add(down_urn)
                            result["downstreams"].append(
                                {"dataset": down_urn, "type": str(u.type)}
                            )
            except Exception:
                continue
        return result

    def certify_fact(self, fact_id: str) -> Fact:
        """datahub-enrich skill pattern."""
        fact = self.get_fact(fact_id)
        if not fact:
            raise KeyError(fact_id)
        fact.certificationStatus = CertificationStatus.user_confirmed
        fact.confidence = 1.0
        self.upsert_fact(fact)
        return fact

    def soft_delete_fact(self, fact_id: str) -> bool:
        """Soft-remove one Fact — used by desktop Undo Last Accept."""
        urn = fact_urn(fact_id)
        try:
            self._emit(
                MetadataChangeProposalWrapper(
                    entityUrn=urn, aspect=StatusClass(removed=True)
                )
            )
            ids = [i for i in self._load_index() if i != fact_id]
            self._save_index(ids)
            return True
        except Exception as e:
            log.warning("soft_delete_fact failed: %s", e)
            return False

    def soft_delete_all_facts(self) -> int:
        n = 0
        for fid in list(self._load_index()):
            urn = fact_urn(fid)
            try:
                self._emit(
                    MetadataChangeProposalWrapper(
                        entityUrn=urn, aspect=StatusClass(removed=True)
                    )
                )
                n += 1
            except Exception:
                pass
        self.clear_fact_index()
        return n
