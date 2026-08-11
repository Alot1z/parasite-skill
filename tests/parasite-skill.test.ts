import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFrontmatter,
  scan,
  scoreIdea,
  stem,
  tokenize,
} from "../src/engine.js";

describe("parseFrontmatter", () => {
  test("parses simple fields", () => {
    const meta = parseFrontmatter("---\nname: foo-bar\ndescription: Does things.\n---\nbody");
    expect(meta.name).toBe("foo-bar");
    expect(meta.description).toBe("Does things.");
  });

  test("parses folded block scalars (description: >-)", () => {
    const meta = parseFrontmatter(
      "---\nname: multi\ndescription: >-\n  line one\n  line two\n---\nbody",
    );
    expect(meta.description).toBe("line one line two");
  });

  test("parses quoted values", () => {
    const meta = parseFrontmatter('---\nname: q\ndescription: "hello world"\n---\n');
    expect(meta.description).toBe("hello world");
  });
});

describe("tokenize + stem", () => {
  test("stems plurals and -ing consistently", () => {
    expect(stem("debugging")).toBe("debug");
    expect(stem("debug")).toBe("debug");
    expect(stem("tests")).toBe("test");
    expect(stem("failing")).toBe("fail");
    expect(stem("running")).toBe("run");
  });

  test("drops stopwords and 1-char tokens", () => {
    const t = tokenize("the quick a brown fox");
    expect(t).toEqual(["quick", "brown", "fox"]);
  });
});

describe("scan + spec validation", () => {
  test("discovers a skill dir and validates it", () => {
    const base = join(tmpdir(), `sr-test-${Date.now()}`);
    mkdirSync(join(base, "demo-skill", "scripts"), { recursive: true });
    writeFileSync(
      join(base, "demo-skill", "SKILL.md"),
      "---\nname: demo-skill\ndescription: A demo skill for testing routing.\n---\nbody",
    );
    writeFileSync(join(base, "demo-skill", "scripts", "tool.py"), "print('hi')");
    const payload = scan([base]);
    expect(payload.skills).toHaveLength(1);
    const s = payload.skills[0];
    expect(s.name).toBe("demo-skill");
    expect(s.spec_ok).toBe(true);
    expect(s.languages).toContain("python");
    expect(s.tags.length).toBeGreaterThan(0);
  });

  test("flags a name/dir mismatch", () => {
    const base = join(tmpdir(), `sr-bad-${Date.now()}`);
    mkdirSync(join(base, "wrong-dir-name"), { recursive: true });
    writeFileSync(
      join(base, "wrong-dir-name", "SKILL.md"),
      "---\nname: actual-name\ndescription: x\n---\n",
    );
    const payload = scan([base]);
    expect(payload.skills[0].spec_ok).toBe(false);
  });
});

describe("scoreIdea", () => {
  test("ranks an idea's best match first", () => {
    const base = join(tmpdir(), `sr-route-${Date.now()}`);
    mkdirSync(join(base, "test-skill"), { recursive: true });
    writeFileSync(
      join(base, "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: Write and run unit tests, use when testing code.\n---\n",
    );
    mkdirSync(join(base, "art-skill"), { recursive: true });
    writeFileSync(
      join(base, "art-skill", "SKILL.md"),
      "---\nname: art-skill\ndescription: Draw generative art with p5.js.\n---\n",
    );
    const payload = scan([base]);
    const { scored } = scoreIdea(payload, "write unit tests for the api");
    expect(scored[0][0]).toBe("test-skill");
  });

  test("routes on SKILL.md body keywords when the description is thin", () => {
    const base = join(tmpdir(), `sr-body-${Date.now()}`);
    mkdirSync(join(base, "auth-skill"), { recursive: true });
    writeFileSync(
      join(base, "auth-skill", "SKILL.md"),
      [
        "---",
        "name: auth-skill",
        "description: Handles things generically.",
        "---",
        "# Auth",
        "Implements OAuth2 flows, JWT signing, and session management for web apps.",
        "",
      ].join("\n"),
    );
    const payload = scan([base]);
    const s = payload.skills[0];
    expect(s.bodyKeywords).toContain("oauth2");
    const { scored } = scoreIdea(payload, "oauth2 jwt session management");
    expect(scored[0][0]).toBe("auth-skill");
  });

  test("description keywords outrank body-only keywords", () => {
    const base = join(tmpdir(), `sr-descbody-${Date.now()}`);
    mkdirSync(join(base, "crypto-skill"), { recursive: true });
    writeFileSync(
      join(base, "crypto-skill", "SKILL.md"),
      [
        "---",
        "name: crypto-skill",
        "description: Cryptographic signing and hashing.",
        "---",
        "# Body",
        "Uses sha256 and hmac.",
        "",
      ].join("\n"),
    );
    mkdirSync(join(base, "integrity-skill"), { recursive: true });
    writeFileSync(
      join(base, "integrity-skill", "SKILL.md"),
      [
        "---",
        "name: integrity-skill",
        "description: Generic utilities.",
        "---",
        "# Body",
        "Performs cryptographic hashing with sha256 and hmac for data integrity.",
        "",
      ].join("\n"),
    );
    const payload = scan([base]);
    const { scored } = scoreIdea(payload, "cryptographic hashing sha256");
    expect(scored[0][0]).toBe("crypto-skill");
  });

});
