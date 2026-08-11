import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFlags } from "../src/cli.js";
import { handleMessage } from "../src/mcp-server.js";
import { CLIENTS, detectClients } from "../src/clients.js";
import { scan, scoreIdea, parseFrontmatter } from "../src/engine.js";

describe("parseFlags", () => {
  test("parses value flags and bool flags", () => {
    const f = parseFlags(["route", "--top", "5", "--set", "an idea"]);
    expect(f._).toEqual(["route", "an idea"]);
    expect(f.top).toBe(5);
    expect(f.set).toBe(true);
  });

  test("tolerates a bad --top value (NaN guard)", () => {
    const f = parseFlags(["route", "--top", "abc", "x"]);
    expect(f.top).toBeUndefined();
  });

  test("parses --agent list and mode flags", () => {
    const f = parseFlags(["install", "-a", "claude-code,codex", "--link", "--yes"]);
    expect(f.agents).toEqual(["claude-code", "codex"]);
    expect(f.mode).toBe("link");
    expect(f.yes).toBe(true);
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
    const detected = detectClients();
    expect(detected.length).toBeGreaterThan(0);
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
    expect(res.result.serverInfo.name).toBe("skill-router");
    expect(res.result.capabilities.tools).toEqual({});
  });

  test("ping returns empty result", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "ping", params: {} });
    expect(res.result).toEqual({});
  });

  test("tools/list exposes the full tool set", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const names = res.result.tools.map((t) => t.name);
    for (const n of ["scan", "validate", "route", "sets", "plan", "refs", "wikis", "list_installs"]) {
      expect(names).toContain(n);
    }
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
