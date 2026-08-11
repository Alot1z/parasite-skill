import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandDirs, registryDir, scan } from "../engine.js";
import { fmt } from "./_lib.js";

export function cmdScan(args) {
  const reg = registryDir(args.registry);
  const payload = scan(expandDirs(args.dirs));
  writeFileSync(join(reg, "registry.json"), JSON.stringify(payload, null, 2));
  const langs = [...new Set(payload.skills.flatMap((s) => s.languages))].sort();
  const invalid = payload.skills.filter((s) => !s.spec_ok).map((s) => s.name);
  if (args.json) {
    console.log(JSON.stringify({ total: payload.skills.length, languages: langs, issues: invalid }, null, 2));
    return 0;
  }
  console.log(`scanned ${payload.skills.length} skills from ${payload.scan_dirs.length} dirs`);
  console.log(`languages detected: ${langs.join(", ") || "none"}`);
  console.log(`spec issues: ${invalid.length} (${invalid.join(", ") || "none"})`);
  console.log(`registry: ${fmt(join(reg, "registry.json"))}`);
  return 0;
}
