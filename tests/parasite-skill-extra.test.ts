import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandHelp, parseFlags, run } from "../src/cli.js";
import { handleMessage } from "../src/mcp-server.js";
import { cmdHistory, discoverHistory } from "../src/commands/history.js";
import { cmdLlm } from "../src/commands/llm.js";
import { CLIENTS, detectClients } from "../src/clients.js";
import { scan, scoreIdea, parseFrontmatter } from "../src/engine.js";

describe("parseFlags", () => {
  test("parses value flags and bool flags", () => {
    const f = parseFlags(["route", "--top", "5", "--set", "docs", "an idea"]);
    expect(f._).toEqual(["route", "an idea"]);
    expect(f.top).toBe(5);
    expect(f.set).toBe("docs");
  });

  test("bare --set stays a boolean toggle and never swallows a flag", () => {
    const f = parseFlags(["route", "an idea", "--set", "--top", "3"]);
    expect(f._).toEqual(["route", "an idea"]);
    expect(f.set).toBe(true);
    expect(f.top).toBe(3);
  });

  test("tolerates a bad --top value (NaN guard)", () => {
    const f = parseFlags(["route", "--top", "abc", "x"]);
    expect(f.top).toBeUndefined();
  });

  test("parses adaptive compose flags", () => {
    const f = parseFlags(["compose", "request", "--top", "4", "--max-chars", "1200", "--json"]);
    expect(f.top).toBe(4);
    expect(f.maxChars).toBe(1200);
    expect(f.json).toBe(true);
    const llm = parseFlags(["llm", "request", "--endpoint", "http://localhost:1/v1", "--model", "local", "--timeout", "1000"]);
    expect(llm.endpoint).toBe("http://localhost:1/v1");
    expect(llm.model).toBe("local");
    expect(llm.timeout).toBe(1000);
    const bounded = parseFlags(["llm", "request", "--max-output-tokens", "800", "--max-response-chars", "5000"]);
    expect(bounded.maxOutputTokens).toBe(800);
    expect(bounded.maxResponseChars).toBe(5000);
    const history = parseFlags(["history", "import", "--file", "chat.json"]);
    expect(history.file).toBe("chat.json");
  });

  test("parses --agent list and mode flags", () => {
    const f = parseFlags(["install", "-a", "claude-code,codex", "--link", "--yes"]);
    expect(f.agents).toEqual(["claude-code", "codex"]);
    expect(f.mode).toBe("link");
    expect(f.yes).toBe(true);
  });

  test("exposes focused help for integration-heavy commands", () => {
    for (const command of ["llm", "history", "parasite", "mcp", "graph"]) {
      const help = commandHelp(command);
      expect(help).toContain(`parasite-skill ${command}`);
      expect(help).toContain("SAFETY");
    }
    expect(commandHelp("unknown")).toBeNull();
  });

  test("exposes focused help for integration-heavy commands", () => {
    for (const command of ["llm", "history", "parasite", "mcp", "graph"]) {
      const help = commandHelp(command);
      expect(help).toContain(`parasite-skill ${command}`);
      expect(help).toContain("SAFETY");
    }
    expect(commandHelp("unknown")).toBeNull();
  });

  test("dispatches focused help through the real CLI runner", async () => {
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
      for (const command of ["llm", "history", "parasite", "mcp", "graph"]) {
        output.length = 0;
        expect(await run([command, "--help"])).toBe(0);
        expect(output.join("\\n")).toContain(`parasite-skill ${command}`);
        expect(output.join("\\n")).toContain("SAFETY");
      }
      output.length = 0;
      expect(await run(["--help"])).toBe(0);
      expect(output.join("\\n")).toContain("COMMANDS");
      expect(await run(["llm", "--help", "--bogus"])).toBe(2);
    } finally {
      console.log = originalLog;
    }
  });

  test("parses --version / --help as actions", () => {
    expect(parseFlags(["--version"]).action).toBe("version");
    expect(parseFlags(["-h"]).action).toBe("help");
  });

  test("flags unknown options via badFlags (no global mutation)", () => {
    const f = parseFlags(["--bogus"]);
    expect(f.badFlags).toBe(true);
    expect(f._).toEqual([]);
  });

  test("missing flag value does not crash (badFlags set)", () => {
    const f = parseFlags(["install", "--agent"]);
    expect(f.badFlags).toBe(true);
    expect(f.agents).toEqual([]);
  });
});

