import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { skillSourceDir } from "../clients.js";
import { VERSION } from "../engine.js";

/**
 * Build a distributable bundle: a tarball of the skill payload + install.json
 * manifest. Served from GitHub Pages so users can install with zero npm:
 *   curl -fsSL https://USER.github.io/skill-router/install.sh | bash
 */
export function cmdBundle(ctx = {}) {
  const source = skillSourceDir();
  if (!existsSync(source)) {
    console.error(`skill payload not found at ${source}`);
    return 1;
  }
  const out = ctx.out || join(process.cwd(), "skill-router-bundle.tar.gz");
  const meta = ctx.meta || join(process.cwd(), "install.json");
  const tmp = join(process.cwd(), ".bundle-tmp");
  mkdirSync(tmp, { recursive: true });

  // Stage a copy so the tarball has a clean top-level dir name.
  const stage = join(tmp, "skill");
  rmSync(stage, { recursive: true, force: true });
  cpSync(source, stage, { recursive: true });

  try {
    // Run inside tmp with a bare filename so Windows tar doesn't treat the
    // drive-letter path as a remote host. Copy out afterwards.
    execFileSync("tar", ["-czf", "bundle.tar.gz", "skill"], { cwd: tmp });
    cpSync(join(tmp, "bundle.tar.gz"), out);
  } catch (err) {
    console.error(`tar failed: ${String(err.message ?? err)}`);
    return 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const manifest = {
    name: "skill-router",
    version: VERSION,
    description: "skill-router — route any request to the right agent skills",
    bundleUrl: "skill-router-bundle.tar.gz",
    files: ["SKILL.md", "references", "templates", "scripts"],
    install: {
      defaultMode: "copy",
      supportsLink: true,
      clients: ["claude-code", "codex", "opencode", "cline", "cursor", "windsurf", "gemini-cli", "universal"],
    },
    updated: new Date().toISOString(),
  };
  writeFileSync(meta, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`bundle: ${out}`);
  console.log(`meta:   ${meta}`);
  try {
    console.log(`size:   ${Math.round(statSync(out).size / 1024)} KB`);
  } catch {
    /* ignore */
  }
  return 0;
}
