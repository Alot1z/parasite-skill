import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, composePayload, mergeConfig } from "../src/engine.js";
import { auditSkillTools, filterToolsByPolicy, listSkillTools, policyFor, readToolRuns, runSkillTool, validateToolArgs } from "../src/ai-tools.js";
import { cmdTools } from "../src/commands/tools.js";
import { cmdAgentsRun } from "../src/commands/agents-run.js";
import { cmdAgentsList } from "../src/commands/agents-list.js";
import { cmdTrace } from "../src/commands/trace.js";
import { cmdLlm } from "../src/commands/llm.js";
import { buildEcosystemGraph, publicGraph } from "../src/ecosystem-graph.js";
import { handleMessage } from "../src/mcp-server.js";

const bases: string[] = [];
const envBackups: Array<[string, string | undefined]> = [];

function tempSkills(files: Record<string, string>) {
  const base = join(tmpdir(), `sr-ai-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  bases.push(base);
  const dirs = join(base, ".agents", "skills");
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dirs, rel);
    mkdirSync(target.slice(0, target.lastIndexOf("/")) || target, { recursive: true });
  }
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dirs, rel), content);
  // Isolate loadRegistry's default scan dirs so tests never see or execute the
  // real user skills on this machine.
  envBackups.push(["PARASITE_SKILL_HOME", process.env.PARASITE_SKILL_HOME]);
  process.env.PARASITE_SKILL_HOME = base;
  return { base, dirs, registry: join(base, "registry") };
}

afterEach(() => {
  for (const [key, value] of envBackups.splice(0)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
});

const PY = process.env.PARASITE_SKILL_PYTHON || (process.platform === "win32" ? "python" : "python3");

describe("AI-tools discovery and execution", () => {
  test("discovers python/js/shell tools and skips non-runnable assets", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello from demo")\n',
      "demo-skill/scripts/notes.txt": "not a tool",
      "demo-skill/hooks/check.sh": "#!/usr/bin/env bash\necho checked\n",
      "demo-skill/references/guide.md": "no group match",
    });
    const tools = listSkillTools(scan([dirs]));
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("demo-skill__hello");
    expect(names).toContain("demo-skill__check");
    expect(["python", "python3"]).toContain(tools.find((tool) => tool.name === "demo-skill__hello").command);
    expect(names.some((name) => name.includes("notes"))).toBe(false);
    expect(names.some((name) => name.includes("guide"))).toBe(false);
  });

  test("runs a python tool with arguments and returns captured output", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/echo.py": "import sys\nprint('argc=' + str(len(sys.argv) - 1))\nprint('first=' + (sys.argv[1] if len(sys.argv) > 1 else 'none'))\n",
    });
    const payload = scan([dirs]);
    const result = runSkillTool(payload, "demo-skill__echo", "alpha beta");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("argc=2");
    expect(result.stdout).toContain("first=alpha");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("redacts credential and path patterns from tool output", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/leak.py": "print('token=abc123 owner@example.com at C:/Users/private/project')\n",
    });
    const result = runSkillTool(scan([dirs]), "demo-skill__leak");
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("token=<redacted>");
    expect(result.stdout).toContain("<email-redacted>");
    expect(result.stdout).toContain("<path-redacted>");
    expect(result.stdout).not.toContain("abc123");
    expect(result.stdout).not.toContain("owner@example.com");
    expect(result.stdout).not.toContain("C:/Users/private/project");
  });

  test("unknown and missing tools fail cleanly", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    const payload = scan([dirs]);
    expect(() => runSkillTool(payload, "does-not-exist")).toThrow("unknown skill tool");
  });

  test("tools CLI lists, describes, and runs", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello from demo")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...args) => out.push(args.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "list" })).toBe(0);
      expect(out.join("\n")).toContain("demo-skill__hello");
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "describe", name: "demo-skill__hello" })).toBe(0);
      expect(out.join("\n")).toContain('"name": "demo-skill__hello"');
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "run", name: "demo-skill__hello" })).toBe(0);
      expect(out.join("\n")).toContain("hello from demo");
      expect(cmdTools({ registry, dirs, toolsAction: "run", name: "nope" })).toBe(2);
    } finally {
      console.log = orig;
    }
  });
});

describe("agents run executor", () => {
  test("routes, runs selected skill tools, asserts guardrails, saves report", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected: ' + ' '.join(sys.argv[1:]))\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...args) => out.push(args.join(" "));
    try {
      const code = cmdAgentsRun({
        registry,
        dirs,
        _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"],
        maxTools: 4,
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("agent run: ecosystem-architect");
      expect(out.join("\n")).toContain("inspected:");
      const reports = readdirSync(join(registry, "agents"));
      const json = reports.find((name) => name.endsWith(".json"));
      expect(json).toBeTruthy();
      const report = JSON.parse(readFileSync(join(registry, "agents", json as string), "utf-8"));
      expect(report.kind).toBe("parasite-skill-agent-run");
      expect(report.guardrails.length).toBeGreaterThan(0);
      expect(report.guardrails.every((entry: { status: string }) => entry.status === "declared")).toBe(true);
      expect(report.tool_runs.some((run: { name: string }) => run.name === "demo-skill__inspect")).toBe(true);
      expect(report.summary).toContain("tools succeeded");
    } finally {
      console.log = orig;
    }
  });

  test("unknown profile exits 1", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "no-such-profile", "x"] })).toBe(1);
  });
});

describe("auto-max routing", () => {
  test("--auto pins the always-on cadence around routed skills", () => {
    const { dirs } = tempSkills({
      "debug-skill/SKILL.md": "---\nname: debug-skill\ndescription: Debug failing tests.\n---\n",
      "docs-skill/SKILL.md": "---\nname: docs-skill\ndescription: Write documentation.\n---\n",
    });
    const payload = scan([dirs]);
    const runtime = composePayload(payload, "debug failing tests", { auto: true, top: 3 });
    expect(runtime.decision.auto).toBe(true);
    expect(runtime.execution.order[0]).toBe("tractatus-thinking");
    expect(runtime.execution.order[1]).toBe("sequential-thinking");
    expect(runtime.execution.order).toContain("debug-skill");
    expect(runtime.execution.order.at(-1)).toBe("code-review-and-quality");
    const plain = composePayload(payload, "debug failing tests", { top: 3 });
    expect(plain.decision.auto).toBe(false);
    expect(plain.execution.order[0]).toBe("debug-skill");
    expect(plain.execution.order).not.toContain("tractatus-thinking");
  });
});

describe("MCP skill tools", () => {
  test("tools/list exposes skill_tools_list and skill_tools_run", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const names = res.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("skill_tools_list");
    expect(names).toContain("skill_tools_run");
  });

  test("tools/call skill_tools_run executes a discovered tool", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello from demo")\n',
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "skill_tools_run", arguments: { name: "demo-skill__hello", dirs, registry } },
    });
    expect(res.result.content[0].text).toContain('"ok": true');
    expect(res.result.content[0].text).toContain("hello from demo");
  });

  test("tools/call skill_tools_list returns the tool inventory", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "skill_tools_list", arguments: { dirs, registry } },
    });
    expect(res.result.content[0].text).toContain("demo-skill__hello");
  });

  test("tools/call skill_tools_run with unknown tool reports a failure result", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "skill_tools_run", arguments: { name: "nope", dirs, registry } },
    });
    expect(res.result.content[0].text).toContain('"ok": false');
  });
});

describe("Python MCP twin parity", () => {
  test("python twin exposes skill_tools_list and skill_tools_run", () => {
    const code = "import json, sys; sys.path.insert(0, 'skill/scripts'); import mcp_server; print(json.dumps([t['name'] for t in mcp_server.TOOLS]))";
    const names = JSON.parse(execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim());
    expect(names).toContain("skill_tools_list");
    expect(names).toContain("skill_tools_run");
    expect(names).toContain("graph");
  });

  test("python twin skill_tools_run executes a tool", () => {
    const base = join(tmpdir(), `sr-py-run-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hello py run")\n');
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({
        skills: [{ name: "demo-skill", path: skillDir, assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }] }],
      }),
    );
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_run', {'name': 'demo-skill__hello'})",
      "print(json.loads(text)['ok'])",
    ].join("; ");
    const ok = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(ok).toBe("True");
  });

  test("python twin skill_tools_list returns a JSON inventory", () => {
    const base = join(tmpdir(), `sr-py-tools-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({
        skills: [
          {
            name: "demo-skill",
            path: join(base, ".agents", "skills", "demo-skill"),
            assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }],
          },
        ],
      }),
    );
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_list', {})",
      "print(json.loads(text)[0]['name'])",
    ].join("; ");
    const name = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(name).toBe("demo-skill__hello");
  });

  test("python twin skill_tools_audit returns a static risk audit", () => {
    const base = join(tmpdir(), `sr-py-audit-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "danger.py"), "import os\nos.system('curl http://x')\n");
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({ skills: [{ name: "demo-skill", path: skillDir, assets: [{ path: "scripts/danger.py", group: "scripts", language: "python" }] }] }),
    );
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_audit', {})",
      "print(json.loads(text)[0]['risk'])",
    ].join("; ");
    const risk = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(risk).toBe("high");
  });

  test("python twin skill_tools_docs returns a TOOLS.md reference", () => {
    const base = join(tmpdir(), `sr-py-docs-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hi")\n');
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({ skills: [{ name: "demo-skill", path: skillDir, assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }] }] }),
    );
    const code = [
      "import os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_docs', {})",
      "print('demo-skill__hello' in text)",
    ].join("; ");
    const ok = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(ok).toBe("True");
  });

  test("python twin skill_tools_run enforces deny policy", () => {
    const base = join(tmpdir(), `sr-py-deny-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hi")\n');
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({ skills: [{ name: "demo-skill", path: skillDir, assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }] }] }),
    );
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_run', {'name': 'demo-skill__hello', 'deny': ['demo-skill__*']})",
      "print(json.loads(text)['error'])",
    ].join("; ");
    const error = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(error).toContain("denied");
  });
});

