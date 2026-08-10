#!/usr/bin/env python3
"""Residence MCP for Claude Desktop — save / check / list pending / resolve."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

CORE = os.environ.get("RESIDENCE_CORE_URL", "http://127.0.0.1:8700").rstrip("/")


def _http(method: str, path: str, body: dict | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = os.environ.get("RESIDENCE_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
        headers["X-Residence-Key"] = key
    req = urllib.request.Request(
        f"{CORE}{path}",
        data=data,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e
    except Exception as e:
        raise RuntimeError(f"Core unreachable at {CORE}: {e}") from e


TOOLS = [
    {
        "name": "save_to_residence",
        "description": (
            "Send text (commitment, allergy, budget, note) to Residence. "
            "Queues a macOS Accept/Decline permission; does not write Facts until the user Accepts."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Utterance or note body"},
                "source": {
                    "type": "string",
                    "description": "Origin label",
                    "default": "claude-mcp",
                },
            },
            "required": ["text"],
        },
    },
    {
        "name": "check_residence_context",
        "description": "Query Residence Facts the user already confirmed (budget, health, commitments).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term, e.g. Budget, Health, Commitment",
                    "default": "Budget",
                }
            },
        },
    },
    {
        "name": "list_residence_pending",
        "description": "List pending Accept/Decline permissions in the Residence Mac inbox.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "resolve_residence_pending",
        "description": "Accept or decline a pending Residence permission by id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "accept": {"type": "boolean", "default": True},
            },
            "required": ["id"],
        },
    },
    {
        "name": "recall_residence_chats",
        "description": (
            "Search Claude/GPT conversations already saved in Residence and queue a "
            "summarized related-chats permission for the user to Accept into Notes. "
            "Use when the user asks what they discussed about a topic or image."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Topic or question, e.g. wardrobe backstage drink photo",
                },
                "use_llm": {
                    "type": "boolean",
                    "description": "Polish the summary with Claude if available",
                    "default": True,
                },
            },
            "required": ["text"],
        },
    },
]


def call_tool(name: str, args: dict[str, Any]) -> str:
    if name == "save_to_residence":
        out = _http(
            "POST",
            "/desktop/capture",
            {"text": args.get("text") or "", "source": args.get("source") or "claude-mcp"},
        )
        return json.dumps(out, indent=2)
    if name == "check_residence_context":
        q = args.get("query") or "Budget"
        out = _http(
            "POST",
            "/facts/query",
            {
                "query": q,
                "requesting_agent_id": "mentor-user",
                "glossary_term": q,
            },
        )
        return json.dumps(out, indent=2)
    if name == "list_residence_pending":
        return json.dumps(_http("GET", "/desktop/pending"), indent=2)
    if name == "resolve_residence_pending":
        out = _http(
            "POST",
            "/desktop/resolve",
            {"id": args["id"], "accept": bool(args.get("accept", True))},
        )
        return json.dumps(out, indent=2)
    if name == "recall_residence_chats":
        out = _http(
            "POST",
            "/desktop/recall",
            {
                "text": args.get("text") or "",
                "source": "claude-mcp",
                "use_llm": bool(args.get("use_llm", True)),
            },
        )
        return json.dumps(out, indent=2)
    raise ValueError(f"unknown tool {name}")


def _send(msg: dict[str, Any]) -> None:
    line = json.dumps(msg, separators=(",", ":"))
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _result(req_id: Any, result: Any) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id: Any, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def handle(msg: dict[str, Any]) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        _result(
            req_id,
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "residence", "version": "0.1.0"},
            },
        )
        return
    if method == "notifications/initialized":
        return
    if method == "tools/list":
        _result(req_id, {"tools": TOOLS})
        return
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            text = call_tool(name, args)
            _result(
                req_id,
                {"content": [{"type": "text", "text": text}], "isError": False},
            )
        except Exception as e:
            _result(
                req_id,
                {
                    "content": [{"type": "text", "text": f"Error: {e}"}],
                    "isError": True,
                },
            )
        return
    if method == "ping":
        _result(req_id, {})
        return
    if req_id is not None:
        _error(req_id, -32601, f"Method not found: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(msg, dict):
            handle(msg)


if __name__ == "__main__":
    main()
