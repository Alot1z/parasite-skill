// trace: count which skills a session transcript (or whole directory of
// transcripts) mentions, plus which tools were executed according to the local
// audit ledger. Accepts a file, a directory (recursive, bounded), or a
// comma-separated list of paths. --json emits machine-readable output.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { loadRegistry, registryDir } from "../engine.js";
import { readToolRuns } from "../ai-tools.js";

const ALWAYS_ON = new Set(["tractatus-thinking", "sequential-thinking", "doubt-driven-development", "debug-thinking", "stop-slop", "verification-before-completion"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl", ".log", ".markdown"]);
const MAX_FILES = 100;
const MAX_BYTES = 2 * 1024 * 1024;

function collectFiles(path, out = []) {
  if (!existsSync(path) || out.length >= MAX_FILES) return out;
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry.startsWith(".")) continue;
        collectFiles(join(path, entry), out);
        if (out.length >= MAX_FILES) break;
      }
    } else if (stat.isFile() && stat.size <= MAX_BYTES && TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
      out.push(path);
    }
  } catch {
    /* unreadable paths are skipped */
  }
  return out;
}

export function cmdTrace(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const raw = args.file ?? "";
  if (!raw) {
    console.error("provide a transcript file, directory, or comma-separated paths: parasite-skill trace <path>");
    return 1;
  }
  const paths = String(raw).split(",").map((p) => p.trim()).filter(Boolean);
  const files = [];
  for (const path of paths) collectFiles(path, files);
  if (!files.length) {
    console.error(`no transcript files found at: ${raw}`);
    return 1;
  }

  // Read each file once; count every skill against the cached text so cost is
  // O(files + files x skills) instead of O(files x skills) full re-reads.
  const texts = [];
  let skipped = 0;
  for (const file of files) {
    try {
      texts.push(readFileSync(file, "utf-8"));
    } catch {
      texts.push(null);
      skipped++;
    }
  }
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const counts = [];
  for (const s of payload.skills) {
    let c = 0;
    for (const text of texts) {
      if (text === null) continue;
      c += (text.match(new RegExp(esc(s.name), "gi")) ?? []).length;
    }
    if (c > 0) counts.push([s.name, c]);
  }
  counts.sort((a, b) => b[1] - a[1]);

  const ledger = readToolRuns(reg, 5000);
  const toolCounts = {};
  let okCount = 0;
  for (const entry of ledger) {
    toolCounts[entry.name] = (toolCounts[entry.name] ?? 0) + 1;
    if (entry.status === 0) okCount++;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          files: files.map((f) => f.replace(/\\/g, "/")),
          skills: counts,
          tools: {
            distinct: Object.keys(toolCounts).length,
            runs: ledger.length,
            ok: okCount,
            by_tool: Object.entries(toolCounts).sort((a, b) => b[1] - a[1]),
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`files traced: ${files.length}${skipped ? ` (${skipped} unreadable skipped)` : ""}`);
  console.log(`skills mentioned in transcripts: ${counts.length}`);
  for (const [name, c] of counts) {
    console.log(`  ${String(c).padStart(4)}  ${name}${ALWAYS_ON.has(name) ? "  [always-on]" : ""}`);
  }
  if (ledger.length) {
    const rows = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    console.log(`tools executed (ledger): ${rows.length} distinct / ${ledger.length} runs (${okCount} ok)`);
    for (const [name, c] of rows) {
      console.log(`  ${String(c).padStart(4)}  ${name}`);
    }
  } else {
    console.log("tools executed (ledger): none recorded");
  }
  return 0;
}