describe("tool policy, env, dry-run, audit, ledger", () => {
  test("deny wins and allowlist gates execution", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello")\n',
    });
    const payload = scan([dirs]);
    expect(() => runSkillTool(payload, "demo-skill__hello", "", { policy: { deny: ["demo-skill__*"] } })).toThrow("denied");
    expect(() => runSkillTool(payload, "demo-skill__hello", "", { policy: { allow: ["other__*"] } })).toThrow("not in project allowlist");
    expect(runSkillTool(payload, "demo-skill__hello", "", { policy: { allow: ["demo-skill__*"] } }).ok).toBe(true);
    expect(filterToolsByPolicy(listSkillTools(payload), { deny: ["demo-skill__*"] })).toHaveLength(0);
  });

  test("env filtering hides unlisted environment keys from tools", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/envcheck.py": "import os\nprint('has_secret=' + ('yes' if 'MY_PRIVATE_SECRET' in os.environ else 'no'))\n",
    });
    process.env.MY_PRIVATE_SECRET = "topsecret";
    try {
      const payload = scan([dirs]);
      expect(runSkillTool(payload, "demo-skill__envcheck", "", { policy: { env: ["PATH"] } }).stdout).toContain("has_secret=no");
      expect(runSkillTool(payload, "demo-skill__envcheck").stdout).toContain("has_secret=yes");
    } finally {
      delete process.env.MY_PRIVATE_SECRET;
    }
  });

  test("dry-run previews without executing", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/marker.py": "open('marker.txt','w').write('ran')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "dry-run", name: "demo-skill__marker" })).toBe(0);
      expect(out.join("\n")).toContain('"would_execute": true');
      expect(existsSync(join(dirs, "demo-skill", "marker.txt"))).toBe(false);
    } finally {
      console.log = orig;
    }
  });

  test("static audit flags risky patterns and gates on threshold", () => {
    const { dirs, registry } = tempSkills({
      "safe-skill/SKILL.md": "---\nname: safe-skill\ndescription: Safe tooling.\n---\n",
      "safe-skill/scripts/benign.py": "print('hi')\n",
      "risky-skill/SKILL.md": "---\nname: risky-skill\ndescription: Risky tooling.\n---\n",
      "risky-skill/scripts/danger.py": "import os\nos.system('curl http://x')\n",
    });
    const audits = auditSkillTools(scan([dirs]));
    const risky = audits.find((entry) => entry.name === "risky-skill__danger");
    expect(risky.risk).toBe("high");
    expect(risky.flags.some((flag) => flag.level === "high")).toBe(true);
    expect(audits.find((entry) => entry.name === "safe-skill__benign").risk).toBe("low");
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "audit", threshold: "high" })).toBe(1);
      expect(out.join("\n")).toContain("risky-skill__danger");
    } finally {
      console.log = orig;
    }
  });

  test("run ledger records, history lists, and clear resets", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello")\n',
    });
    const payload = scan([dirs]);
    runSkillTool(payload, "demo-skill__hello", "", { registry });
    const entries = readToolRuns(registry);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("demo-skill__hello");
    expect(entries[0].status).toBe(0);
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "history" })).toBe(0);
      expect(out.join("\n")).toContain("demo-skill__hello");
      expect(cmdTools({ registry, dirs, toolsAction: "history", clear: true })).toBe(0);
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });
});

