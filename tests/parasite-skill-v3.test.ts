import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/engine.js";
import { banner, LOGO, smallLogo } from "../src/logo.js";

describe("logo (multicolor gradient)", () => {
  test("wordmark renders with truecolor gradient codes", () => {
    // Force color so the gradient path is deterministic on non-TTY runners.
    const prev = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    try {
      const b = banner();
      expect(b).toContain("PARASITE");
      expect(b).toContain("SKILL");
      // Gradient should emit 24-bit color codes (indigo/cyan/teal stops).
      expect(b).toContain("38;2");
    } finally {
      if (prev === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prev;
    }
  });

  test("LOGO contains the parasite skill hub motif", () => {
    expect(LOGO).toContain("┌──────────┐");
    expect(LOGO).toContain("PARASITE");
    expect(LOGO).toContain("SKILL");
  });

  test("smallLogo is non-empty and bracketed", () => {
    const s = smallLogo();
    expect(s.length).toBeGreaterThan(10);
    expect(s).toContain("[");
    expect(s).toContain("]");
  });
});

describe("manifest-based language detection", () => {
  test("Cargo.toml alone marks a skill as rust (no scripts dir)", () => {
    const base = join(tmpdir(), `sr-rust-${Date.now()}`);
    mkdirSync(join(base, "rust-skill"), { recursive: true });
    writeFileSync(
      join(base, "rust-skill", "SKILL.md"),
      "---\nname: rust-skill\ndescription: Build rust CLIs with cargo.\n---\n",
    );
    writeFileSync(join(base, "rust-skill", "Cargo.toml"), "[package]\nname = \"tool\"\n");
    const payload = scan([base]);
    expect(payload.skills).toHaveLength(1);
    expect(payload.skills[0].languages).toContain("rust");
  });

  test("go.mod marks a skill as go", () => {
    const base = join(tmpdir(), `sr-go-${Date.now()}`);
    mkdirSync(join(base, "go-skill"), { recursive: true });
    writeFileSync(
      join(base, "go-skill", "SKILL.md"),
      "---\nname: go-skill\ndescription: Go tooling.\n---\n",
    );
    writeFileSync(join(base, "go-skill", "go.mod"), "module x\n");
    const payload = scan([base]);
    expect(payload.skills[0].languages).toContain("go");
  });
});
