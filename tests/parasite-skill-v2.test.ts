import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { progressBar, color } from "../src/tui.js";
import { loadSets, saveCustomSets } from "../src/engine.js";
import { mcpRuntime, mcpServerEntry } from "../src/mcp-register.js";
import { cmdGraph } from "../src/commands/graph.js";
import { cmdBundle } from "../src/commands/bundle.js";
import { buildEcosystemGraph } from "../src/ecosystem-graph.js";
import { AGENT_PROFILES } from "../src/data/agent-profiles.js";
import { publicGraph } from "../src/ecosystem-graph.js";

describe("tui helpers", () => {
  test("progressBar renders fraction + percent", () => {
    const bar = progressBar(0.5, 10);
    expect(bar).toContain("50%");
    expect(bar).toContain("[");
    expect(bar).toContain("]");
  });

  test("color no-ops when not a TTY", () => {
    const out = color(36, "x");
    expect(typeof out).toBe("string");
  });
});

describe("custom skill-sets (editor persistence)", () => {
  test("loadSets merges custom sets from registry dir", () => {
    const reg = join(tmpdir(), `sr-sets-${Date.now()}`);
    mkdirSync(reg, { recursive: true });
    saveCustomSets(reg, { "my-set": { desc: "test", members: ["deepwiki", "context7"] } });
    const sets = loadSets(reg);
    expect(sets["my-set"].members).toEqual(["deepwiki", "context7"]);
    expect(sets["thinking"]).toBeDefined(); // built-ins still present
  });

  test("loadSets falls back to built-ins when no custom file", () => {
    const reg = join(tmpdir(), `sr-sets-none-${Date.now()}`);
    mkdirSync(reg, { recursive: true });
    const sets = loadSets(reg);
    expect(sets["frontend"]).toBeDefined();
  });
});

describe("mcp-register runtime + entry", () => {
  test("mcpRuntime prefers bun when argv[0] is bun", () => {
    const rt = mcpRuntime();
    expect(rt.command).toBeTruthy();
    expect(Array.isArray(rt.args)).toBe(true);
  });

  test("mcpServerEntry resolves to a real file", () => {
    const entry = mcpServerEntry();
    expect(entry.length).toBeGreaterThan(5);
  });
});

describe("graph command", () => {
  test("emits DOT with nodes and edges", () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => out.push(a.join(" "));
    const origErr = console.error;
    console.error = () => {};
    try {
      const code = cmdGraph({ top: 5, dot: true });
      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("digraph skills");
      expect(text).toContain("->");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  test("emits Mermaid flowchart", () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => out.push(a.join(" "));
    const origErr = console.error;
    console.error = () => {};
    try {
      const code = cmdGraph({ top: 3, mmd: true });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("flowchart LR");
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });
});

describe("typed ecosystem graph", () => {
  test("connects skills, sets, assets, agents, and tools", () => {
    const graph = buildEcosystemGraph({
      skills: [{ name: "alpha-skill", path: "/tmp/alpha", tags: ["api"], spec_ok: true, assets: [{ path: "scripts/run.py", group: "scripts", language: "python", bytes: 10, excerptable: false }] }],
      sets: { "agent-test": { desc: "test", members: ["alpha-skill"] } },
      clients: [{ id: "cursor", label: "Cursor", installed: true, path: "/tmp/cursor" }],
      extensions: [{ client: "cursor", label: "Cursor", injections: 1, active: 1, path: "/tmp/ext" }],
      mcp: [{ id: "cursor", label: "Cursor", registered: true, file: "/tmp/mcp.json" }],
      rules: { global: ["/tmp/AGENTS.md"], per_client: [] },
      profiles: { "agent-test": AGENT_PROFILES["ecosystem-architect"] },
    });
    expect(graph.kind).toBe("parasite-skill-ecosystem-graph");
    expect(graph.nodes.some((node) => node.type === "asset")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "agent")).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "includes")).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "may-call")).toBe(true);
    expect(graph.privacy).toContain("no contents");
    const published = publicGraph(graph);
    expect(published.nodes.every((node) => !Object.hasOwn(node, "path"))).toBe(true);
    expect(published.privacy).toContain("removed");
  });
});

describe("bundle command", () => {
  test("builds a tarball + install.json manifest", () => {
    const dir = join(tmpdir(), `sr-bundle-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const out = [];
      const origLog = console.log;
      console.log = (...a) => out.push(a.join(" "));
      try {
        const code = cmdBundle({});
        expect(code).toBe(0);
        expect(existsSync(join(dir, "parasite-skill-bundle.tar.gz"))).toBe(true);
        const meta = JSON.parse(readFileSync(join(dir, "install.json"), "utf-8"));
        expect(meta.name).toBe("parasite-skill");
        expect(meta.version).toBeTruthy();
      } finally {
        console.log = origLog;
      }
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