describe("tools in the ecosystem graph", () => {
  test("tool nodes link to skills with provides edges and stay public-safe", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    const graph = buildEcosystemGraph({ skills: payload.skills, sets: {}, tools: listSkillTools(payload) });
    const toolNode = graph.nodes.find((node) => node.type === "tool");
    expect(toolNode).toBeTruthy();
    expect(toolNode.command).toBeTruthy();
    expect(graph.edges.some((edge) => edge.relation === "provides" && edge.from === "skill:demo-skill")).toBe(true);
    const published = publicGraph(graph);
    expect(Object.hasOwn(published.nodes.find((node) => node.type === "tool"), "path")).toBe(false);
  });
});

describe("agents run --all", () => {
  test("runs every profile once, dedupes tools, writes combined report", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected: ' + ' '.join(sys.argv[1:]))\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, all: true, _: ["agents", "run", "--all", "debug", "failing", "tests"], maxTools: 2 })).toBe(0);
      expect(out.join("\n")).toContain("all 6 profiles");
      const reports = readdirSync(join(registry, "agents"));
      const json = reports.find((name) => name.startsWith("all-"));
      const combined = JSON.parse(readFileSync(join(registry, "agents", json as string), "utf-8"));
      expect(combined.kind).toBe("parasite-skill-agent-run-all");
      expect(combined.reports.length).toBe(6);
      const demoRuns = combined.reports.flatMap((report) => report.tool_runs).filter((run) => run.name === "demo-skill__inspect");
      expect(demoRuns.length).toBe(1);
    } finally {
      console.log = orig;
    }
  });
});

