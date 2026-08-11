import { existsSync, readFileSync } from "node:fs";
import { loadRegistry, registryDir } from "../engine.js";

const ALWAYS_ON = new Set(["tractatus-thinking", "sequential-thinking", "doubt-driven-development", "debug-thinking", "stop-slop", "verification-before-completion"]);

export function cmdTrace(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.file || !existsSync(args.file)) {
    console.error("provide a transcript file path");
    return 1;
  }
  const text = readFileSync(args.file, "utf-8");
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const counts = [];
  for (const s of payload.skills) {
    const c = (text.match(new RegExp(esc(s.name), "gi")) ?? []).length;
    if (c > 0) counts.push([s.name, c]);
  }
  counts.sort((a, b) => b[1] - a[1]);
  console.log(`skills mentioned in transcript: ${counts.length}`);
  for (const [name, c] of counts) {
    console.log(`  ${String(c).padStart(4)}  ${name}${ALWAYS_ON.has(name) ? "  [always-on]" : ""}`);
  }
  return 0;
}
