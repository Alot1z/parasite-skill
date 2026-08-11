#!/usr/bin/env python3
"""parasite-skill MCP server (Python twin).

Polyglot parity with src/mcp-server.js: same stdio JSON-RPC 2.0 protocol, same
tool set (scan/validate/route/sets/plan/compose/refs/wikis/graph/list_installs/
skill_tools_list/skill_tools_audit/skill_tools_docs/skill_tools_run). Zero
dependencies — stdlib only. Boots in tens of milliseconds.

Run:  python scripts/mcp_server.py   (or:  bun src/mcp-server.js)
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
import time
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
    cmd_compose,
    compose_payload,
    SETS,
    project_sets,
    runtime_sets,
)

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "parasite-skill", "version": "1.1.0"}

def ecosystem_graph(payload: dict, table: dict, fmt: str = "json") -> str:
    """Return a metadata-only ecosystem graph in JSON, DOT, or Mermaid."""
    nodes = []
    edges = []

    def add(kind: str, label: str, **extra):
        node_id = f"{kind}:{label}".replace(" ", "-")
        if not any(node["id"] == node_id for node in nodes):
            nodes.append({"id": node_id, "type": kind, "label": label, **extra})
        return node_id

    runnable_ext = {".py", ".js", ".mjs", ".cjs", ".sh", ".bash"}
    for skill in payload.get("skills", []):
        sid = add("skill", skill["name"], spec_ok=skill.get("spec_ok", True))
        for asset in skill.get("assets", []):
            path = asset.get("path", "")
            aid = add("asset", f"{skill['name']}/{path}", group=asset.get("group"))
            edges.append({"from": sid, "to": aid, "relation": "contains"})
            if asset.get("group") in ("scripts", "hooks", "tools") and path[path.rfind("."):].lower() in runnable_ext:
                tid = add("tool", f"{skill['name']}/{path}")
                edges.append({"from": sid, "to": tid, "relation": "provides"})
    for name, entry in table.items():
        members = entry[1] if isinstance(entry, tuple) else entry.get("members", [])
        set_id = add("set", name)
        for member in members:
            member_id = add("skill", member, unresolved=member not in {s["name"] for s in payload.get("skills", [])})
            edges.append({"from": set_id, "to": member_id, "relation": "includes"})
    for client in ("claude-code", "codex", "cursor", "opencode", "continue", "windsurf"):
        add("client", client, detected="not-queried-by-python-twin")
    for extension in ("runtime-extension", "build-hook", "server-wrapper"):
        add("extension", extension, active="not-queried-by-python-twin")
    for target in ("claude-code", "claude-desktop", "cursor", "continue", "windsurf"):
        add("mcp", target, registered="not-queried-by-python-twin")
    for rule in ("AGENTS.md", "CLAUDE.md", "client-rules", "project-config"):
        add("rule", rule, scope="known-target")
    # Keep the graph schema explicit even when no skills or sets were scanned.
    for kind in ("skill", "set", "asset"):
        add(kind, "<none>", empty=True)
    for name in ("ecosystem-architect", "release-engineer", "security-auditor", "mcp-integrator", "frontend-verifier", "history-recovery"):
        agent_id = add("agent", name)
        for tool in ("scan", "route", "plan", "compose", "graph"):
            tool_id = add("tool", tool)
            edges.append({"from": agent_id, "to": tool_id, "relation": "may-call"})
    graph = {
        "kind": "parasite-skill-ecosystem-graph",
        "version": 1,
        "node_types": ["skill", "set", "asset", "client", "extension", "mcp", "rule", "agent", "tool"],
        "nodes": sorted(nodes, key=lambda node: node["id"]),
        "edges": edges,
        "privacy": "names and metadata only; no contents, secrets, environment values, or chat history",
        "inventory_note": "client, extension, MCP, and rule nodes are known targets only; the Python twin does not query JavaScript client state",
    }
    if fmt == "dot":
        lines = ["digraph ecosystem {", "  rankdir=LR;"]
        for node in graph["nodes"]:
            label = str(node["label"]).replace('"', '\\\"')
            lines.append(f'  "{node["id"]}" [label="{label}"];')
        for edge in graph["edges"]:
            lines.append(f'  "{edge["from"]}" -> "{edge["to"]}" [label="{edge["relation"]}"];')
        return "\\n".join(lines + ["}"])
    if fmt == "mmd":
        lines = ["flowchart LR"]
        for node in graph["nodes"]:
            safe = re.sub(r"[^A-Za-z0-9_]", "_", node["id"])
            lines.append(f"  {safe}[{node['type']}: {node['label']}]")
        for edge in graph["edges"]:
            source = re.sub(r"[^A-Za-z0-9_]", "_", edge["from"])
            target = re.sub(r"[^A-Za-z0-9_]", "_", edge["to"])
            lines.append(f"  {source} -->|{edge['relation']}| {target}")
        return "\\n".join(lines)
    return json.dumps(graph, indent=2)


TOOLS = [
    {"name": "scan", "description": "Re-analyze the whole skill ecosystem and rebuild the registry.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "validate", "description": "Check every skill against the Agent Skills spec.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "route", "description": "Score every skill against an idea text.", "inputSchema": {"type": "object", "properties": {"idea": {"type": "string"}, "top": {"type": "number"}, "set": {"type": "string", "description": "optional skill-set name to route within"}}, "required": ["idea"]}},
    {"name": "sets", "description": "List skill-sets or a load order for one set.", "inputSchema": {"type": "object", "properties": {"apply": {"type": "string"}}}},
    {"name": "plan", "description": "Emit a concise routed execution plan backed by selected skills.", "inputSchema": {"type": "object", "properties": {"request": {"type": "string"}, "top": {"type": "number"}, "maxChars": {"type": "number"}, "enabledSets": {"type": "array", "items": {"type": "string"}}, "excludeSkills": {"type": "array", "items": {"type": "string"}}}, "required": ["request"]}},
    {"name": "compose", "description": "Select relevant skills and bounded assets without dumping the ecosystem.", "inputSchema": {"type": "object", "properties": {"idea": {"type": "string"}, "top": {"type": "number"}, "maxChars": {"type": "number"}, "enabledSets": {"type": "array", "items": {"type": "string"}}, "excludeSkills": {"type": "array", "items": {"type": "string"}}}, "required": ["idea"]}},
    {"name": "refs", "description": "Generate ref pages for all skills.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "wikis", "description": "Generate the wiki + graph.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "graph", "description": "Emit a typed ecosystem graph of skills, sets, assets, agents, and tools.", "inputSchema": {"type": "object", "properties": {"format": {"type": "string", "enum": ["json", "dot", "mmd"]}}}},
    {"name": "list_installs", "description": "List where the parasite-skill skill is installed across clients.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "skill_tools_list", "description": "Inventory callable skill AI-tools (scripts, hooks, tools) from the shared registry.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "skill_tools_audit", "description": "Static risk audit of discovered skill AI-tools (eval/subprocess/network/secrets patterns). Never executes anything.", "inputSchema": {"type": "object", "properties": {"threshold": {"type": "string"}}}},
    {"name": "skill_tools_docs", "description": "Return a TOOLS.md-style reference of the callable skill AI-tool surface.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "skill_tools_run", "description": "Explicitly execute one skill AI-tool. Bounded, captured, and redacted; never runs automatically.", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "args": {"type": "string"}, "timeout_ms": {"type": "number"}, "allow": {"type": "array", "items": {"type": "string"}}, "deny": {"type": "array", "items": {"type": "string"}}, "env": {"type": "array", "items": {"type": "string"}}}, "required": ["name"]}},
]


RISK_PATTERNS = [
    ("high", re.compile(r"(?:eval|Function)\s*\(", re.IGNORECASE)),
    ("high", re.compile(r"\bos\.system\s*\(", re.IGNORECASE)),
    ("high", re.compile(r"\bsubprocess\b", re.IGNORECASE)),
    ("high", re.compile(r"\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\b", re.IGNORECASE)),
    ("high", re.compile(r"System\.Diagnostics", re.IGNORECASE)),
    ("medium", re.compile(r"\bfetch\s*\(", re.IGNORECASE)),
    ("medium", re.compile(r"\bhttps?://", re.IGNORECASE)),
    ("medium", re.compile(r"\b(?:requests|urllib|http)\.", re.IGNORECASE)),
    ("medium", re.compile(r"\bsocket\b", re.IGNORECASE)),
    ("medium", re.compile(r"\b(?:curl|wget)\b", re.IGNORECASE)),
    ("medium", re.compile(r"\b(?:writeFile|writeFileSync|appendFileSync)\s*\(", re.IGNORECASE)),
    ("medium", re.compile(r"\bopen\s*\([^)]*['\"]w", re.IGNORECASE)),
    ("medium", re.compile(r"\b(?:os\.environ|process\.env)\b", re.IGNORECASE)),
    ("medium", re.compile(r"\b(?:rmSync|rmtree|unlink|rm -rf)\b", re.IGNORECASE)),
]



def _redact(text: str) -> str:
    """Best-effort redaction of credentials, paths, and emails in tool output."""
    text = re.sub(r"-----BEGIN [^-]+ PRIVATE KEY-----\S*?-----END [^-]+ PRIVATE KEY-----", "<private-key-redacted>", text, flags=re.IGNORECASE)
    text = re.sub(r"\bBearer\s+[^\s,;]+", "Bearer <redacted>", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+", lambda m: m.group(0).split(":", 1)[0].split("=", 1)[0] + "=<redacted>", text, flags=re.IGNORECASE)
    out = []
    for token in text.split():
        if "@" in token and "." in token:
            out.append("<email-redacted>")
        elif re.match(r"^[A-Za-z]:", token) or token.startswith("/"):
            out.append("<path-redacted>")
        else:
            out.append(token)
    return " ".join(out)


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
        sets_map = runtime_sets(reg)
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
        table = runtime_sets(reg)
        names = {s["name"] for s in payload["skills"]}
        if apply:
            entry = table.get(apply)
            if not entry:
                print(f"unknown set '{apply}'. available: {', '.join(table)}")
                return 1
            print(f"set '{apply}': {entry[0]}")
            for i, m in enumerate(entry[1], 1):
                print(f"  {i}. {m}" + ("" if m in names else "  (not installed)"))
            return 0
        for name, (desc, members) in table.items():
            present = sum(1 for m in members if m in names)
            print(f"  {name:14s} {desc:32s} {present}/{len(members)} installed")
        return 0

    def do_plan():
        request = str(params.get("request", ""))
        cmd_plan({
            "request": request,
            "top": int(params.get("top") or 6),
            "max_chars": int(params.get("maxChars") or 9000),
            "enabled_sets": params.get("enabledSets"),
            "exclude_skills": params.get("excludeSkills"),
            "registry": None,
            "dirs": None,
            "force": False,
            "chat_safe": True,
        })
        return 0

    def do_compose():
        idea = str(params.get("idea", ""))
        payload = load_registry(reg, extra)
        runtime = compose_payload(
            payload,
            idea,
            top=int(params.get("top") or 6),
            max_chars=int(params.get("maxChars") or 9000),
            exclude=params.get("excludeSkills"),
            enabled_sets=params.get("enabledSets"),
            sets=runtime_sets(reg),
        )
        runtime["saved"] = "payload/request.json"
        print(json.dumps(runtime, indent=2))
        return 0

    def do_refs():
        print("refs regenerated (python twin)")
        return 0

    def do_wikis():
        print("wiki regenerated (python twin)")
        return 0

    def do_graph():
        payload = load_registry(reg, extra)
        print(ecosystem_graph(payload, runtime_sets(reg), str(params.get("format") or "json")))
        return 0

    def do_list():
        base = Path(home()) / ".agents" / "skills" / "parasite-skill"
        if base.exists():
            print(f"[ok] Universal -> {base}")
        else:
            print("[ -] none installed")
        return 0

    def _declared_timeout_ms(skill: dict, name: str, path: str):
        """Per-tool declared timeoutMs from the skill's tools: frontmatter block
        (mirrors the JS twin's listSkillTools). Returns None when not declared."""
        meta = skill.get("toolsMeta") or {}
        entry = meta.get(name) or meta.get(path) or {}
        timeout = entry.get("timeoutMs") if isinstance(entry, dict) else None
        if isinstance(timeout, (int, float)) and timeout >= 1000:
            return int(timeout)
        return None

    def do_skill_tools_list():
        # Parity listing from the shared registry.json; the Python twin lists
        # tools but defers execution to the JavaScript twin / explicit CLI.
        payload = load_registry(reg, extra)
        runnable = {".py": "python", ".js": "node", ".mjs": "node", ".cjs": "node", ".sh": "bash", ".bash": "bash"}
        tools = []
        for skill in payload.get("skills", []):
            for asset in skill.get("assets", []):
                if asset.get("group") not in ("scripts", "hooks", "tools"):
                    continue
                path = asset.get("path", "")
                ext = path[path.rfind("."):].lower()
                command = runnable.get(ext)
                if not command:
                    continue
                base = path.split("/")[-1].rsplit(".", 1)[0]
                name = re.sub(r"[^a-z0-9_-]+", "_", f"{skill['name']}__{base}".lower()).strip("_")
                entry = {"name": name, "skill": skill["name"], "path": path, "language": asset.get("language") or command, "command": command, "description": base}
                declared = _declared_timeout_ms(skill, name, path)
                if declared is not None:
                    entry["timeoutMs"] = declared
                tools.append(entry)
        print(json.dumps(sorted(tools, key=lambda tool: tool["name"]), indent=2))
        return 0

    def do_skill_tools_audit():
        # Parity with the JS twin: static pattern scan only, never executes.
        payload = load_registry(reg, extra)
        runnable_ext = {".py", ".js", ".mjs", ".cjs", ".sh", ".bash"}
        entries = []
        for skill in payload.get("skills", []):
            for asset in skill.get("assets", []):
                if asset.get("group") not in ("scripts", "hooks", "tools"):
                    continue
                path = asset.get("path", "")
                if path[path.rfind("."):].lower() not in runnable_ext:
                    continue
                script = Path(skill.get("path", ".")) / path
                source = ""
                try:
                    source = script.read_text(encoding="utf-8", errors="ignore")[:64000]
                except OSError:
                    source = ""
                flags = [
                    {"level": level, "pattern": pattern.pattern}
                    for level, pattern in RISK_PATTERNS
                    if pattern.search(source)
                ]
                risk = (
                    "high"
                    if any(f["level"] == "high" for f in flags)
                    else "medium"
                    if any(f["level"] == "medium" for f in flags)
                    else "low"
                )
                base = path.split("/")[-1].rsplit(".", 1)[0]
                name = re.sub(r"[^a-z0-9_-]+", "_", f"{skill['name']}__{base}".lower()).strip("_")
                entries.append({"name": name, "skill": skill["name"], "path": path, "risk": risk, "flags": flags})
        print(json.dumps(entries, indent=2))
        return 0

    def do_skill_tools_docs():
        # Parity with the JS twin: a TOOLS.md-style reference from the shared
        # registry. Only metadata; nothing is executed.
        payload = load_registry(reg, extra)
        runnable = {".py": "python", ".js": "node", ".mjs": "node", ".cjs": "node", ".sh": "bash", ".bash": "bash"}
        rows = []
        for skill in payload.get("skills", []):
            for asset in skill.get("assets", []):
                if asset.get("group") not in ("scripts", "hooks", "tools"):
                    continue
                path = asset.get("path", "")
                ext = path[path.rfind("."):].lower()
                command = runnable.get(ext)
                if not command:
                    continue
                base = path.split("/")[-1].rsplit(".", 1)[0]
                name = re.sub(r"[^a-z0-9_-]+", "_", f"{skill['name']}__{base}".lower()).strip("_")
                rows.append((name, command, skill["name"], base))
        rows.sort()
        lines = [
            "# Skill AI-Tools (TOOLS.md) — python twin",
            "",
            f"{len(rows)} callable tools",
            "",
            "| Tool | Language | Skill | Description |",
            "|---|---|---|---|",
        ]
        lines += [f"| `{name}` | {command} | {skill} | {desc} |" for name, command, skill, desc in rows]
        lines += ["", "Execution is explicit, time-bounded, captured, and redacted. Never automatic."]
        print("\n".join(lines))
        return 0

    def do_skill_tools_run():
        name = str(params.get("name", ""))
        tool_args = str(params.get("args") or "")
        timeout_ms = int(params.get("timeout_ms") or 30000)
        allow = [str(a) for a in (params.get("allow") or [])]
        deny = [str(d) for d in (params.get("deny") or [])]
        env_keys = [str(e) for e in (params.get("env") or [])]
        if any(fnmatch.fnmatch(name, pattern) for pattern in deny):
            print(json.dumps({"ok": False, "name": name, "error": "tool denied by policy"}, indent=2))
            return 1
        if allow and not any(fnmatch.fnmatch(name, pattern) for pattern in allow):
            print(json.dumps({"ok": False, "name": name, "error": "tool not in allowlist"}, indent=2))
            return 1
        run_env = None
        if env_keys:
            run_env = {k: os.environ[k] for k in env_keys if k in os.environ}
            if "PATH" in os.environ:
                run_env["PATH"] = os.environ["PATH"]
        payload = load_registry(reg, extra)
        runnable = {".py": sys.executable, ".js": "node", ".mjs": "node", ".cjs": "node", ".sh": "bash", ".bash": "bash"}
        tools = []
        for skill in payload.get("skills", []):
            for asset in skill.get("assets", []):
                if asset.get("group") not in ("scripts", "hooks", "tools"):
                    continue
                path = asset.get("path", "")
                ext = path[path.rfind("."):].lower()
                command = runnable.get(ext)
                if not command:
                    continue
                base = path.split("/")[-1].rsplit(".", 1)[0]
                tname = re.sub(r"[^a-z0-9_-]+", "_", f"{skill['name']}__{base}".lower()).strip("_")
                tools.append({"name": tname, "skill": skill["name"], "path": path, "command": command, "declared_timeout_ms": _declared_timeout_ms(skill, tname, path)})
        tool = next((t for t in tools if t["name"] == name), None)
        if tool is None:
            print(json.dumps({"ok": False, "name": name, "error": "unknown skill tool"}, indent=2))
            return 1
        skill_dir = next((s["path"] for s in payload.get("skills", []) if s["name"] == tool["skill"]), ".")
        script = str(Path(skill_dir) / tool["path"])
        if not Path(script).exists():
            print(json.dumps({"ok": False, "name": name, "error": "tool file missing"}, indent=2))
            return 1
        # A per-tool declared timeoutMs from the skill's tools: frontmatter block
        # is the fallback when the caller does not pass timeout_ms explicitly.
        if not params.get("timeout_ms") and tool.get("declared_timeout_ms"):
            timeout_ms = tool["declared_timeout_ms"]
        argv = [tool["command"], script] + [a for a in str(tool_args).split() if a]
        started = time.monotonic()
        status, stdout, stderr = 1, "", ""
        try:
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=min(max(timeout_ms, 1000), 300000) / 1000.0, cwd=skill_dir, env=run_env)
            status, stdout, stderr = proc.returncode, proc.stdout or "", proc.stderr or ""
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            stderr = (exc.stderr or "") + f"\n(terminated after {timeout_ms}ms)"
        except OSError as exc:
            stderr = str(exc)
        result = {
            "ok": status == 0,
            "name": name,
            "skill": tool["skill"],
            "command": tool["command"],
            "status": status,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "stdout": _redact(str(stdout))[:200000],
            "stderr": _redact(str(stderr))[:200000],
        }
        print(json.dumps(result, indent=2))
        return 0 if status == 0 else 1

    handlers = {
        "scan": do_scan,
        "validate": do_validate,
        "route": do_route,
        "sets": do_sets,
        "plan": do_plan,
        "compose": do_compose,
        "refs": do_refs,
        "wikis": do_wikis,
        "graph": do_graph,
        "list_installs": do_list,
        "skill_tools_list": do_skill_tools_list,
        "skill_tools_audit": do_skill_tools_audit,
        "skill_tools_docs": do_skill_tools_docs,
        "skill_tools_run": do_skill_tools_run,
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