describe("llm native tool calling", () => {
  test("executes model tool calls and loops back the results", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello from demo")\n',
    });
    const originalFetch = globalThis.fetch;
    const bodies: any[] = [];
    let calls = 0;
    globalThis.fetch = async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "demo-skill__hello", arguments: "{}" } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "final grounded answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(await cmdLlm({ request: "debug failing tests", endpoint: "http://localhost:1234/v1", model: "test-model", registry, dirs, maxChars: 200 })).toBe(0);
      expect(out.join("\n")).toContain("final grounded answer");
      expect(bodies.length).toBe(2);
      expect(bodies[0].tools.some((tool: any) => tool.function.name === "demo-skill__hello")).toBe(true);
      const toolMsg = bodies[1].messages.find((m: any) => m.role === "tool");
      expect(toolMsg).toBeTruthy();
      expect(toolMsg.content).toContain("hello from demo");
    } finally {
      console.log = orig;
      globalThis.fetch = originalFetch;
    }
  });

  test("--no-tools omits the tools surface", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const originalFetch = globalThis.fetch;
    let receivedBody: any;
    globalThis.fetch = async (_url: any, options: any) => {
      receivedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(await cmdLlm({ request: "x", endpoint: "http://localhost:1234/v1", model: "m", registry, dirs, noTools: true })).toBe(0);
      expect(receivedBody.tools).toBeUndefined();
      expect(out.join("\n")).toContain("plain answer");
    } finally {
      console.log = orig;
      globalThis.fetch = originalFetch;
    }
  });
});

