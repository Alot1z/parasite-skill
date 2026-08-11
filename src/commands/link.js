import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandDirs, registryDir } from "../engine.js";
import { fmt } from "./_lib.js";

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function cmdLink(args) {
  const reg = registryDir(args.registry);
  const dirs = args.no_default
    ? (args.dirs ?? "").split(",").map((p) => p.trim()).filter(Boolean)
    : expandDirs(args.dirs);
  if (!dirs.length) {
    console.error("no dirs given: use --dirs <path> (optionally with --no-default)");
    return 1;
  }
  const rows = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || !e.isDirectory()) continue;
      const skillPath = join(d, e.name);
      if (!existsSync(join(skillPath, "SKILL.md"))) continue;
      const manifest = join(skillPath, ".parasite-skill.links.json");
      const name = e.name;
      if (args.unlink) {
        const errors = [];
        for (const link of ["refs", "wiki"]) {
          const lp = join(skillPath, link);
          if (isLink(lp)) {
            rmSync(lp, { recursive: true, force: true });
          } else if (existsSync(lp)) {
            try {
              rmSync(lp, { recursive: false, force: true });
            } catch {
              errors.push(`could not remove ${link}`);
            }
          }
        }
        if (errors.length) {
          rows.push(`${name}: ${errors.join("; ")} (left in place, no data removed)`);
        } else {
          if (existsSync(manifest)) rmSync(manifest);
          rows.push(`unlinked ${name}`);
        }
      } else {
        const messages = [];
        const refsTarget = join(reg, "refs", name);
        const wikiTarget = join(reg, "wikis", "skills", name);
        mkdirSync(refsTarget, { recursive: true });
        mkdirSync(wikiTarget, { recursive: true });
        for (const [linkName, target] of [["refs", refsTarget], ["wiki", wikiTarget]]) {
          const lp = join(skillPath, linkName);
          if (existsSync(lp) || isLink(lp)) {
            messages.push(`${linkName}:skipped-exists`);
            continue;
          }
          try {
            symlinkSync(target, lp, process.platform === "win32" ? "junction" : "dir");
            messages.push(`${linkName}:link`);
          } catch {
            messages.push(`${linkName}:manifest-only`);
          }
        }
        writeFileSync(
          manifest,
          JSON.stringify(
            {
              skill: name,
              registry: fmt(reg),
              refs: fmt(join(refsTarget, "index.md")),
              wiki: fmt(join(wikiTarget, "index.md")),
              links: messages,
              created_at: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        rows.push(`${name}: ${messages.join(", ")}`);
      }
    }
  }
  console.log(rows.join("\n"));
  console.log(`${args.unlink ? "unlinked" : "linked"} ${rows.length} skills`);
  return 0;
}
