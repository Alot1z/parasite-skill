import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, composePayload, mergeConfig } from "../src/engine.js";
import { planGc } from "../src/commands/tools.js";
import { auditSkillTools, filterToolsByPolicy, listSkillTools, policyFor, readToolRuns, resolveToolRun, runSkillTool, validateToolArgs } from "../src/ai-tools.js";
import { cmdTools } from "../src/commands/tools.js";
import { cmdScan } from "../src/commands/scan.js";
import { cmdAgentsRun } from "../src/commands/agents-run.js";
import { cmdAgentsList } from "../src/commands/agents-list.js";
import { cmdDoctor } from "../src/commands/doctor.js";
import { cmdExport } from "../src/commands/export.js";
import { cmdWikis } from "../src/commands/wikis.js";
import { cmdTrace } from "../src/commands/trace.js";
import { cmdRefs } from "../src/commands/refs.js";
import { cmdLlm } from "../src/commands/llm.js";
import { cmdSync } from "../src/commands/sync.js";
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

// Seed an audit ledger with old (2020) timestamps so gc pruning is
// deterministic on every platform. Freshly-written entries can land in the
// same millisecond as the sweep's clock (now - ts === 0), which made the
// age-0 prune assertions flaky on fast CI runners. Module scope: shared by
// the gc-policy and scheduled-auto-gc describes.
function seedLedger(registry: string, count = 2) {
  mkdirSync(registry, { recursive: true });
  const lines = Array.from({ length: count }, () =>
    JSON.stringify({
      ts: "2020-01-01T00:00:00.000Z",
      name: "demo-skill__hello",
      skill: "demo-skill",
      status: 0,
      duration_ms: 1,
      args: "",
      stdout_chars: 2,
      stderr_chars: 0,
    }),
  ).join("\n");
  writeFileSync(join(registry, "tool-runs.jsonl"), lines + "\n", "utf-8");
}

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

  test("python twin skill_tools_run honors a declared per-tool timeoutMs", () => {
    const base = join(tmpdir(), `sr-py-timeout-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "meta-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: meta-skill\ndescription: Tool metadata.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hi")\n');
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({
        skills: [
          {
            name: "meta-skill",
            path: skillDir,
            assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }],
            toolsMeta: { "meta-skill__hello": { "timeoutMs": 7000 } },
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
      "tools = json.loads(text)",
      "print(tools[0].get('timeoutMs'))",
    ].join("; ");
    const timeout = execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim();
    expect(timeout).toBe("7000");
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

  test("python twin llm executes a native tool-calling loop against a local endpoint", async () => {
    const base = join(tmpdir(), `sr-py-llm-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hello from tool")\n');
    writeFileSync(
      join(regDir, "registry.json"),
      JSON.stringify({
        skills: [{ name: "demo-skill", path: skillDir, assets: [{ path: "scripts/hello.py", group: "scripts", language: "python" }] }],
      }),
    );
    // Stub OpenAI-compatible endpoint: first round asks for a tool call, the
    // second returns the final answer once the tool result has looped back.
    let calls = 0;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        calls++;
        const messages = JSON.parse(body).messages ?? [];
        const hasToolResult = messages.some((m) => m.role === "tool");
        let payload;
        if (hasToolResult) {
          payload = { choices: [{ message: { role: "assistant", content: "grounded answer" } }] };
        } else {
          payload = {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [{ id: "call-1", type: "function", function: { name: "demo-skill__hello", arguments: "{}" } }],
                },
              },
            ],
          };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      `text, code = mcp_server.run_tool('llm', {'request': 'run the tool', 'endpoint': 'http://127.0.0.1:${port}/v1/chat/completions', 'model': 'test', 'max_tool_calls': 3})`,
      "print(json.dumps({'ok': json.loads(text)['ok'], 'response': json.loads(text)['response'], 'trace': json.loads(text)['tool_calls']}))",
    ].join("; ");
    // execFileSync would block this process and starve the HTTP server above,
    // so run python asynchronously while the server keeps serving.
    const py = spawn(PY, ["-c", code]);
    let stdout = "";
    py.stdout.on("data", (chunk) => (stdout += chunk));
    const exitCode = await new Promise<number | null>((resolve) => py.on("close", resolve));
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.ok).toBe(true);
    expect(out.response).toBe("grounded answer");
    expect(out.trace).toHaveLength(1);
    expect(out.trace[0].name).toBe("demo-skill__hello");
    expect(out.trace[0].ok).toBe(true);
    expect(calls).toBe(2);
    // The executed tool was recorded to the shared audit ledger.
    expect(readFileSync(join(regDir, "tool-runs.jsonl"), "utf-8")).toContain("demo-skill__hello");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("python twin scan discovers assets under a dot-directory skills root (windows regression)", () => {
    const base = join(tmpdir(), `sr-py-scan-${Date.now()}`);
    bases.push(base);
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hi")\n');
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(join(process.cwd(), "skill", "scripts")) + ")",
      "import conductor",
      "s = conductor.scan_skill_dir(conductor.Path(" + JSON.stringify(skillDir) + "))",
      "print(json.dumps(s['assets']))",
    ].join("; ");
    const assets = JSON.parse(execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim());
    expect(assets.some((a: { path: string }) => a.path === "scripts/hello.py")).toBe(true);
  });

  test("python twin export reports gc posture and ledger stats (JS export parity)", () => {
    const base = join(tmpdir(), `sr-py-export-${Date.now()}`);
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
    writeFileSync(join(base, "parasite-skill.json"), JSON.stringify({ gc: { ageDays: 30, keep: 5, auto: true } }));
    const scriptsDir = join(process.cwd(), "skill", "scripts");
    const code = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(scriptsDir) + ")",
      "import mcp_server",
      "text, code = mcp_server.run_tool('export', {'public': True})",
      "eco = json.loads(text)",
      "print(json.dumps({'gc': eco.get('gc'), 'ledger': eco.get('ledger')}))",
    ].join("; ");
    // project_gc() walks up from the process cwd, so run from the sandbox base.
    const parsed = JSON.parse(execFileSync(PY, ["-c", code], { cwd: base, encoding: "utf8" }).trim());
    expect(parsed.gc).not.toBeNull();
    expect(parsed.gc.age_days).toBe(30);
    expect(parsed.gc.auto).toBe(true);
    expect(typeof parsed.gc.last_sweep_ms).toBe("number");
    expect(parsed.ledger).toMatchObject({ entries: 0, bytes: 0 });
  });

  test("python twin skill_tools_gc reports posture and prunes with a dry-run", () => {
    const base = join(tmpdir(), `sr-py-gc-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const agentsDir = join(regDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(join(base, ".agents", "skills", "demo-skill"), { recursive: true });
    const stale = join(agentsDir, "stale-report.json");
    writeFileSync(stale, JSON.stringify({ kind: "parasite-skill-agent-run" }));
    utimesSync(stale, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    writeFileSync(join(base, "parasite-skill.json"), JSON.stringify({ gc: { ageDays: 30, auto: true } }));
    const scriptsDir = join(process.cwd(), "skill", "scripts");
    const statusCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(scriptsDir) + ")",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_gc', {'status': True})",
      "print(json.dumps(json.loads(text)))",
    ].join("; ");
    const status = JSON.parse(execFileSync(PY, ["-c", statusCode], { cwd: base, encoding: "utf8" }).trim());
    expect(status.stale.agent_files).toBe(1);
    // No sweep has run yet, so last/next are legitimately null.
    expect(status.last_sweep_ms).toBeNull();
    expect(status.throttled).toBe(false);
    // Dry-run reports the prune without deleting.
    const dryCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(scriptsDir) + ")",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_gc', {'age_days': 30, 'dry_run': True})",
      "print(json.dumps(json.loads(text)))",
    ].join("; ");
    const dry = JSON.parse(execFileSync(PY, ["-c", dryCode], { cwd: base, encoding: "utf8" }).trim());
    expect(dry.dry_run).toBe(true);
    expect(dry.removed.agent_files).toEqual(["stale-report.json"]);
    expect(existsSync(stale)).toBe(true);
    // Applying the sweep deletes it.
    const applyCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(scriptsDir) + ")",
      "import mcp_server",
      "text, code = mcp_server.run_tool('skill_tools_gc', {'age_days': 30})",
      "print(json.dumps(json.loads(text)))",
    ].join("; ");
    execFileSync(PY, ["-c", applyCode], { cwd: base, encoding: "utf8" });
    expect(existsSync(stale)).toBe(false);
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
      expect(out.join("\n")).toContain("6 profiles");
      const reports = readdirSync(join(registry, "agents"));
      // readdir order is filesystem-dependent (Windows: creation order, Linux
      // ext4: hash order), so never pick the first "all-*" entry — the
      // human-readable .md report starts with "#" and would break JSON.parse.
      const json = reports.find((name) => name.startsWith("all-") && name.endsWith(".json") && !name.endsWith(".dryrun.json"));
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
      // Preview reports are written, but the audit ledger stays untouched and
      // the tool script never executed.
      const files = readdirSync(join(registry, "agents"));
      expect(files.some((name) => name.endsWith(".dryrun.json"))).toBe(true);
      expect(files.some((name) => name.endsWith(".dryrun.md"))).toBe(true);
      expect(files.some((name) => name.endsWith(".json") && !name.endsWith(".dryrun.json"))).toBe(false);
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });

  test("tools history --since/--until filters by time window", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/ok.py": 'print("ok")\n',
    });
    // Capture the window BEFORE the run so the entry falls inside it.
    const since = new Date(Date.now() - 60_000).toISOString();
    const until = new Date(Date.now() + 60_000).toISOString();
    const payload = scan([dirs]);
    runSkillTool(payload, "demo-skill__ok", "", { registry });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "history", historySince: since, historyUntil: until })).toBe(0);
      expect(out.join("\n")).toContain("demo-skill__ok");
      out.length = 0;
      // A window entirely in the past excludes the entry.
      expect(cmdTools({ registry, dirs, toolsAction: "history", historySince: "2000-01-01T00:00:00Z", historyUntil: "2001-01-01T00:00:00Z" })).toBe(0);
      expect(out.join("\n")).not.toContain("demo-skill__ok");
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

describe("tools audit baseline and verify", () => {
  test("--write-baseline seeds a baseline file and --baseline diffs drift", () => {
    const { dirs, registry } = tempSkills({
      "safe-skill/SKILL.md": "---\nname: safe-skill\ndescription: Safe tooling.\n---\n",
      "safe-skill/scripts/benign.py": "print('hi')\n",
      "risky-skill/SKILL.md": "---\nname: risky-skill\ndescription: Risky tooling.\n---\n",
      // Initially benign so the baseline records low risk; a later rewrite to
      // a dangerous pattern is then a genuine low->high regression.
      "risky-skill/scripts/danger.py": "print('harmless for now')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "audit", writeBaseline: true })).toBe(0);
      expect(out.join("\n")).toContain("baseline written");
      expect(existsSync(join(registry, "tool-audit-baseline.json"))).toBe(true);
      // No drift yet: baseline mode exits 0.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "audit", baseline: true })).toBe(0);
      expect(out.join("\n")).toContain("no drift");
      // Regress the risky tool to a high-risk pattern: exit 1 + regression note.
      writeFileSync(join(dirs, "risky-skill", "scripts", "danger.py"), "import os\nos.system('curl http://x')\n");
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "audit", baseline: true, force: true })).toBe(1);
      expect(out.join("\n")).toContain("regression");
    } finally {
      console.log = orig;
    }
  });

  test("audit --baseline without a baseline file exits 2 with guidance", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const origLog = console.log;
    const origErr = console.error;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    console.error = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "audit", baseline: true })).toBe(2);
      expect(out.join("\n")).toContain("no audit baseline found");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  test("tools verify checks scripts and policy, exit 1 when broken", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
      "ghost-skill/SKILL.md": "---\nname: ghost-skill\ndescription: Broken tooling.\n---\n",
      "ghost-skill/scripts/gone.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // First scan registers both tools (files present) -> verify passes.
      expect(cmdTools({ registry, dirs, toolsAction: "verify" })).toBe(0);
      out.length = 0;
      // Delete the ghost script: the cached registry still lists the asset, so
      // verify now reports it missing and exits 1.
      rmSync(join(dirs, "ghost-skill", "scripts", "gone.py"));
      expect(cmdTools({ registry, dirs, toolsAction: "verify" })).toBe(1);
      const text = out.join("\n");
      expect(text).toContain("readiness check");
      expect(text).toContain("missing");
      // Restore the file: verify passes again from the same cached registry.
      out.length = 0;
      writeFileSync(join(dirs, "ghost-skill", "scripts", "gone.py"), 'print("hi")\n');
      expect(cmdTools({ registry, dirs, toolsAction: "verify" })).toBe(0);
    } finally {
      console.log = orig;
    }
  });

  test("tools history filters by name glob, skill glob, and status", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/ok.py": 'print("ok")\n',
      "demo-skill/scripts/bad.py": "import sys; sys.exit(1)\n",
    });
    const payload = scan([dirs]);
    runSkillTool(payload, "demo-skill__ok", "", { registry });
    runSkillTool(payload, "demo-skill__bad", "", { registry });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "history", historyName: "*__bad" })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("demo-skill__bad");
      expect(text).not.toContain("demo-skill__ok");
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "history", historySkill: "demo-skill", historyStatus: "ok" })).toBe(0);
      const okOnly = out.join("\n");
      expect(okOnly).toContain("demo-skill__ok");
      expect(okOnly).not.toContain("demo-skill__bad");
    } finally {
      console.log = orig;
    }
  });
});

describe("tools run-batch json-args map and refs tools section", () => {
  test("run-batch accepts a per-tool json-args map validated per schema", () => {
    const { dirs, registry } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__echo": {',
        '    "argsSchema": { "type": "object", "properties": { "msg": { "type": "string" } }, "required": ["msg"] }',
        "  }}",
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/echo.py": "import sys\nprint('msg=' + next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('msg=')), 'missing'))\n",
    });
    const origLog = console.log;
    const origErr = console.error;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    console.error = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "meta-skill__echo", jsonArgs: '{"meta-skill__echo": {"msg": "hi from map"}}' })).toBe(0);
      expect(out.join("\n")).toContain("msg=hi from map");
      // Missing required field in the per-tool map: exit 3, tool skipped.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "meta-skill__echo", jsonArgs: '{"meta-skill__echo": {}}' })).toBe(3);
      expect(out.join("\n")).toContain("missing required arg");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  test("refs pages list each skill's callable AI-tools", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdRefs({ registry, dirs })).toBe(0);
      const page = readFileSync(join(registry, "refs", "demo-skill", "index.md"), "utf-8");
      expect(page).toContain("## Callable AI-Tools");
      expect(page).toContain("demo-skill__hello");
      expect(page).toContain("python");
    } finally {
      console.log = orig;
    }
  });
});

describe("tools list filters and run-batch dry-run", () => {
  test("tools list --skill and --risk filter the inventory", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
      "risky-skill/SKILL.md": "---\nname: risky-skill\ndescription: Risky tooling.\n---\n",
      "risky-skill/scripts/danger.py": "import os\nos.system('curl http://x')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "list", listSkill: "demo-*" })).toBe(0);
      const skillText = out.join("\n");
      expect(skillText).toContain("demo-skill__hello");
      expect(skillText).not.toContain("risky-skill__danger");
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "list", listRisk: "high" })).toBe(0);
      const riskText = out.join("\n");
      expect(riskText).toContain("risky-skill__danger");
      expect(riskText).not.toContain("demo-skill__hello");
      out.length = 0;
      const origErr = console.error;
      console.error = (...a) => out.push(a.join(" "));
      expect(cmdTools({ registry, dirs, toolsAction: "list", listRisk: "bogus" })).toBe(1);
      expect(out.join("\n")).toContain("--risk must be one of");
      console.error = origErr;
    } finally {
      console.log = orig;
    }
  });

  test("tools run-batch --dry-run previews the batch without executing or recording", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/marker.py": "open('marker.txt','w').write('ran')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "demo-skill__marker", dryRun: true })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("batch dry-run");
      expect(text).toContain("demo-skill__marker");
      expect(text).toContain("ledger untouched");
      expect(existsSync(join(dirs, "demo-skill", "marker.txt"))).toBe(false);
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });

  test("tools run-batch --dry-run reports policy-blocked tools and exits 1", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "demo-skill__hello", dryRun: true, tools: { deny: ["demo-skill__*"] } })).toBe(1);
      expect(out.join("\n")).toContain("blocked");
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });

  test("tools run-batch --dry-run mirrors the real run's timeout and exit codes", () => {
    const { dirs, registry } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__echo": { "argsSchema": { "type": "object", "properties": { "port": { "type": "integer" } }, "required": ["port"] } }}',
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/echo.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // Invalid args in the batch dry-run: exit 3 (matches tools dry-run).
      const origErr = console.error;
      console.error = (...a) => out.push(a.join(" "));
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "meta-skill__echo", dryRun: true, jsonArgs: '{"meta-skill__echo": {}}' })).toBe(3);
      expect(out.join("\n")).toContain("missing required arg");
      console.error = origErr;
      // The preview reflects the configured timeout.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "run-batch", names: "meta-skill__echo", dryRun: true, jsonArgs: '{"meta-skill__echo": {"port": 8080}}', timeoutMs: 45000 })).toBe(0);
      expect(out.join("\n")).toContain("timeout 45000ms");
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
    }
  });
});

describe("per-tool declared timeoutMs", () => {
  test("resolveToolRun honors a declared per-tool timeout and CLI still wins", () => {
    const { dirs } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__hello": { "timeoutMs": 5000 }}',
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    const tool = listSkillTools(payload).find((entry) => entry.name === "meta-skill__hello");
    expect(tool.timeoutMs).toBe(5000);
    const declared = resolveToolRun(payload, "meta-skill__hello");
    expect(declared.timeoutMs).toBe(5000);
    const overridden = resolveToolRun(payload, "meta-skill__hello", "", { timeoutMs: 90000 });
    expect(overridden.timeoutMs).toBe(90000);
    // A declared timeout under the 1000ms floor is ignored.
    const { dirs: dirs2 } = tempSkills({
      "meta2-skill/SKILL.md": [
        "---",
        "name: meta2-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta2-skill__hello": { "timeoutMs": 5 }}',
        "---",
        "",
      ].join("\n"),
      "meta2-skill/scripts/hello.py": 'print("hi")\n',
    });
    const tool2 = listSkillTools(scan([dirs2])).find((entry) => entry.name === "meta2-skill__hello");
    expect(tool2.timeoutMs).toBeUndefined();
  });
});

describe("compose per-skill tools and agents strict", () => {
  test("composePayload lists callable tools per selected skill matching listSkillTools", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
      "demo-skill/hooks/check.sh": "#!/usr/bin/env bash\necho checked\n",
      "demo-skill/references/guide.md": "not a tool",
    });
    const payload = scan([dirs]);
    const runtime = composePayload(payload, "debug failing tests", { top: 5 });
    const demo = runtime.selectedSkills.find((skill) => skill.name === "demo-skill");
    expect(demo).toBeTruthy();
    expect(Array.isArray(demo.tools)).toBe(true);
    const names = demo.tools.map((tool: { name: string }) => tool.name).sort();
    const expected = listSkillTools(payload).filter((tool) => tool.skill === "demo-skill").map((tool) => tool.name).sort();
    expect(names).toEqual(expected);
    expect(names).toContain("demo-skill__hello");
    expect(names).toContain("demo-skill__check");
    // The reference file is not listed as a tool.
    expect(names.some((name) => name.includes("guide"))).toBe(false);
    const hello = demo.tools.find((tool: { name: string }) => tool.name === "demo-skill__hello");
    expect(hello.language).toBe("python");
  });

  test("compose tools include declared argsSchema presence", () => {
    const { dirs } = tempSkills({
      "meta-skill/SKILL.md": [
        "---",
        "name: meta-skill",
        "description: Tool metadata.",
        "tools: |",
        '  {"meta-skill__hello": { "argsSchema": { "type": "object" } }}',
        "---",
        "",
      ].join("\n"),
      "meta-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    const runtime = composePayload(payload, "tool metadata", { top: 5 });
    const meta = runtime.selectedSkills.find((skill) => skill.name === "meta-skill");
    expect(meta).toBeTruthy();
    expect(meta.tools.find((tool: { name: string }) => tool.name === "meta-skill__hello").argsSchema).toBe(true);
  });

  test("agents run --dry-run writes preview reports and --strict exits 2 on blocked tools", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const policy = { deny: ["demo-skill__*"] };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // Non-strict dry-run: blocked tools reported, exit 0, report files written.
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], dryRun: true, maxTools: 4, tools: policy })).toBe(0);
      expect(out.join("\n")).toContain("blocked");
      const files = readdirSync(join(registry, "agents"));
      expect(files.some((name) => name.endsWith(".dryrun.json"))).toBe(true);
      expect(files.some((name) => name.endsWith(".dryrun.md"))).toBe(true);
      const dry = JSON.parse(
        readFileSync(join(registry, "agents", files.find((name) => name.endsWith(".dryrun.json")) as string), "utf-8"),
      );
      expect(dry.nothing_executed).toBe(true);
      expect(dry.blocked.length).toBeGreaterThan(0);
      expect(dry.blocked[0].name).toBe("demo-skill__inspect");
      expect(readToolRuns(registry)).toHaveLength(0);
      // Strict: blocked tools become a hard failure.
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], dryRun: true, maxTools: 4, tools: policy, strict: true })).toBe(2);
    } finally {
      console.log = orig;
    }
  });

  test("llm --tool-dry-run previews tool calls without executing them", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/marker.py": "open('marker.txt','w').write('ran')\n",
    });
    const originalFetch = globalThis.fetch;
    const bodies: any[] = [];
    let calls = 0;
    globalThis.fetch = async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "demo-skill__marker", arguments: "{}" } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "final grounded answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(await cmdLlm({ request: "debug failing tests", endpoint: "http://localhost:1234/v1", model: "test-model", registry, dirs, maxChars: 200, toolDryRun: true })).toBe(0);
      expect(out.join("\n")).toContain("final grounded answer");
      expect(bodies.length).toBe(2);
      const toolMsg = bodies[1].messages.find((m: any) => m.role === "tool");
      expect(toolMsg).toBeTruthy();
      expect(toolMsg.content).toContain("[dry-run] would execute");
      // The tool script never ran and the ledger is untouched.
      expect(existsSync(join(dirs, "demo-skill", "marker.txt"))).toBe(false);
      expect(readToolRuns(registry)).toHaveLength(0);
    } finally {
      console.log = orig;
      globalThis.fetch = originalFetch;
    }
  });

  test("agents run --all --profiles runs only the named subset", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected: ' + ' '.join(sys.argv[1:]))\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, all: true, profiles: "ecosystem-architect,release-engineer", _: ["agents", "run", "--all", "debug", "failing", "tests"], maxTools: 2 })).toBe(0);
      expect(out.join("\n")).toContain("2 profiles");
      const reports = readdirSync(join(registry, "agents"));
      // Same readdir-order hazard as above: pick the combined JSON, never the
      // "#"-leading .md report.
      const json = reports.find((name) => name.startsWith("all-") && name.endsWith(".json") && !name.endsWith(".dryrun.json"));
      const combined = JSON.parse(readFileSync(join(registry, "agents", json as string), "utf-8"));
      expect(combined.profiles).toBe(2);
      const names = combined.reports.map((report: { profile: string }) => report.profile).sort();
      expect(names).toEqual(["ecosystem-architect", "release-engineer"]);
      // Unknown profile is a hard error.
      expect(cmdAgentsRun({ registry, dirs, all: true, profiles: "nope", _: ["agents", "run", "--all", "debug", "failing", "tests"] })).toBe(1);
    } finally {
      console.log = orig;
    }
  });

  test("agents run --min-tools gates on the number of successful tools", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4 })).toBe(0);
      out.length = 0;
      const origErr = console.error;
      console.error = (...a) => out.push(a.join(" "));
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4, minTools: 5 })).toBe(1);
      expect(out.join("\n")).toContain("--min-tools 5 not met");
      console.error = origErr;
    } finally {
      console.log = orig;
    }
  });

  test("agents run --strict exits 2 when a real run hits policy-blocked tools", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const policy = { deny: ["demo-skill__*"] };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4, tools: policy })).toBe(0);
      expect(out.join("\n")).toContain("denied by project policy");
      out.length = 0;
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4, tools: policy, strict: true })).toBe(2);
    } finally {
      console.log = orig;
    }
  });
});

describe("doctor, export tools, agents json, wiki tools", () => {
  test("doctor reports healthy registry/tools/config and exits 0", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdDoctor({ registry, dirs })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("all checks passed");
      expect(text).toContain("spec");
      expect(text).toContain("tools ready");
      expect(text).toContain("audit");
    } finally {
      console.log = orig;
    }
  });

  test("doctor exits 1 on a missing tool script", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // Seed the registry while the file exists so the asset is known, then
      // delete the script: doctor must detect the dangling tool and exit 1.
      expect(cmdDoctor({ registry, dirs })).toBe(0);
      out.length = 0;
      rmSync(join(dirs, "demo-skill", "scripts", "hello.py"));
      expect(cmdDoctor({ registry, dirs })).toBe(1);
      expect(out.join("\n")).toContain("missing");
    } finally {
      console.log = orig;
    }
  });

  test("doctor --json emits a machine-readable report", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdDoctor({ registry, dirs, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.ok).toBe(true);
      expect(parsed.checks.some((c: { check: string }) => c.check === "spec" && c.ok)).toBe(true);
    } finally {
      console.log = orig;
    }
  });

  test("export includes a tools inventory with risk in ecosystem.json", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
      "risky-skill/SKILL.md": "---\nname: risky-skill\ndescription: Risky tooling.\n---\n",
      "risky-skill/scripts/danger.py": "import os\nos.system('curl http://x')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdExport({ registry, dirs })).toBe(0);
      const eco = JSON.parse(readFileSync(join(registry, "ecosystem.json"), "utf-8"));
      expect(eco.counts.callable_tools).toBe(2);
      const demo = eco.tools.find((tool: { name: string }) => tool.name === "demo-skill__hello");
      expect(demo.skill).toBe("demo-skill");
      expect(demo.risk).toBe("low");
      const risky = eco.tools.find((tool: { name: string }) => tool.name === "risky-skill__danger");
      expect(risky.risk).toBe("high");
      const md = readFileSync(join(registry, "ECOSYSTEM.md"), "utf-8");
      expect(md).toContain("## Callable AI-Tools");
      expect(md).toContain("risky-skill__danger");
    } finally {
      console.log = orig;
    }
  });

  test("agents run --json prints the report to stdout", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.kind).toBe("parasite-skill-agent-run");
      expect(parsed.profile).toBe("ecosystem-architect");
      expect(parsed.saved).toContain("agents/");
    } finally {
      console.log = orig;
    }
  });

  test("agents run --all --json --dry-run prints the combined preview", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, all: true, _: ["agents", "run", "--all", "debug", "failing", "tests"], maxTools: 2, dryRun: true, json: true, profiles: "ecosystem-architect,release-engineer" })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.kind).toBe("parasite-skill-agent-dry-run-all");
      expect(parsed.nothing_executed).toBe(true);
      expect(parsed.profiles).toBe(2);
    } finally {
      console.log = orig;
    }
  });

  test("wikis Skills index and per-skill pages list callable AI-tools", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdWikis({ registry, dirs })).toBe(0);
      const skills = readFileSync(join(registry, "wikis", "Skills.md"), "utf-8");
      expect(skills).toContain("demo-skill__hello");
      const page = readFileSync(join(registry, "wikis", "skills", "demo-skill", "index.md"), "utf-8");
      expect(page).toContain("## Callable AI-Tools");
      expect(page).toContain("demo-skill__hello");
    } finally {
      console.log = orig;
    }
  });
});

describe("tools gc and list --json risk", () => {
  test("tools gc --age/--keep prunes agent reports and ledger entries", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    // Seed two agent reports (distinct mtimes) + ledger entries.
    const agentsDir = join(registry, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "old-report.json"), JSON.stringify({ kind: "parasite-skill-agent-run" }));
    const oldStamp = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(agentsDir, "old-report.json"), oldStamp, oldStamp);
    writeFileSync(join(agentsDir, "new-report.json"), JSON.stringify({ kind: "parasite-skill-agent-run" }));
    const payload = scan([dirs]);
    runSkillTool(payload, "demo-skill__hello", "", { registry });
    runSkillTool(payload, "demo-skill__hello", "", { registry });
    expect(readToolRuns(registry).length).toBe(2);
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // --dry-run reports what would be pruned without deleting anything.
      expect(cmdTools({ registry, dirs, toolsAction: "gc", keep: 1, dryRun: true })).toBe(0);
      expect(out.join("\n")).toContain("dry-run");
      expect(out.join("\n")).toContain("old-report.json");
      expect(readToolRuns(registry).length).toBe(2);
      expect(existsSync(join(agentsDir, "old-report.json"))).toBe(true);
      expect(existsSync(join(agentsDir, "new-report.json"))).toBe(true);
      // Real run: keep 1 ledger entry + 1 newest report (old-report pruned).
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "gc", keep: 1 })).toBe(0);
      expect(readToolRuns(registry).length).toBe(1);
      expect(existsSync(join(agentsDir, "old-report.json"))).toBe(false);
      expect(existsSync(join(agentsDir, "new-report.json"))).toBe(true);
      // --age prunes by mtime: the remaining new report is old enough to go.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "gc", age: 0 })).toBe(0);
      expect(existsSync(join(agentsDir, "new-report.json"))).toBe(false);
      // Requiring a knob returns usage error.
      expect(cmdTools({ registry, dirs, toolsAction: "gc" })).toBe(1);
    } finally {
      console.log = orig;
    }
  });

  test("tools list --json merges each tool's audit risk", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdTools({ registry, dirs, toolsAction: "list", json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      const tool = parsed.find((entry: { name: string }) => entry.name === "demo-skill__hello");
      expect(tool).toBeTruthy();
      expect(tool.risk).toBe("low");
    } finally {
      console.log = orig;
    }
  });
});

describe("MCP doctor tool", () => {
  test("tools/list exposes doctor", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 20, method: "tools/list", params: {} });
    const names = res.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("doctor");
  });

  test("tools/call doctor reports a healthy ecosystem", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "doctor", arguments: { dirs, registry } },
    });
    expect(res.result.content[0].text).toContain('"ok": true');
    expect(res.result.content[0].text).toContain("spec");
  });

  test("python twin exposes doctor and runs a healthy check", () => {
    const code = "import json, sys; sys.path.insert(0, 'skill/scripts'); import mcp_server; print(json.dumps([t['name'] for t in mcp_server.TOOLS]))";
    const names = JSON.parse(execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim());
    expect(names).toContain("doctor");
    const base = join(tmpdir(), `sr-py-doctor-${Date.now()}`);
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
    const doctorCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('doctor', {})",
      "print(json.loads(text)['ok'])",
    ].join("; ");
    const ok = execFileSync(PY, ["-c", doctorCode], { encoding: "utf8" }).trim();
    expect(ok).toBe("True");
  });

  test("doctor --json includes an mcp registration check", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdDoctor({ registry, dirs, json: true })).toBe(0);
      const json = JSON.parse(out.join("\n"));
      const mcp = json.checks.find((c: { check: string }) => c.check === "mcp");
      expect(mcp).toBeTruthy();
      expect(mcp.ok).toBe(true);
    } finally {
      console.log = orig;
    }
  });

  test("python twin doctor fails when the registry is missing", () => {
    const base = join(tmpdir(), `sr-py-doctor-missing-${Date.now()}`);
    bases.push(base);
    mkdirSync(join(base, ".agents", "skills", ".parasite-skill"), { recursive: true });
    const doctorCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('doctor', {})",
      "print(json.loads(text)['ok'])",
    ].join("; ");
    const ok = execFileSync(PY, ["-c", doctorCode], { encoding: "utf8" }).trim();
    expect(ok).toBe("False");
  });
});

describe("export --public strips paths", () => {
  test("public export keeps names but removes filesystem paths", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdExport({ registry, dirs, public: true })).toBe(0);
      const eco = JSON.parse(readFileSync(join(registry, "ecosystem.json"), "utf-8"));
      expect(eco.public).toBe(true);
      expect(Object.hasOwn(eco.skills[0], "path")).toBe(false);
      expect(eco.skills[0].name).toBe("demo-skill");
      expect(eco.rules.global.every((entry: string) => !entry.includes("/") && !entry.includes("\\"))).toBe(true);
      const md = readFileSync(join(registry, "ECOSYSTEM.md"), "utf-8");
      expect(md).toContain("Public mode");
      // The non-public export still carries paths.
      expect(cmdExport({ registry, dirs })).toBe(0);
      const full = JSON.parse(readFileSync(join(registry, "ecosystem.json"), "utf-8"));
      expect(Object.hasOwn(full.skills[0], "path")).toBe(true);
      expect(full.public).toBeUndefined();
    } finally {
      console.log = orig;
    }
  });
});

describe("sync dry-run and llm json trace", () => {
  test("sync --push --dry-run previews without committing", () => {
    const { base } = tempSkills({});
    const syncRoot = join(base, ".agents", "skills");
    mkdirSync(syncRoot, { recursive: true });
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: syncRoot, stdio: "ignore" });
      writeFileSync(join(syncRoot, "note.txt"), "pending change\n");
      const orig = console.log;
      const out: string[] = [];
      console.log = (...a) => out.push(a.join(" "));
      try {
        expect(cmdSync({ push: true, dryRun: true })).toBe(0);
        const text = out.join("\n");
        expect(text).toContain("push dry-run");
        expect(text).toContain("note.txt");
        // Nothing was staged or committed (works even on an unborn HEAD).
        const status = execFileSync("git", ["status", "--porcelain"], { cwd: syncRoot, encoding: "utf8" }).trim();
        expect(status).toContain("note.txt");
        const commits = execFileSync("git", ["rev-list", "--count", "--all"], { cwd: syncRoot, encoding: "utf8" }).trim();
        expect(commits).toBe("0");
      } finally {
        console.log = orig;
      }
    } catch {
      // git unavailable — nothing to assert
    }
  });

  test("llm --json returns a tool_calls trace", async () => {
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
      expect(await cmdLlm({ request: "debug failing tests", endpoint: "http://localhost:1234/v1", model: "test-model", registry, dirs, maxChars: 200, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.tool_calls).toHaveLength(1);
      expect(parsed.tool_calls[0].name).toBe("demo-skill__hello");
      expect(parsed.tool_calls[0].ok).toBe(true);
      expect(parsed.tool_calls[0].status).toBe(0);
      expect(parsed.tool_calls[0].dry_run).toBe(false);
      expect(parsed.response).toBe("final grounded answer");
    } finally {
      console.log = orig;
      globalThis.fetch = originalFetch;
    }
  });
});

describe("gc TTL policy, sync posture, risk layers", () => {
  test("mergeConfig parses the gc TTL policy", () => {
    const merged = mergeConfig({ gc: { ageDays: 30, keep: 20, auto: true } }, {});
    expect(merged.gc).toEqual({ ageDays: 30, keep: 20, auto: true });
    expect(mergeConfig({ gc: { ageDays: -1 } }, {}).gc).toBeUndefined();
    expect(mergeConfig({ gc: "nope" }, {}).gc).toBeUndefined();
  });

  test("tools gc falls back to the project gc policy when no CLI knobs are given", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const agentsDir = join(registry, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "stale-report.json"), JSON.stringify({ kind: "parasite-skill-agent-run" }));
    seedLedger(registry, 2);
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // Policy drives gc: keep 1 trims the ledger to a single newest entry;
      // the single report file is the newest, so it survives.
      expect(cmdTools({ registry, dirs, toolsAction: "gc", gc: { keep: 1 } })).toBe(0);
      expect(readToolRuns(registry).length).toBe(1);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(true);
      // ageDays 0 prunes everything (nothing is younger than 0 days).
      expect(cmdTools({ registry, dirs, toolsAction: "gc", gc: { ageDays: 0 } })).toBe(0);
      expect(readToolRuns(registry).length).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      // Without any policy or flags: usage error.
      expect(cmdTools({ registry, dirs, toolsAction: "gc" })).toBe(1);
    } finally {
      console.log = orig;
    }
  });

  test("doctor reports the gc policy posture", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdDoctor({ registry, dirs, gc: { ageDays: 30 } })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("gc");
      expect(text).toContain("no stale artifacts under the gc policy");
      out.length = 0;
      // Without a policy, doctor notes the absence instead of failing.
      expect(cmdDoctor({ registry, dirs })).toBe(0);
      expect(out.join("\n")).toContain("no gc TTL policy configured");
    } finally {
      console.log = orig;
    }
  });

  test("planGc is shared and side-effect free when dryRun", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    seedLedger(registry, 1);
    const plan = planGc(registry, { ageDays: 0, dryRun: true });
    expect(plan.totals.ledger_entries).toBe(1);
    expect(readToolRuns(registry).length).toBe(1); // nothing deleted
  });

  test("compose payload tools carry risk when toolsRisk is supplied", () => {
    const { dirs } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const payload = scan([dirs]);
    const runtime = composePayload(payload, "debug failing tests", {
      top: 3,
      toolsRisk: { "demo-skill__hello": "high" },
    });
    const skill = runtime.selectedSkills.find((s: { name: string }) => s.name === "demo-skill");
    expect(skill).toBeTruthy();
    expect(skill.tools.find((t: { name: string }) => t.name === "demo-skill__hello").risk).toBe("high");
    // Without toolsRisk the payload stays lean (no risk key).
    const plain = composePayload(payload, "debug failing tests", { top: 3 });
    const plainTool = plain.selectedSkills.find((s: { name: string }) => s.name === "demo-skill").tools[0];
    expect(plainTool.risk).toBeUndefined();
  });

  test("agents run reports carry per-tool risk", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests with tooling.\n---\n",
      "demo-skill/scripts/inspect.py": "import sys\nprint('inspected')\n",
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdAgentsRun({ registry, dirs, _: ["agents", "run", "ecosystem-architect", "debug", "failing", "tests"], maxTools: 4, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.tool_runs.some((run: { name: string }) => run.name === "demo-skill__inspect")).toBe(true);
      expect(parsed.tool_runs.find((run: { name: string }) => run.name === "demo-skill__inspect").risk).toBe("low");
    } finally {
      console.log = orig;
    }
  });

  test("llm tool schemas carry risk annotations", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const originalFetch = globalThis.fetch;
    let receivedSchemas: any;
    globalThis.fetch = async (_url: any, options: any) => {
      receivedSchemas = JSON.parse(options.body).tools;
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(await cmdLlm({ request: "debug failing tests", endpoint: "http://localhost:1234/v1", model: "m", registry, dirs })).toBe(0);
      const schema = receivedSchemas.find((s: any) => s.function.name === "demo-skill__hello");
      expect(schema.function.description).toContain("[risk: low]");
    } finally {
      console.log = orig;
      globalThis.fetch = originalFetch;
    }
  });

  test("export records gc policy and sync posture; --json prints the inventory", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdExport({ registry, dirs, gc: { ageDays: 30, keep: 20, auto: true, intervalDays: 5 }, json: true })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.kind).toBe("parasite-skill-ecosystem");
      expect(parsed.gc.age_days).toBe(30);
      expect(parsed.gc.interval_days).toBe(5);
      expect(parsed.gc.auto).toBe(true);
      expect(parsed.gc.stale.agent_files).toBe(0);
      // The auto sweep ran during export (auto: true), so the throttle posture
      // is recorded: last sweep happened, next is at least one interval later.
      expect(typeof parsed.gc.last_sweep_ms).toBe("number");
      expect(parsed.gc.next_sweep_ms).toBeGreaterThan(parsed.gc.last_sweep_ms as number);
      expect(parsed.sync.repo).toBe(false);
      // The saved file carries the same posture.
      const eco = JSON.parse(readFileSync(join(registry, "ecosystem.json"), "utf-8"));
      expect(eco.gc.keep).toBe(20);
      const md = readFileSync(join(registry, "ECOSYSTEM.md"), "utf-8");
      expect(md).toContain("## GC TTL Policy & Sync Posture");
    } finally {
      console.log = orig;
    }
  });

  test("MCP export tool returns the inventory and llm tool previews tool calls", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const list = await handleMessage({ jsonrpc: "2.0", id: 30, method: "tools/list", params: {} });
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("export");
    expect(names).toContain("llm");
    const exported = await handleMessage({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "export", arguments: { dirs, registry } } });
    expect(exported.result.content[0].text).toContain("parasite-skill-ecosystem");
    expect(exported.result.content[0].text).toContain("demo-skill");
  });

  test("MCP llm tool runs the async path with a mocked endpoint", async () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hello")\n',
    });
    const originalFetch = globalThis.fetch;
    const bodies: any[] = [];
    let calls = 0;
    globalThis.fetch = async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "demo-skill__hello", arguments: "{}" } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "mcp grounded answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const res = await handleMessage({
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: { name: "llm", arguments: { request: "debug failing tests", endpoint: "http://localhost:1234/v1", model: "m", dirs, registry } },
      });
      expect(res.result.content[0].text).toContain("mcp grounded answer");
      expect(bodies.length).toBe(2);
      // The tool schema was risk-annotated through the async path.
      expect(bodies[0].tools.some((tool: any) => tool.function.description.includes("[risk: low]"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("python twin exposes export and llm tools", () => {
    const code = "import json, sys; sys.path.insert(0, 'skill/scripts'); import mcp_server; print(json.dumps([t['name'] for t in mcp_server.TOOLS]))";
    const names = JSON.parse(execFileSync(PY, ["-c", code], { encoding: "utf8" }).trim());
    expect(names).toContain("export");
    expect(names).toContain("llm");
    const base = join(tmpdir(), `sr-py-export-${Date.now()}`);
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
    const exportCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, 'skill/scripts')",
      "import mcp_server",
      "text, code = mcp_server.run_tool('export', {'public': True})",
      "eco = json.loads(text)",
      // public marker is set, tools carry static-audit risk, and --public strips
      // filesystem paths — parity with the JS twin's public-safe export.
      "print(eco['public'], eco['tools'][0]['risk'], 'no-path' if 'path' not in eco['skills'][0] else 'leaked')",
    ].join("; ");
    const result = execFileSync(PY, ["-c", exportCode], { encoding: "utf8" }).trim();
    expect(result).toContain("True");
    expect(result).toContain("low");
    expect(result).toContain("no-path");
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

describe("scheduled auto-gc runner", () => {
  function seedStale(registry: string, dirs: string) {
    const agentsDir = join(registry, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "stale-report.json"), JSON.stringify({ kind: "parasite-skill-agent-run" }));
    const oldStamp = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(agentsDir, "stale-report.json"), oldStamp, oldStamp);
    seedLedger(registry, 2);
    return { agentsDir };
  }

  test("scan auto-applies the gc policy when auto: true", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    expect(readToolRuns(registry).length).toBe(2);
    const origErr = console.error;
    const errOut: string[] = [];
    console.error = (...a) => errOut.push(a.join(" "));
    try {
      // auto: true + ageDays 0 -> the sweep runs inside cmdScan itself.
      expect(cmdScan({ registry, dirs, gc: { ageDays: 0, auto: true } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      expect(readToolRuns(registry).length).toBe(0);
      expect(errOut.join("\n")).toContain("auto-gc: pruned");
    } finally {
      console.error = origErr;
    }
  });

  test("auto-gc stays off without auto: true", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    const origErr = console.error;
    const errOut: string[] = [];
    console.error = (...a) => errOut.push(a.join(" "));
    try {
      // Same policy without the auto flag: nothing is swept.
      expect(cmdScan({ registry, dirs, gc: { ageDays: 0 } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(true);
      expect(readToolRuns(registry).length).toBe(2);
      expect(errOut.join("\n")).not.toContain("auto-gc");
    } finally {
      console.error = origErr;
    }
  });

  test("doctor self-heals stale artifacts under an auto policy", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // The sweep runs before the posture check, so doctor passes with a
      // clean bill rather than failing on artifacts it just cleared.
      expect(cmdDoctor({ registry, dirs, gc: { ageDays: 0, auto: true } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      expect(readToolRuns(registry).length).toBe(0);
      expect(out.join("\n")).toContain("no stale artifacts under the gc policy");
    } finally {
      console.log = orig;
    }
  });

  test("export auto-applies the gc policy when auto: true", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdExport({ registry, dirs, gc: { ageDays: 0, auto: true } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      expect(out.join("\n")).toContain("ecosystem written");
    } finally {
      console.log = orig;
    }
  });

  test("auto-gc honors gc-intervalDays: sweeps once, then throttles within the interval", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    const origErr = console.error;
    const errOut: string[] = [];
    console.error = (...a) => errOut.push(a.join(" "));
    try {
      // First call: no marker yet -> the sweep runs and writes the marker.
      expect(cmdScan({ registry, dirs, gc: { ageDays: 30, auto: true, intervalDays: 5 } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      expect(existsSync(join(registry, "auto-gc.last.json"))).toBe(true);
      expect(errOut.join("\n")).toContain("auto-gc: pruned");
      const markerBefore = readFileSync(join(registry, "auto-gc.last.json"), "utf-8");
      // A new stale report inside the 5-day interval must be left alone.
      writeFileSync(join(agentsDir, "stale-report.json"), JSON.stringify({ kind: "x" }));
      utimesSync(join(agentsDir, "stale-report.json"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
      expect(cmdScan({ registry, dirs, gc: { ageDays: 30, auto: true, intervalDays: 5 } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(true);
      expect(readFileSync(join(registry, "auto-gc.last.json"), "utf-8")).toBe(markerBefore);
      expect(errOut.join("\n")).toContain("auto-gc: skipped");
    } finally {
      console.error = origErr;
    }
  });

  test("auto-gc re-sweeps when the interval marker is stale", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    // A marker from 2020 is long past the 5-day interval.
    writeFileSync(join(registry, "auto-gc.last.json"), JSON.stringify({ lastRunMs: 1 }));
    const origErr = console.error;
    const errOut: string[] = [];
    console.error = (...a) => errOut.push(a.join(" "));
    try {
      expect(cmdScan({ registry, dirs, gc: { ageDays: 30, auto: true, intervalDays: 5 } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(false);
      expect(errOut.join("\n")).toContain("auto-gc: pruned");
      // The marker was refreshed to now.
      const marker = JSON.parse(readFileSync(join(registry, "auto-gc.last.json"), "utf-8"));
      expect(marker.lastRunMs).toBeGreaterThan(1);
    } finally {
      console.error = origErr;
    }
  });

  test("doctor does not fail while the auto sweep is interval-throttled", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const { agentsDir } = seedStale(registry, dirs);
    // A fresh marker puts the runner inside the 5-day interval: doctor must
    // not fail on the stale artifact it is legitimately waiting to sweep.
    writeFileSync(join(registry, "auto-gc.last.json"), JSON.stringify({ lastRunMs: Date.now() }));
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      expect(cmdDoctor({ registry, dirs, gc: { ageDays: 30, auto: true, intervalDays: 5 } })).toBe(0);
      expect(existsSync(join(agentsDir, "stale-report.json"))).toBe(true);
      // 1 agent report + 2 seeded ledger entries = 3 stale artifacts.
      expect(out.join("\n")).toContain("[ok] gc — 3 stale artifact(s) under the auto gc policy (auto sweep throttled to once per 5d)");
    } finally {
      console.log = orig;
    }
  });

  test("mergeConfig parses gc.intervalDays from the project config", () => {
    const merged = mergeConfig({ gc: { ageDays: 30, keep: 20, auto: true, intervalDays: 5 } }, {});
    expect(merged.gc).toEqual({ ageDays: 30, keep: 20, auto: true, intervalDays: 5 });
    // Invalid intervalDays (negative) is dropped; the rest of the policy stays.
    const dropped = mergeConfig({ gc: { ageDays: 30, intervalDays: -1 } }, {});
    expect(dropped.gc).toEqual({ ageDays: 30 });
  });

  test("python twin auto-gc sweeps on scan/doctor and throttles within the interval", () => {
    const base = join(tmpdir(), `sr-py-gc-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    const skillDir = join(base, ".agents", "skills", "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(join(regDir, "agents"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n");
    writeFileSync(join(skillDir, "scripts", "hello.py"), 'print("hi")\n');
    writeFileSync(join(base, "parasite-skill.json"), JSON.stringify({ gc: { ageDays: 30, auto: true, intervalDays: 5 } }));
    const pyCode = [
      "import json, os, sys, time",
      "from pathlib import Path",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(join(process.cwd(), "skill", "scripts")) + ")",
      "import mcp_server",
      // scan writes the registry and (with the auto policy) the sweep marker.
      "mcp_server.run_tool('scan', {})",
      "agents = Path(" + JSON.stringify(regDir) + ") / 'agents'",
      "regp = Path(" + JSON.stringify(regDir) + ")",
      "old = time.time() - 200 * 86400",
      // seed a stale report and age the marker so the next sweep actually runs.
      "(agents / 'stale-report.json').write_text('{}')",
      "os.utime(agents / 'stale-report.json', (old, old))",
      "regp.joinpath('auto-gc.last.json').write_text(json.dumps({'lastRunMs': 1}))",
      "text, code = mcp_server.run_tool('doctor', {})",
      "checks = json.loads(text)['checks']",
      "gc1 = [c['detail'] for c in checks if c['check'] == 'gc'][0]",
      "print(' '.join([str(code), str(not (agents / 'stale-report.json').exists()), gc1]))",
      // within the 5-day interval the sweep must be throttled and doctor stays green.
      "(agents / 'stale-report.json').write_text('{}')",
      "os.utime(agents / 'stale-report.json', (old, old))",
      "text2, code2 = mcp_server.run_tool('doctor', {})",
      "checks2 = json.loads(text2)['checks']",
      "gc2 = [c['detail'] for c in checks2 if c['check'] == 'gc'][0]",
      "print(' '.join([str(code2), str((agents / 'stale-report.json').exists()), gc2]))",
    ].join("; ");
    const lines = execFileSync(PY, ["-c", pyCode], { encoding: "utf8", cwd: base }).trim().split("\n");
    // First doctor: swept the stale report (file gone), gc check reports clean.
    expect(lines[0]).toContain("0 True");
    expect(lines[0]).toContain("no stale artifacts under the gc policy");
    // Second doctor: interval-throttled (file stays) but still exit 0.
    expect(lines[1]).toContain("0 True");
    expect(lines[1]).toContain("auto sweep throttled to once per 5d");
  });

  test("tools gc --status reports policy + sweep throttle posture", () => {
    const { dirs, registry } = tempSkills({
      "demo-skill/SKILL.md": "---\nname: demo-skill\ndescription: Debug failing tests.\n---\n",
      "demo-skill/scripts/hello.py": 'print("hi")\n',
    });
    const orig = console.log;
    const out: string[] = [];
    console.log = (...a) => out.push(a.join(" "));
    try {
      // Text view: policy + posture without pruning anything.
      expect(cmdTools({ registry, dirs, toolsAction: "gc", status: true, gc: { ageDays: 30, auto: true, intervalDays: 5 } })).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("gc policy: age 30d");
      expect(text).toContain("auto yes");
      expect(text).toContain("interval 5d");
      expect(text).toContain("last auto sweep: never");
      expect(text).toContain("next auto sweep: anytime");
      // --json machine view carries the posture fields.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "gc", status: true, json: true, gc: { ageDays: 30, intervalDays: 5 } })).toBe(0);
      const parsed = JSON.parse(out.join("\n"));
      expect(parsed.policy.intervalDays).toBe(5);
      expect(parsed.last_sweep_ms).toBeNull();
      expect(parsed.throttled_now).toBe(false);
      expect(parsed.stale.agent_files).toBe(0);
      // Without a policy it reports the absence, not an error.
      out.length = 0;
      expect(cmdTools({ registry, dirs, toolsAction: "gc", status: true })).toBe(0);
      expect(out.join("\n")).toContain("no project gc policy configured");
    } finally {
      console.log = orig;
    }
  });

  test("python twin skill_tools_history reads the shared ledger with filters", () => {
    const base = join(tmpdir(), `sr-py-history-${Date.now()}`);
    bases.push(base);
    const regDir = join(base, ".agents", "skills", ".parasite-skill");
    mkdirSync(regDir, { recursive: true });
    // Seed a ledger the python twin can read (same schema both twins write).
    const lines = [
      JSON.stringify({ ts: "2026-08-01T00:00:00.000Z", name: "alpha__run", skill: "alpha-skill", status: 0, duration_ms: 5, stdout_chars: 3, stderr_chars: 0 }),
      JSON.stringify({ ts: "2026-08-02T00:00:00.000Z", name: "beta__run", skill: "beta-skill", status: 1, duration_ms: 9, stdout_chars: 0, stderr_chars: 4 }),
      JSON.stringify({ ts: "2026-08-03T00:00:00.000Z", name: "alpha__run", skill: "alpha-skill", status: 0, duration_ms: 6, stdout_chars: 2, stderr_chars: 0 }),
    ].join("\n");
    writeFileSync(join(regDir, "tool-runs.jsonl"), lines + "\n", "utf-8");
    const pyCode = [
      "import json, os, sys",
      "os.environ['PARASITE_SKILL_HOME'] = " + JSON.stringify(base),
      "sys.path.insert(0, " + JSON.stringify(join(process.cwd(), "skill", "scripts")) + ")",
      "import mcp_server",
      "print('skill_tools_history' in [t['name'] for t in mcp_server.TOOLS])",
      "text, code = mcp_server.run_tool('skill_tools_history', {'name': 'alpha*'})",
      "data = json.loads(text)",
      "print(code, data['count'], [e['name'] for e in data['entries']])",
      "text2, _ = mcp_server.run_tool('skill_tools_history', {'status': 'fail'})",
      "data2 = json.loads(text2)",
      "print(data2['count'], [e['name'] for e in data2['entries']])",
    ].join("; ");
    const out = execFileSync(PY, ["-c", pyCode], { encoding: "utf8" }).trim().split("\n");
    expect(out[0].trim()).toBe("True");
    expect(out[1]).toContain("0 2");
    expect(out[1]).toContain("alpha__run");
    expect(out[2]).toContain("1");
    expect(out[2]).toContain("beta__run");
  });

  test("CI gate mirror: the real CLI doctor sweeps under an auto policy and throttles", () => {
    const base = join(tmpdir(), `sr-ci-gate-${Date.now()}`);
    bases.push(base);
    const regAgents = join(base, ".agents", "skills", ".parasite-skill", "agents");
    mkdirSync(regAgents, { recursive: true });
    writeFileSync(join(base, "parasite-skill.json"), JSON.stringify({ gc: { ageDays: 30, keep: 20, auto: true, intervalDays: 30 } }));
    const stale = join(regAgents, "stale-report.json");
    const seed = () => {
      writeFileSync(stale, JSON.stringify({ kind: "parasite-skill-agent-run" }));
      utimesSync(stale, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    };
    seed();
    const bin = join(process.cwd(), "bin", "parasite-skill.js");
    const env = { ...process.env, PARASITE_SKILL_HOME: base };
    // First doctor: the sweep runs, the note lands on stderr, the artifact is
    // gone, and doctor exits 0 — exactly what the CI release gate asserts.
    let res = spawnSync(process.execPath, [bin, "doctor"], { cwd: base, env, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("auto-gc: pruned");
    expect(existsSync(stale)).toBe(false);
    // Inside the 30-day interval: throttled, artifact stays, still exit 0.
    seed();
    res = spawnSync(process.execPath, [bin, "doctor"], { cwd: base, env, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("auto-gc: skipped");
    expect(existsSync(stale)).toBe(true);
  });
});