describe("project tools config", () => {
  test("mergeConfig parses tools allow/deny/env and env-filter overrides", () => {
    const merged = mergeConfig({ tools: { allow: ["a__*"], deny: ["b__*"], env: ["PATH"] } }, {});
    expect(merged.tools).toEqual({ allow: ["a__*"], deny: ["b__*"], env: ["PATH"] });
    const overridden = mergeConfig({ tools: { allow: ["a__*"], env: ["PATH"] } }, { envFilter: "HOME,PATH" });
    expect(overridden.tools.env).toEqual(["HOME", "PATH"]);
    expect(overridden.tools.allow).toEqual(["a__*"]);
    const invalid = mergeConfig({ tools: { allow: "nope" } }, {});
    expect(invalid.tools).toBeUndefined();
  });

  test("mergeConfig parses tools.timeoutMs as a project default", () => {
    const merged = mergeConfig({ tools: { allow: ["a__*"], timeoutMs: 45000 } }, {});
    expect(merged.tools.timeoutMs).toBe(45000);
    expect(merged.tools.allow).toEqual(["a__*"]);
    expect(mergeConfig({ tools: { timeoutMs: 500 } }, {}).tools).toBeUndefined();
  });
});

describe("args schema validation", () => {
  const typedTool = {
    name: "x__y",
    argsSchema: {
      type: "object",
      properties: {
        port: { type: "integer" },
        mode: { type: "string", enum: ["a", "b"] },
      },
      required: ["port"],
    },
  };

  test("structured json args are validated against the declared schema", () => {
    expect(validateToolArgs(typedTool, "", { port: 8080, mode: "a" })).toEqual({ port: 8080, mode: "a" });
    expect(() => validateToolArgs(typedTool, "", { mode: "a" })).toThrow(/missing required arg/);
    expect(() => validateToolArgs(typedTool, "", { port: "x" })).toThrow(/must be an integer/);
    expect(() => validateToolArgs(typedTool, "", { port: 1, mode: "z" })).toThrow(/must be one of/);
    expect(() => validateToolArgs(typedTool, "", { port: 1, extra: true })).toThrow(/unknown arg/);
  });

  test("positional mode honors maxLength and required schemas", () => {
    const capped = { name: "c", argsSchema: { type: "object", properties: { args: { type: "string", maxLength: 3 } } } };
    expect(validateToolArgs(capped, "ab", undefined)).toBeNull();
    expect(() => validateToolArgs(capped, "abcd", undefined)).toThrow(/maxLength/);
    expect(() => validateToolArgs(typedTool, "x", undefined)).toThrow(/requires structured/);
    expect(() => validateToolArgs({ name: "n" }, "", { x: 1 })).toThrow(/no argsSchema/);
  });

  test("tools run --json-args executes with deterministic key=value argv and exit 3 on invalid", () => {
    const { dirs, registry } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__hello": {',
        '    "argsSchema": { "type": "object", "properties": { "port": { "type": "integer" } }, "required": ["port"] }',
        "  }}",
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/hello.py": "import sys\nprint('port=' + next((a for a in sys.argv[1:] if a.startswith('port=')), 'missing'))\n",
    });
    const origLog = console.log;
    const origErr = console.error;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    console.error = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run", name: "meta-skill__hello", jsonArgs: '{"port": 8080}' })).toBe(0);
      expect(out.join("\n")).toContain("port=8080");
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "run", name: "meta-skill__hello", jsonArgs: '{"port": "bad"}' })).toBe(3);
      expect(out.join("\n")).toContain("must be an integer");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  test("tools run --tool-env injects inline env for one run", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/envtool.py": "import os\nprint('TOOL_VAR=' + os.environ.get('TOOL_VAR', 'unset'))\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run", name: "demo-skill__envtool", toolEnv: "TOOL_VAR=hi" })).toBe(0);
      expect(out.join("\n")).toContain("TOOL_VAR=hi");
    } finally {
      console.log = orig;
    }
  });
});

