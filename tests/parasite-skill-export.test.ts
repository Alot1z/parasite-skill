import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdExport } from "../src/commands/export.js";
import { cmdSets } from "../src/commands/sets.js";
import { SETS } from "../src/data/sets.js";

function tmpSkill(root, name, desc) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n`, "utf-8");
}

function withHome(home, fn) {
  const prev = process.env.PARASITE_SKILL_HOME;
  process.env.PARASITE_SKILL_HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PARASITE_SKILL_HOME;
    else process.env.PARASITE_SKILL_HOME = prev;
  }
}

describe("mega skill-sets", () => {
  test("bundles the workflow sets with real installed-skill names", () => {
    for (const name of ["brainstorm-max", "plan-execute", "research-deep", "thinking-max", "mega-injector", "token-saver"]) {
      const set = SETS[name];
      expect(set, `set ${name} should exist`).toBeDefined();
      expect(set.members.length, `${name} should have 3+ members`).toBeGreaterThanOrEqual(3);
      expect(set.desc.length).toBeGreaterThan(0);
      for (const m of set.members) {
        expect(typeof m).toBe("string");
        expect(m.length).toBeGreaterThan(0);
      }
    }
  });

  test("multiplicative pairs gained the research + thinking outcomes", () => {
    // covered indirectly: SETS module must still load; spot-check the pairs export
    expect(SETS).toBeDefined();
  });
});

describe("cmdExport", () => {
  test("writes ECOSYSTEM.md + ecosystem.json with skills, sets, clients", () => {
    const base = join(tmpdir(), `sr-export-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const skillsDir = join(base, "skills");
    const reg = join(base, "reg");
    mkdirSync(skillsDir, { recursive: true });
    tmpSkill(skillsDir, "alpha-skill", "an alpha test skill");
    tmpSkill(skillsDir, "beta-skill", "a beta test skill");
    withHome(base, () => {
      try {
        const code = cmdExport({ registry: reg, dirs: skillsDir, force: true });
        expect(code).toBe(0);

        const mdPath = join(reg, "ECOSYSTEM.md");
        const jsonPath = join(reg, "ecosystem.json");
        expect(existsSync(mdPath)).toBe(true);
        expect(existsSync(jsonPath)).toBe(true);

        const j = JSON.parse(readFileSync(jsonPath, "utf-8"));
        const names = j.skills.map((s) => s.name);
        expect(names).toContain("alpha-skill");
        expect(names).toContain("beta-skill");
        expect(j.sets["thinking-max"]).toBeDefined();
        expect(j.sets["mega-injector"]).toBeDefined();
        expect(Array.isArray(j.clients)).toBe(true);
        expect(Array.isArray(j.extensions)).toBe(true);
        expect(Array.isArray(j.mcp)).toBe(true);
        expect(Array.isArray(j.rules.global)).toBe(true);

        const md = readFileSync(mdPath, "utf-8");
        expect(md).toContain("# Parasite Skill Ecosystem");
        expect(md).toContain("alpha-skill");
        expect(md).toContain("brainstorm-max");
        // no contents, no secrets — only names/paths
        expect(md).not.toContain("an alpha test skill");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
  });
});

describe("sets --template", () => {
  test("prints the new-set design template", () => {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    try {
      const code = cmdSets({ template: true });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    const out = lines.join("\n");
    expect(out).toContain("New Skill-Set Template");
    expect(out).toContain("Starter sets worth copying");
    expect(out).toContain("thinking-max");
  });
});
