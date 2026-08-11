import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig } from "../src/engine.js";
import { cmdRoute } from "../src/commands/route.js";
import { cmdParasite } from "../src/commands/parasite.js";

// Build a scan root containing skill subdirectories (scan() treats each dir
// as a container of skill dirs, mirroring ~/.agents/skills).
function tmpScanRoot(name, skills) {
  const root = join(tmpdir(), `sr-pc-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  for (const [sname, desc] of Object.entries(skills)) {
    const dir = join(root, sname);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${sname}\ndescription: ${desc}\n---\n`, "utf-8");
  }
  return root;
}

describe("mergeConfig extended schema", () => {
  test("parses enabledSets, excludeSkills, route, env, parasite, clients", () => {
    const merged = mergeConfig(
      {
        enabledSets: ["build", "review"],
        excludeSkills: ["old-skill"],
        route: { top: 5, minScore: 3 },
        env: { API_URL: "http://localhost" },
        parasite: { enabled: true, clients: ["cursor"] },
        clients: ["claude-code", "cursor"],
      },
      { top: 7 }
    );
    expect(merged.enabledSets).toEqual(["build", "review"]);
    expect(merged.excludeSkills).toEqual(["old-skill"]);
    expect(merged.route).toEqual({ top: 5, minScore: 3 });
    expect(merged.env).toEqual({ API_URL: "http://localhost" });
    expect(merged.parasite).toEqual({ enabled: true, clients: ["cursor"] });
    expect(merged.clients).toEqual(["claude-code", "cursor"]);
    // CLI --top still wins over route.top
    expect(merged.top).toBe(7);
  });

  test("boolean parasite false maps to { enabled: false }", () => {
    expect(mergeConfig({ parasite: false }, {}).parasite).toEqual({ enabled: false });
    expect(mergeConfig({ parasite: true }, {}).parasite).toEqual({ enabled: true });
  });

  test("rejects malformed values without crashing", () => {
    const merged = mergeConfig(
      { enabledSets: "nope", excludeSkills: 5, route: [], env: "x", parasite: "y", clients: 7 },
      {}
    );
    expect(merged.enabledSets).toBeUndefined();
    expect(merged.excludeSkills).toBeUndefined();
    expect(merged.route).toBeUndefined();
    expect(merged.env).toBeUndefined();
    expect(merged.parasite).toBeUndefined();
    expect(merged.clients).toBeUndefined();
  });

  test("route with only invalid knobs is dropped", () => {
    expect(mergeConfig({ route: { top: -1 } }, {}).route).toBeUndefined();
  });
});

describe("cmdRoute project routing controls", () => {
  beforeAll(() => {
    // Isolate scans from the real ~/.agents/skills. BASE_HOME reads the env
    // at call-time, so setting it here (before the describe runs) is enough.
    process.env.PARASITE_SKILL_HOME = join(tmpdir(), "sr-pc-home-" + Date.now());
  });
  afterAll(() => {
    delete process.env.PARASITE_SKILL_HOME;
  });

  test("excludeSkills removes a skill from results", () => {
    const reg = join(tmpdir(), `sr-pc-reg1-${Date.now()}`);
    const root = tmpScanRoot("root1", {
      "alpha-skill": "alpha authentication routing for web apps",
      "beta-skill": "beta authentication routing for web apps",
    });
    mkdirSync(reg, { recursive: true });
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdRoute({
        registry: reg,
        dirs: root,
        idea: "implement authentication",
        json: true,
        excludeSkills: ["alpha-skill"],
        top: 10,
      });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
      rmSync(root, { recursive: true, force: true });
    }
    const parsed = JSON.parse(logs.join("\n"));
    const names = parsed.scores.map(([n]) => n);
    expect(names).toContain("beta-skill");
    expect(names).not.toContain("alpha-skill");
    expect(parsed.filters.excludeSkills).toEqual(["alpha-skill"]);
  });

  test("enabledSets restricts routing to set members only", () => {
    const reg = join(tmpdir(), `sr-pc-reg2-${Date.now()}`);
    const root = tmpScanRoot("root2", {
      "alpha-skill": "alpha authentication routing for web apps",
      "beta-skill": "beta authentication routing for web apps",
    });
    mkdirSync(reg, { recursive: true });
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdRoute({
        registry: reg,
        dirs: root,
        idea: "implement authentication",
        json: true,
        enabledSets: ["proj-a"],
        top: 10,
        sets: { "proj-a": { desc: "only alpha", members: ["alpha-skill"] } },
      });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
      rmSync(root, { recursive: true, force: true });
    }
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.scores.map(([n]) => n)).toEqual(["alpha-skill"]);
    expect(parsed.sets.map(([n]) => n)).toEqual(["proj-a"]);
  });

  test("route.minScore drops low scores", () => {
    const reg = join(tmpdir(), `sr-pc-reg3-${Date.now()}`);
    const root = tmpScanRoot("root3", {
      "alpha-skill": "alpha authentication routing for web apps",
    });
    mkdirSync(reg, { recursive: true });
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdRoute({
        registry: reg,
        dirs: root,
        idea: "implement authentication",
        json: true,
        route: { minScore: 9999 },
        top: 10,
      });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
      rmSync(root, { recursive: true, force: true });
    }
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.scores).toEqual([]);
    // without the minScore floor the skill would score > 0
    expect(parsed.filters.minScore).toBe(9999);
  });
});

describe("cmdParasite per-project control", () => {
  test("parasite: false reports disabled and exits 0", () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdParasite({ parasite: { enabled: false } });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs.join("\n")).toContain("disabled for this project");
  });

  test("parasite client allowlist blocks --add for other clients", () => {
    const errs = [];
    const origErr = console.error;
    const origLog = console.log;
    console.error = (...a) => errs.push(a.join(" "));
    console.log = () => {};
    try {
      const code = cmdParasite({ parasite: { enabled: true, clients: ["claude-code"] }, add: "hook", agent: "cursor", code: "x", type: "hook", target: "default" });
      expect(code).toBe(1);
    } finally {
      console.error = origErr;
      console.log = origLog;
    }
    expect(errs.join("\n")).toContain("not in this project. allowed clients");
  });
});