describe("tools policy editor", () => {
  test("writes allow/deny/env/timeoutMs into a config file and dry-run does not", () => {
    const { base, dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    const configPath = join(base, "parasite-skill.json");
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(
        cmdTools({
          registry,
          dirs,
          toolsAction: "policy",
          policyFile: configPath,
          policyAllow: "a__*,b__*",
          policyDeny: "c__*",
          policyTimeoutMs: "45000",
        }),
      ).toBe(0);
      expect(out.join("\n")).toContain("written");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.tools.allow).toEqual(["a__*", "b__*"]);
      expect(config.tools.deny).toEqual(["c__*"]);
      expect(config.tools.timeoutMs).toBe(45000);
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "policy", policyFile: configPath, policyDryRun: true, policyDeny: "d__*" })).toBe(0);
      expect(out.join("\n")).toContain("dry-run");
      expect(JSON.parse(readFileSync(configPath, "utf-8")).tools.deny).toEqual(["c__*"]);
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "policy", policyFile: configPath, scoped: "profile:security-auditor", scopedDeny: "*__deploy*" })).toBe(0);
      const updated = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(updated.tools.scoped["profile:security-auditor"].deny).toEqual(["*__deploy*"]);
    } finally {
      console.log = orig;
    }
  });

  test("--drop-policy removes the tools block entirely", () => {
    const { base, dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    const configPath = join(base, "parasite-skill.json");
    writeFileSync(configPath, JSON.stringify({ tools: { deny: ["c__*"] } }, null, 2));
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "policy", policyFile: configPath, dropPolicy: true })).toBe(0);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.tools).toBeUndefined();
    } finally {
      console.log = orig;
    }
  });
});

describe("agents run dry-run and trace aggregation", () => {
  test("agents run --dry-run previews commands without executing or recording", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], dryRun: true, maxTools: 4 })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("agent dry-run");
      expect(text).toContain("would run");
      expect(text).toContain("demo-skill__inspect");
      expect(existsSync(join(registry, "agents"))).toBe(false);
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });

  test("trace aggregates a directory of transcripts and supports --json", () => {
    const { base, dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
    });
    const logs = join(base, "logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, "a.txt"), "used demo-skill for debugging\n");
    writeFileSync(join(logs, "b.md"), "demo-skill again here\n");
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTrace({ registry, dirs, file: logs })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("files traced: 2");
      expect(text).toContain("skills mentioned in transcripts: 1");
      expect(text).toContain("demo-skill");
      out.length = 0;
      expect(cmdTrace({ registry, dirs, file: logs, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.files.length).toBe(2);
      expect(parsed.skills[0]).toEqual(["demo-skill", 2]);
      expect(parsed.tools).toBeTruthy();
    } finally {
      console.log = orig;
    }
  });
});

describe("MCP skill_tools_docs", () => {
  test("tools/call skill_tools_docs returns the TOOLS.md reference", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "skill_tools_docs", arguments: { dirs, registry } },
    });
    expect(res.result.content[0].text).toContain("# Skill AI-Tools");
    expect(res.result.content[0].text).toContain("demo-skill__hello");
  });
});

describe("scoped tool policy", () => {
  test("policyFor merges profile and set scoped rules over the base", () => {
    const policy = {
      allow: ["a__*"],
      deny: [],
      timeoutMs: 20000,
      scoped: {
        "profile:security-auditor": { deny: ["*__deploy*"], timeoutMs: 90000 },
        "sets:ops": { allow: ["release-skill__*"] },
      },
    };
    const resolved = policyFor(policy, { profile: "security-auditor", sets: ["ops", "review"] });
    expect(resolved.allow).toEqual(["a__*", "release-skill__*"]);
    expect(resolved.deny).toContain("*__deploy*");
    expect(resolved.timeoutMs).toBe(90000);
    expect(resolved.scoped).toBeUndefined();
    const plain = policyFor(policy, {});
    expect(plain.deny).toHaveLength(0);
    expect(plain.timeoutMs).toBe(20000);
    expect(policyFor(null, { profile: "x" })).toBeNull();
  });
});

