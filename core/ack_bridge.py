"""DataHub Agent Context Kit bridge.

Wraps the official `datahub-agent-context` SDK so Residence agents use the same
MCP tool surface (search / get_entities / get_lineage) that DataHub documents
for ACK — against this instance's GMS.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional  # noqa: F401 — Optional used in signatures

log = logging.getLogger("residence.ack")

ACK_AVAILABLE = False
_ACK_ERROR: Optional[str] = None

try:
    from datahub.sdk.main_client import DataHubClient as SdkClient
    from datahub_agent_context import set_client
    from datahub_agent_context.mcp_tools import get_entities, get_lineage, search

    ACK_AVAILABLE = True
except Exception as e:  # pragma: no cover - import environment
    _ACK_ERROR = str(e)
    SdkClient = None  # type: ignore
    set_client = None  # type: ignore
    search = get_entities = get_lineage = None  # type: ignore


def _gms() -> str:
    return (os.getenv("DATAHUB_GMS_URL") or "http://localhost:8080").rstrip("/")


def _token() -> Optional[str]:
    t = (os.getenv("DATAHUB_GMS_TOKEN") or "").strip()
    return t or None


@lru_cache(maxsize=1)
def _sdk_client():
    """Process-wide SDK client (safe to reuse). ContextVar must be re-bound per call."""
    if not ACK_AVAILABLE:
        raise RuntimeError(f"datahub-agent-context unavailable: {_ACK_ERROR}")
    return SdkClient(server=_gms(), token=_token())


def ensure_client() -> bool:
    """Bind ACK ContextVar for *this* request/thread. Returns False if ACK missing."""
    if not ACK_AVAILABLE:
        return False
    try:
        set_client(_sdk_client())
        return True
    except Exception as e:
        log.warning("ACK client bind failed: %s", e)
        return False


def status() -> dict[str, Any]:
    bound = False
    err = _ACK_ERROR
    if ACK_AVAILABLE:
        try:
            bound = ensure_client()
        except Exception as e:
            err = str(e)
    return {
        "ackAvailable": ACK_AVAILABLE,
        "ackBound": bound,
        "package": "datahub-agent-context",
        "gms": _gms(),
        "tools": ["search", "get_entities", "get_lineage"] if ACK_AVAILABLE else [],
        "error": err,
    }


def ack_search(query: str, num_results: int = 10, filter: Optional[str] = None) -> dict[str, Any]:
    if not ensure_client():
        return {"ok": False, "error": _ACK_ERROR or "ACK unavailable", "searchResults": []}
    q = query.strip()
    if not q.startswith("/q") and q != "*":
        # ACK docs recommend structured /q syntax
        q = f"/q {q}"
    try:
        out = search(query=q, filter=filter, num_results=num_results)
        if isinstance(out, dict):
            out = {**out, "ok": True, "skill": "datahub-search", "via": "agent-context-kit"}
        return out
    except Exception as e:
        log.warning("ACK search failed: %s", e)
        return {"ok": False, "error": str(e), "searchResults": [], "skill": "datahub-search"}


def ack_get_entities(urns: list[str]) -> dict[str, Any]:
    if not ensure_client():
        return {"ok": False, "error": _ACK_ERROR or "ACK unavailable", "entities": []}
    try:
        entities = get_entities(urns=urns)
        return {
            "ok": True,
            "entities": entities,
            "skill": "datahub-enrich",
            "via": "agent-context-kit",
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "entities": []}


def ack_get_lineage(
    urn: str,
    *,
    upstream: bool = True,
    max_hops: int = 2,
    max_results: int = 30,
) -> dict[str, Any]:
    if not ensure_client():
        return {"ok": False, "error": _ACK_ERROR or "ACK unavailable"}
    try:
        out = get_lineage(
            urn=urn, upstream=upstream, max_hops=max_hops, max_results=max_results
        )
        if isinstance(out, dict):
            out = {**out, "ok": True, "skill": "datahub-lineage", "via": "agent-context-kit"}
        return out
    except Exception as e:
        return {"ok": False, "error": str(e), "skill": "datahub-lineage"}


def _parse_skill_md(path: Path, repo_root: Path, source: str) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    name = path.parent.name
    desc = ""
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            # description may be multiline YAML "|"
            fm = parts[1]
            for line in fm.splitlines():
                if line.startswith("name:"):
                    name = line.split(":", 1)[1].strip()
            if "description:" in fm:
                after = fm.split("description:", 1)[1]
                if after.lstrip().startswith("|"):
                    # take indented block until blank/non-indent
                    lines = []
                    for ln in after.splitlines()[1:]:
                        if ln.startswith("  ") or ln.startswith("\t"):
                            lines.append(ln.strip())
                        elif not ln.strip():
                            break
                        else:
                            break
                    desc = " ".join(lines)[:240]
                else:
                    desc = after.strip().splitlines()[0].strip()[:240]
            body = parts[2].strip()
    try:
        rel = str(path.relative_to(repo_root))
    except ValueError:
        rel = str(path)
    return {
        "name": name,
        "description": desc,
        "path": rel,
        "source": source,
        "bodyPreview": body[:400],
        "bytes": path.stat().st_size,
    }


def load_skills(skills_root: Optional[Path] = None) -> list[dict[str, Any]]:
    """Load official datahub-skills (`.agents/skills`) + Residence composition skills."""
    repo = Path(__file__).resolve().parent.parent
    roots = [
        (repo / ".agents" / "skills", "datahub-project/datahub-skills"),
        (skills_root or repo / "skills-config", "residence/skills-config"),
    ]
    by_name: dict[str, dict[str, Any]] = {}
    for root, source in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("SKILL.md")):
            # Prefer official pack when names collide (first root wins unless residence-only)
            skill = _parse_skill_md(path, repo, source)
            name = skill["name"]
            if name not in by_name:
                by_name[name] = skill
            elif source.startswith("datahub-project") and not by_name[name]["source"].startswith(
                "datahub-project"
            ):
                by_name[name] = skill
    skills = list(by_name.values())
    skills.sort(key=lambda s: s["name"])
    return skills
