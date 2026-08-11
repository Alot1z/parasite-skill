import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig, mergeConfig, loadSetsWithProject } from "../src/engine.js";
import { cmdSets } from "../src/commands/sets.js";
import { cmdRoute } from "../src/commands/route.js";
import { addInjection, toggleInjection, removeInjection, getExtensionDir } from "../src/parasite/index.js";
import { symlinkSync } from "node:fs";
import { scan } from "../src/engine.js";

function tmpSkill(name, desc) {
  const dir = join(tmpdir(), `sr-config-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n`, "utf-8");
  return dir;
}

describe("loadProjectConfig", () => {
  test("finds parasite-skill.json walking up from a subdirectory", () => {
    const base = join(tmpdir(), `sr-walk-${Date.now()}`);
    const nested = join(base, "a", "b");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(base, "parasite-skill.json"), JSON.stringify({ defaultSet: "build" }), "utf-8");
    try {
      const cfg = loadProjectConfig(nested);
      expect(cfg).not.toBeNull();
      expect(cfg.defaultSet).toBe("build");
      expect(cfg._dir).toBe(base);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("also accepts the dotted .parasite-skill.json name", () => {
    const base = join(tmpdir(), `sr-dotted-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, ".parasite-skill.json"), JSON.stringify({ force: true }), "utf-8");
    try {
      const cfg = loadProjectConfig(join(base, "src"));
      expect(cfg).not.toBeNull();
      expect(cfg.force).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("returns null when no config exists in the tree", () => {
    const base = join(tmpdir(), `sr-none-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    try {
      expect(loadProjectConfig(base)).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("mergeConfig", () => {
  test("CLI flags take precedence over project defaults", () => {
    const merged = mergeConfig(
      { registry: "cfg-reg", dirs: "cfg-dirs", defaultSet: "build", force: true },
      { dirs: "cli-dirs", top: 5 }
    );
    expect(merged.dirs).toBe("cli-dirs");
    expect(merged.registry).toBe("cfg-reg");
    // config defaultSet maps to the --set flag semantics
    expect(merged.set).toBe("build");
    expect(merged.force).toBe(true);
    expect(merged.top).toBe(5);
  });

  test("merges project skill-sets onto the ctx", () => {
    const merged = mergeConfig(
      { sets: { "proj-qa": { desc: "qa", members: ["code-review-and-quality"] } } },
      { top: 3 }
    );
    expect(merged.sets["proj-qa"].members).toEqual(["code-review-and-quality"]);
  });

  test("ignores malformed sets with a warning", () => {
    const merged = mergeConfig({ sets: "not-an-object" }, {});
    expect(merged.sets).toBeUndefined();
    const merged2 = mergeConfig({ sets: { bad: { members: "nope" } } }, {});
    expect(merged2.sets).toBeUndefined();
  });

  test("null project config passes CLI flags through untouched", () => {
    expect(mergeConfig(null, { top: 3 })).toEqual({ top: 3 });
  });
});

describe("loadSetsWithProject", () => {
  test("overlays project sets over the registry sets and marks them", () => {
    const reg = join(tmpdir(), `sr-reg-${Date.now()}`);
    mkdirSync(reg, { recursive: true });
    const sets = loadSetsWithProject(reg, {
      "proj-qa": { desc: "qa", members: ["verification-before-completion", "code-review-and-quality"] },
    });
    expect(sets["proj-qa"].project).toBe(true);
    expect(sets["proj-qa"].members).toHaveLength(2);
    // built-ins survive
    expect(sets["thinking"].members.length).toBeGreaterThan(0);
  });
});

describe("project sets in commands", () => {
  test("cmdSets lists a project set with its marker", () => {
    const reg = join(tmpdir(), `sr-cmdsets-${Date.now()}`);
    mkdirSync(reg, { recursive: true });
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdSets({
        registry: reg,
        sets: { "proj-qa": { desc: "project QA", members: ["code-review-and-quality"] } },
      });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    const out = logs.join("\n");
    expect(out).toContain("proj-qa");
    expect(out).toContain("(project)");
  });

  test("cmdSets refuses to edit a project set via the editor", () => {
    const reg = join(tmpdir(), `sr-guard-${Date.now()}`);
    mkdirSync(reg, { recursive: true });
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    try {
      const code = cmdSets({
        registry: reg,
        add: "proj-qa:knip",
        sets: { "proj-qa": { desc: "project QA", members: ["code-review-and-quality"] } },
      });
      expect(code).toBe(1);
    } finally {
      console.error = origErr;
    }
    expect(errs.join("\n")).toContain("edit the config file directly");
  });

  test("cmdRoute routes within a project set (no unknown-set error)", () => {
    const reg = join(tmpdir(), `sr-cmdroute-${Date.now()}`);
    const skillDir = tmpSkill("qa-skill", "project local QA helper");
    mkdirSync(reg, { recursive: true });
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    try {
      const code = cmdRoute({
        registry: reg,
        dirs: skillDir,
        idea: "review my changes before merge",
        set: "proj-qa",
        top: 2,
        sets: { "proj-qa": { desc: "project QA", members: ["code-review-and-quality"] } },
      });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
      rmSync(skillDir, { recursive: true, force: true });
    }
    expect(logs.join("\n")).toContain("top skills within set 'proj-qa'");
  });
});

describe("scan follows symlinked/junction skill dirs", () => {
  test("discovers a skill reachable only through a link (--link install mode)", () => {
    if (process.platform === "win32" && typeof Bun === "undefined") {
      // bun:test runs on Bun; junction type requires win32 — guard anyway.
    }
    const base = join(tmpdir(), `sr-link-${Date.now()}`);
    const real = join(base, "real-location");
    const scanRoot = join(base, "skills");
    mkdirSync(real, { recursive: true });
    mkdirSync(scanRoot, { recursive: true });
    writeFileSync(join(real, "SKILL.md"), "---\nname: linked-skill\ndescription: reached through a junction or symlink\n---\n", "utf-8");
    try {
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(real, join(scanRoot, "linked-skill"), type);
      const payload = scan([scanRoot]);
      const names = payload.skills.map((s) => s.name);
      expect(names).toContain("linked-skill");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("parasite injection roundtrip (non-invasive)", () => {
  test("add -> status -> toggle -> remove, originals untouched", () => {
    const base = join(tmpdir(), `sr-parasite-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    const client = { id: "test-client", label: "Test", user: base };
    const extDir = getExtensionDir(client);
    const manifestPath = join(extDir, "parasite-manifest.json");

    try {
      const inj = addInjection(client, { type: "hook", code: "console.log('x')", target: "default" });
      expect(inj.enabled).toBe(true);
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(join(extDir, `${inj.id}.js`))).toBe(true);

      let manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.injections).toHaveLength(1);
      expect(manifest.injections[0].enabled).toBe(true);

      expect(toggleInjection(client, inj.id, false)).toBe(true);
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.injections[0].enabled).toBe(false);

      expect(toggleInjection(client, "does-not-exist", false)).toBe(false);

      expect(removeInjection(client, inj.id)).toBe(true);
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.injections).toHaveLength(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
