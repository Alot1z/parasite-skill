import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandDirs, registryDir, scan } from "../engine.js";
import { runAutoGc } from "./tools.js";
import { fmt } from "./_lib.js";

export function cmdScan(args) {
  const reg = registryDir(args.registry);
  const t0 = performance.now();
  const payload = scan(expandDirs(args.dirs));
  const elapsedMs = (performance.now() - t0).toFixed(1);
  writeFileSync(join(reg, "registry.json"), JSON.stringify(payload, null, 2));
  // Scheduled GC: honor the project gc TTL policy (auto: true) so stale
  // registry artifacts never accumulate across scans.
  runAutoGc(reg, args);
  const langs = [...new Set(payload.skills.flatMap((s) => s.languages))].sort();
  const invalid = payload.skills.filter((s) => !s.spec_ok).map((s) => s.name);
  if (args.json) {
    console.log(JSON.stringify({ total: payload.skills.length, languages: langs, issues: invalid, elapsed_ms: Number(elapsedMs) }, null, 2));
    return 0;
  }
  console.log(`scanned ${payload.skills.length} skills from ${payload.scan_dirs.length} dirs in ${elapsedMs}ms`);
  console.log(`languages detected: ${langs.join(", ") || "none"}`);
  console.log(`spec issues: ${invalid.length} (${invalid.join(", ") || "none"})`);
  console.log(`registry: ${fmt(join(reg, "registry.json"))}`);
  return 0;
}
