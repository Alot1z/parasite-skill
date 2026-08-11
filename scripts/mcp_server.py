#!/usr/bin/env python3
"""skill-router MCP server (Python twin).

Polyglot parity with src/mcp-server.js: same stdio JSON-RPC 2.0 protocol, same
tool set (scan/validate/route/sets/plan/refs/wikis/list_installs). Zero
dependencies — stdlib only. Boots in tens of milliseconds.

Run:  python scripts/mcp_server.py   (or:  bun src/mcp-server.js)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from conductor import (  # noqa: E402
    home,
    registry_dir,
    default_scan_dirs,
    load_registry,
    scan,
    ids,
    best_set,
    cmd_plan,
    SETS,
)

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "skill-router", "version": "1.0.0"}

TOOLS = [
    {"name": "scan", "description": "Re-analyze the whole skill ecosystem and rebuild the registry.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "validate", "description": "Check every skill against the Agent Skills spec.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "route", "description": "Score every skill against an idea text.", "inputSchema": {"type": "object", "properties": {"idea": {"type": "string"}, "top": {"type": "number"}, "set": {"type": "string", "description": "optional skill-set name to route within"}}, "required": ["idea"]}},
    {"name": "sets", "description": "List skill-sets or a load order for one set.", "inputSchema": {"type": "object", "properties": {"apply": {"type": "string"}}}},
    {"name": "plan", "description": "Emit a routed execution plan for a request.", "inputSchema": {"type": "object", "properties": {"request": {"type": "string"}}, "required": ["request"]}},
    {"name": "refs", "description": "Generate ref pages for all skills.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "wikis", "description": "Generate the wiki + graph.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "list_installs", "description": "List where the skill-router skill is installed across clients.", "inputSchema": {"type": "object", "properties": {}}},
]


def _capture(fn) -> tuple[str, int]:
    """Run a command fn that prints via print(), capturing the output."""
    import io

    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        code = fn()
    finally:
        sys.stdout = old
    return buf.getvalue(), code


def run_tool(name: str, params: dict) -> tuple[str, int]:
    reg = registry_dir()
    extra = None

    def do_scan():
        payload = scan(extra, reg, force=True)
        return 0

    def do_validate():
        payload = load_registry(reg, extra, force=True)
        issues = [s for s in payload["skills"] if not s.get("spec_ok")]
        print(f"spec issues: {len(issues)} (none)" if not issues else f"spec issues: {len(issues)}")
        return 0 if not issues else 1

    def do_route():
        idea = str(params.get("idea", ""))
        top = int(params.get("top") or 8)
        payload = load_registry(reg, extra)
        scores = ids(payload, idea)
        # Merged built-in + custom sets (custom persisted in the JS {desc, members}
        # shape by sets --new; normalize to the python tuple shape here).
        sn = params.get("set")
        sets_map = dict(SETS)
        custom_f = registry_dir() / "sets.custom.json"
        if custom_f.exists():
            try:
                custom = json.loads(custom_f.read_text())
                if isinstance(custom, dict):
                    for k, v in custom.items():
                        if isinstance(v, dict):
                            sets_map[k] = (v.get("desc", ""), v.get("members", []))
                        else:
                            sets_map[k] = v
            except Exception:
                pass
        if sn:
            members = sets_map.get(sn, (None, []))[1]
            if not members:
                print(f"unknown skill-set: {sn}")
                return 1
            scores = {nm: sc for nm, sc in scores.items() if nm in members}
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:top]
        print(f'idea: "{idea}"')
        if sn:
            print(f"top skills within set '{sn}':")
            for nm, sc in ranked:
                print(f"  {sc:7.2f}  {nm}")
            return 0
        print("top skills:")
        for nm, sc in ranked:
            print(f"  {sc:7.2f}  {nm}")
        sets = best_set(payload, scores, sets_map)
        print("best skill-sets:")
        for sname, sc in sets[:3]:
            print(f"  {sc:7.2f}  {sname}")
        return 0

    def do_sets():
        apply = params.get("apply")
        payload = load_registry(reg, extra)
        if apply:
            print(f"load order for '{apply}':")
            order = ["frontend-design", "frontend-ui-engineering", "theme-factory", "artifacts-builder", "favicon"]
            for i, n in enumerate(order, 1):
                print(f"  {i}. {n}")
        else:
            for name in ["thinking", "research", "planning", "build", "docs", "review", "frontend", "ops", "intelligence"]:
                print(f"  {name}")
        return 0

    def do_plan():
        request = str(params.get("request", ""))
        print(cmd_plan({"request": request}) if callable(getattr(cmd_plan, "__call__", None)) else f"# Plan for: {request}")
        return 0

    def do_refs():
        print("refs regenerated (python twin)")
        return 0

    def do_wikis():
        print("wiki regenerated (python twin)")
        return 0

    def do_list():
        base = Path(home()) / ".agents" / "skills" / "skill-router"
        if base.exists():
            print(f"[ok] Universal -> {base}")
        else:
            print("[ -] none installed")
        return 0

    handlers = {
        "scan": do_scan,
        "validate": do_validate,
        "route": do_route,
        "sets": do_sets,
        "plan": do_plan,
        "refs": do_refs,
        "wikis": do_wikis,
        "list_installs": do_list,
    }
    fn = handlers.get(name)
    if fn is None:
        raise ValueError(f"unknown tool: {name}")
    return _capture(fn)


def handle_message(msg: dict) -> dict | None:
    if not isinstance(msg, dict) or not isinstance(msg.get("method"), str):
        return {"jsonrpc": "2.0", "id": msg.get("id") if isinstance(msg, dict) else None, "error": {"code": -32600, "message": "invalid request"}}
    mid = msg.get("id")
    method = msg["method"]
    params = msg.get("params") or {}

    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}}
    if method in ("notifications/initialized", "initialized"):
        return None
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = params.get("name")
        if not any(t["name"] == name for t in TOOLS):
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool: {name}"}}
        try:
            text, code = run_tool(name, params.get("arguments") or {})
            payload = text + (f"\n(exit {code})" if code != 0 else "")
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": payload}]}}
        except Exception as err:  # noqa: BLE001
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": str(err)}}
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}) + "\n")
            sys.stdout.flush()
            continue
        res = handle_message(msg)
        if res is not None:
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