describe("skill-declared tool metadata", () => {
  test("tools JSON block overrides description and adds argsSchema", () => {
    const { dirs } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__hello": {',
        '    "description": "Custom hello description",',
        '    "argsSchema": { "type": "object", "properties": { "args": { "type": "string" } } }',
        "  }}",
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    expect(payload.skills[0].toolsMeta).toBeTruthy();
    const tool = listSkillTools(payload).find((entry) => entry.name === "meta-skill__hello");
    expect(tool.description).toBe("Custom hello description");
    expect(tool.argsSchema).toBeTruthy();
  });

  test("malformed tools block is ignored without breaking the scan", () => {
    const { dirs } = tempSkills({
      "meta-skill/SKILL.md": "---\nname: meta-skill\ndescription: Tool metadata.\ntools: |\n  not json at all\n---\n",
      "meta-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    expect(payload.skills[0].toolsMeta).toBeUndefined();
    expect(listSkillTools(payload).some((tool) => tool.name === "meta-skill__hello")).toBe(true);
  });
});

describe("tools docs and run-batch", () => {
  test("tools docs writes a TOOLS.md reference", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello from demo")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "docs" })).toBe(0);
      expect(out.join("\n")).toContain("TOOLS.md generated");
      const md = readFileSync(join(registry, "TOOLS.md"), "utf-8");
      expect(md).toContain("demo-skill__hello");
      expect(md).toContain("## Run policy");
    } finally {
      console.log = orig;
    }
  });

  test("tools run-batch runs sequentially, stops on failure, and --continue keeps going", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/ok.py": 'print("ok tool")\n',
      "demo-skill/scripts/bad.py": "import sys; sys.exit(3)\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "demo-skill__ok,demo-skill__bad" })).toBe(1);
      expect(out.join("\n")).toContain("ok tool");
      expect(out.join("\n")).toContain("exit 3");
      expect(readToolRuns(registry).length).toBe(2);
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "demo-skill__bad,demo-skill__ok", continue: true })).toBe(1);
      expect(out.join("\n")).toContain("1/2 succeeded");
    } finally {
      console.log = orig;
    }
  });
});

describe("agents list and show", () => {
  test("agents list inventories profiles and show prints one recipe", () => {
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsList({ _: ["agents", "list"] })).toBe(0);
      expect(out.join("\n")).toContain("ecosystem-architect");
      expect(out.join("\n")).toContain("release-engineer");
      out.length = 0;
      expect(cmdAgentsList({ _: ["agents", "show", "security-auditor"] })).toBe(0);
      expect(out.join("\n")).toContain("agent profile: security-auditor");
      expect(out.join("\n")).toContain("guardrails:");
      expect(cmdAgentsList({ _: ["agents", "show", "no-such"] })).toBe(1);
    } finally {
      console.log = orig;
    }
  });
});

describe("MCP skill_tools_audit", () => {
  test("tools/call skill_tools_audit returns a static risk audit", async () => {
    const { dirs, registry } = tempSkills({
      "risky-skill/SKILL.md": "---\nname: risky-skill\ndescription: Risky tooling.\n---\n",
      "risky-skill/scripts/danger.py": "import os\nos.system('curl http://x')\n",
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "skill_tools_audit", arguments: { dirs, registry } },
    });
    expect(res.result.content[0].text).toContain("risky-skill__danger");
    expect(res.result.content[0].text).toContain('"risk": "high"');
  });
});

describe("trace ledger counts", () => {
  test("trace reports tool runs from the ledger alongside skill mentions", () => {
    const { base, dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello")\n',
    });
    runSkillTool(scan([dirs]), "demo-skill__hello", "", { registry });
    writeFileSync(join(base, "transcript.txt"), "used demo-skill for debugging\n");
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTrace({ registry, dirs, file: join(base, "transcript.txt") })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("skills mentioned in transcripts: 1");
      expect(text).toContain("demo-skill");
      expect(text).toContain("tools executed (ledger): 1 distinct / 1 runs (1 ok)");
      expect(text).toContain("demo-skill__hello");
    } finally {
      console.log = orig;
    }
  });
});
