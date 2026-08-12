import { describe, expect, test, beforeAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSite } from "../src/commands/site.js";
import { validateSite } from "../src/site/validate.js";

const BASE = join(tmpdir(), `sr-site-${Date.now()}`);
const SKILLS = join(BASE, "skills");
const REGISTRY = join(BASE, "registry");
const OUT = join(BASE, "public");

beforeAll(() => {
  mkdirSync(join(SKILLS, "demo-skill"), { recursive: true });
  writeFileSync(
    join(SKILLS, "demo-skill", "SKILL.md"),
    "---\nname: demo-skill\ndescription: Debug failing tests and verify fixes, use when debugging.\n---\n# Demo Skill\n\nA demo skill used to exercise the site generator.\n\n- tags: debugging\n",
  );
});

const common = { registry: REGISTRY, dirs: SKILLS, force: true, base: "https://example.test/ps" };

describe("site build", () => {
  test("builds the full site and returns exit 0", async () => {
    const code = await cmdSite({ idea: "build", out: OUT, ...common });
    expect(code).toBe(0);
  });

  test("emits the expected physical routes", () => {
    const required = [
      "index.html",
      "features/index.html",
      "architecture/index.html",
      "configuration/index.html",
      "guides/index.html",
      "guides/routing/index.html",
      "reference/index.html",
      "reference/commands/index.html",
      "skills/index.html",
      "skills/demo-skill/index.html",
      "tools/index.html",
      "agents/index.html",
      "clients/index.html",
      "mcp/index.html",
      "hooks/index.html",
      "changelog/index.html",
      "docs/index.html",
      "docs/mcp/index.html",
      "wiki/Home/index.html",
      "wiki/Skills/index.html",
      "llms.txt",
      "llms-full.txt",
      "sitemap.xml",
      "robots.txt",
      "site-index.json",
      "routes.json",
      "data/index.json",
      "site.css",
      "search.js",
      "404.html",
    ];
    for (const file of required) {
      expect(existsSync(join(OUT, file)), `missing ${file}`).toBe(true);
    }
  });

  test("every page carries a markdown twin for LLM ingestion", () => {
    expect(existsSync(join(OUT, "skills/demo-skill/index.md"))).toBe(true);
    expect(existsSync(join(OUT, "guides/routing/index.md"))).toBe(true);
  });

  test("llms.txt links the full corpus; llms-full.txt contains page content", () => {
    const txt = readFileSync(join(OUT, "llms.txt"), "utf-8");
    expect(txt).toContain("llms-full.txt");
    expect(txt).toContain("demo-skill");
    const full = readFileSync(join(OUT, "llms-full.txt"), "utf-8");
    expect(full).toContain("page: skills/demo-skill/");
    expect(full).toContain("Debug failing tests");
  });

  test("sitemap lists the deep skill route; robots points at the sitemap", () => {
    const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf-8");
    expect(sitemap).toContain("https://example.test/ps/skills/demo-skill/");
    const robots = readFileSync(join(OUT, "robots.txt"), "utf-8");
    expect(robots).toContain("sitemap.xml");
  });

  test("search index and route manifest parse and cover the skill page", () => {
    const index = JSON.parse(readFileSync(join(OUT, "site-index.json"), "utf-8"));
    expect(index.some((e) => e.url === "skills/demo-skill/" && /demo-skill/i.test(e.title))).toBe(true);
    const routes = JSON.parse(readFileSync(join(OUT, "routes.json"), "utf-8"));
    expect(routes.routes.some((r) => r.url === "skills/demo-skill/")).toBe(true);
  });

  test("data/index.json is public-safe (no filesystem paths) and counts the skill", () => {
    const data = JSON.parse(readFileSync(join(OUT, "data/index.json"), "utf-8"));
    expect(data.counts.skills).toBeGreaterThanOrEqual(1);
    expect(data.skills.some((s) => s.name === "demo-skill")).toBe(true);
    expect(data.skills[0].path).toBeUndefined();
  });

  test("no broken internal links (validateSite gate)", () => {
    const res = validateSite(OUT);
    expect(res.problems).toEqual([]);
    expect(res.checks.not_found).toBe(true);
  });

  test("site validate command exits 0 on a clean build and 2 on a bad action", async () => {
    expect(await cmdSite({ idea: "validate", out: OUT, ...common })).toBe(0);
    expect(await cmdSite({ idea: "bogus", out: OUT, ...common })).toBe(2);
  });
});

describe("site renderer", () => {
  test("markdown tables, code fences, and links render to HTML", async () => {
    const { renderMarkdown } = await import("../src/site/render.js");
    const html = renderMarkdown("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx()\n```\n\n[link](docs/mcp.md)");
    expect(html).toContain("<h1");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("<a href=\"docs/mcp.md\"");
  });
});