describe("CLIENTS registry", () => {
  test("covers the 12 verified core clients + expanded set", () => {
    const ids = CLIENTS.map((c) => c.id);
    for (const core of [
      "claude-code",
      "codex",
      "opencode",
      "cline",
      "cursor",
      "windsurf",
      "gemini-cli",
      "warp",
      "github-copilot",
      "continue",
      "zed",
      "universal",
    ]) {
      expect(ids).toContain(core);
    }
    expect(ids.length).toBeGreaterThanOrEqual(20);
  });

  test("every client has a user-level path", () => {
    for (const c of CLIENTS) {
      expect(c.user, `client ${c.id} missing user path`).toBeTruthy();
      expect(c.user).toContain("skills");
    }
  });

  test("detectClients returns clients whose dir OR parent config dir exists", () => {
    // Hermetic: probe the detection rules against a synthetic home instead of
    // the machine's real one (which has no client dirs on CI runners).
    const base = join(tmpdir(), `sr-clients-${Date.now()}`);
    mkdirSync(join(base, ".agents", "skills"), { recursive: true });
    mkdirSync(join(base, "cfg"), { recursive: true });
    const detected = detectClients([
      { id: "dir", label: "Dir", user: join(base, ".agents", "skills") },
      { id: "parent", label: "Parent", user: join(base, "cfg", "skills") },
      { id: "missing", label: "Missing", user: join(base, "nope", "skills") },
    ]);
    expect(detected.map((d) => d.id).sort()).toEqual(["dir", "parent"]);
    for (const d of detected) {
      const parent = d.user.split(/[\\/]/).slice(0, -1).join("/");
      expect(existsSync(d.user) || existsSync(parent)).toBe(true);
    }
  });
});

describe("MCP server protocol", () => {
  test("initialize returns protocol + server info", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: {} },
    });
    expect(res.result.protocolVersion).toBe("2024-11-05");
    expect(res.result.serverInfo.name).toBe("parasite-skill");
    expect(res.result.capabilities.tools).toEqual({});
  });

  test("ping returns empty result", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "ping", params: {} });
    expect(res.result).toEqual({});
  });

  test("Python MCP twin exposes the graph tool", () => {
    const python = process.platform === "win32" ? "python" : "python3";
    const code = "import json, sys; sys.path.insert(0, 'skill/scripts'); import mcp_server; print(json.dumps([t['name'] for t in mcp_server.TOOLS]))";
    const names = JSON.parse(execFileSync(python, ["-c", code], { encoding: "utf8" }).trim());
    expect(names).toContain("graph");
  });

  test("tools/list exposes the full tool set", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const names = res.result.tools.map((t) => t.name);
    for (const n of ["scan", "validate", "route", "sets", "plan", "compose", "refs", "wikis", "graph", "list_installs"]) {
      expect(names).toContain(n);
    }
    const plan = res.result.tools.find((tool) => tool.name === "plan");
    expect(plan.inputSchema.properties.maxChars).toBeTruthy();
    expect(plan.inputSchema.properties.enabledSets).toBeTruthy();
    expect(plan.inputSchema.properties.excludeSkills).toBeTruthy();
  });

  test("tools/call route returns text content for an idea", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "route", arguments: { idea: "debug a failing test", top: 2 } },
    });
    expect(res.result.content[0].type).toBe("text");
    expect(res.result.content[0].text).toContain("top skills");
  });

  test("tools/call compose returns a compact payload", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "compose", arguments: { idea: "debug a failing test", top: 2, maxChars: 500 } },
    });
    expect(res.result.content[0].type).toBe("text");
    expect(res.result.content[0].text).toContain("parasite-skill-runtime-payload");
    expect(res.result.content[0].text).not.toContain(process.cwd());
  });

  test("tools/call plan keeps local paths out of MCP chat output", async () => {
    const base = join(tmpdir(), `sr-mcp-plan-${Date.now()}`);
    const dirs = join(base, "skills");
    const registry = join(base, "registry");
    mkdirSync(join(dirs, "demo-skill"), { recursive: true });
    writeFileSync(
      join(dirs, "demo-skill", "SKILL.md"),
      "---\\nname: demo-skill\\ndescription: Debug failing tests.\\n---\\n",
    );
    try {
      const request = `debug owner@example.com at ${process.cwd()}`;
      const res = await handleMessage({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "plan", arguments: { request, top: 1, maxChars: 300, dirs, registry } },
      });
      expect(res.result.content[0].type).toBe("text");
      expect(res.result.content[0].text).toContain("Payload: plan/");
      expect(res.result.content[0].text).toContain("plan saved: plan/");
      expect(res.result.content[0].text).toContain("payload saved: plan/");
      expect(res.result.content[0].text).not.toContain(process.cwd());
      expect(res.result.content[0].text).not.toContain(base);
      expect(res.result.content[0].text).not.toContain("owner@example.com");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("tools/call with unknown tool returns -32602", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    expect(res.error.code).toBe(-32602);
  });

  test("unknown method returns -32601", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 6, method: "bogus", params: {} });
    expect(res.error.code).toBe(-32601);
  });

  test("malformed request returns -32600", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 7 });
    expect(res.error.code).toBe(-32600);
  });

  test("tools/call sets returns a load order for thinking", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "sets", arguments: { apply: "thinking" } },
    });
    expect(res.result.content[0].text.length).toBeGreaterThan(10);
  });
});

describe("safe history and LLM integrations", () => {
  test("history import sanitizes selected transcript into the registry only", () => {
    const base = join(tmpdir(), `sr-history-${Date.now()}`);
    const source = join(base, "freebuff-chat-history.json");
    const registry = join(base, "registry");
    mkdirSync(base, { recursive: true });
    writeFileSync(source, JSON.stringify({ text: "owner@example.com token=abc123 at C:/Users/private/project" }));
    try {
      expect(cmdHistory({ historyAction: "import", file: source, registry, maxChars: 500 })).toBe(0);
      const savedDir = join(registry, "history");
      const saved = readdirSync(savedDir).map((name) => readFileSync(join(savedDir, name), "utf-8")).join("\\n");
      expect(saved).toContain("<email-redacted>");
      expect(saved).toContain("token=<redacted>");
      expect(saved).not.toContain("owner@example.com");
      expect(saved).not.toContain("abc123");
      expect(saved).not.toContain("C:/Users/private");
      expect(readFileSync(source, "utf-8")).toContain("abc123");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("history discovery reports only named candidate metadata", () => {
    const base = join(tmpdir(), `sr-history-discover-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "chat-history.json"), "{}\n");
    writeFileSync(join(base, "unrelated.txt"), "private content");
    try {
      const candidates = discoverHistory([base]);
      expect(candidates.some((entry) => entry.path.endsWith("chat-history.json"))).toBe(true);
      expect(candidates.some((entry) => entry.path.endsWith("unrelated.txt"))).toBe(false);
      expect(Object.keys(candidates[0]).sort()).toEqual(["bytes", "modified", "path"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("llm sends only bounded composed context to an explicit endpoint", async () => {
    const base = join(tmpdir(), `sr-llm-${Date.now()}`);
    const skills = join(base, "skills");
    const registry = join(base, "registry");
    mkdirSync(join(skills, "docs-skill"), { recursive: true });
    writeFileSync(join(skills, "docs-skill", "SKILL.md"), "---\\nname: docs-skill\\ndescription: Write API documentation.\\n---\\n");
    const originalFetch = globalThis.fetch;
    let received;
    globalThis.fetch = async (_url, options) => {
      received = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "grounded answer" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      expect(await cmdLlm({ request: "write docs", endpoint: "http://localhost:1234/v1", model: "test-model", registry, dirs: skills, maxChars: 120 })).toBe(0);
      expect(received.model).toBe("test-model");
      expect(received.max_tokens).toBe(1200);
      expect(received.messages[0].content).toContain("parasite-skill-runtime-payload");
      expect(received.messages[0].content.length).toBeLessThan(20000);
      expect(await cmdLlm({ request: "write docs", endpoint: "http://remote.example/v1", model: "test-model", registry, dirs: skills })).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("routing against a scratch registry", () => {
  test("scan + route round-trips through the scoring engine", () => {
    const base = join(tmpdir(), `sr-roundtrip-${Date.now()}`);
    mkdirSync(join(base, "docs-skill"), { recursive: true });
    writeFileSync(
      join(base, "docs-skill", "SKILL.md"),
      "---\nname: docs-skill\ndescription: Write API and reference documentation, use when documenting code.\n---\n",
    );
    const payload = scan([base]);
    expect(payload.skills).toHaveLength(1);
    const { scored, setScores } = scoreIdea(payload, "document the new rest api");
    expect(scored[0][0]).toBe("docs-skill");
    expect(setScores.length).toBeGreaterThan(0);
  });

  test("frontmatter parser handles the expanded description blocks", () => {
    const meta = parseFrontmatter(
      "---\nname: block\ndescription: >\n  alpha\n  beta\n---\nbody",
    );
    expect(meta.description).toContain("alpha");
  });
});
