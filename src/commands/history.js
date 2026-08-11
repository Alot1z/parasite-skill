import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const CANDIDATE_DIRS = [
  join(homedir(), ".freebuff"),
  join(homedir(), ".config", "freebuff"),
  join(homedir(), "AppData", "Roaming", "Freebuff"),
  join(homedir(), "AppData", "Local", "Freebuff"),
  join(homedir(), ".local", "share", "freebuff"),
];
const HISTORY_NAMES = /(?:history|chat|session|conversation|transcript)/i;
const SAFE_TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson", ".txt", ".md", ".log"]);

function redact(text) {
  let out = String(text);
  out = out.replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "<private-key-redacted>");
  out = out.replace(/(authorization|bearer|token|secret|password|api[_-]?key)(\s*[=:]\s*)(\S+)/gi, "$1$2<redacted>");
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email-redacted>");
  return out.split(/(\s+)/).map((part) => {
    const normalized = part.replaceAll("\\", "/");
    const windows = /^[A-Za-z]:\//.test(normalized);
    const unix = /\/(?:Users|home|tmp|workspace|private|mnt|opt|var|etc)\//.test(normalized);
    return windows || unix ? "<path-redacted>" : part;
  }).join("");
}

function walk(root, out, depth = 0) {
  if (depth > 4 || !existsSync(root)) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else if (entry.isFile() && HISTORY_NAMES.test(entry.name) && SAFE_TEXT_EXTENSIONS.has(full.slice(full.lastIndexOf(".")).toLowerCase())) {
      try {
        const stat = statSync(full);
        out.push({ path: resolve(full), bytes: stat.size, modified: stat.mtime.toISOString() });
      } catch { /* ignore inaccessible files */ }
    }
  }
}

export function discoverHistory(extraDirs = []) {
  const dirs = [...CANDIDATE_DIRS, ...extraDirs].filter(Boolean);
  const found = [];
  for (const dir of [...new Set(dirs)]) walk(dir, found);
  return found.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function cmdHistory(args) {
  const action = args.historyAction || args._?.[1] || "discover";
  if (action === "discover") {
    const found = discoverHistory(args.historyDirs ? String(args.historyDirs).split(",") : []);
    if (args.json) console.log(JSON.stringify({ candidates: found.map(({ path, bytes, modified }) => ({ path, bytes, modified })) }, null, 2));
    else if (!found.length) console.log("No Freebuff history candidates found in standard locations.");
    else for (const item of found) console.log(`${item.modified} ${item.bytes} bytes ${item.path}`);
    return 0;
  }
  if (action !== "import") {
    console.error("history action must be discover or import");
    return 2;
  }
  if (!args.file || !existsSync(args.file)) {
    console.error("history import requires --file PATH");
    return 1;
  }
  const maxChars = Math.max(1, Math.min(Number(args.maxChars) || 200000, 2000000));
  let source;
  let fd;
  try {
    const bytesToRead = Math.min(statSync(args.file).size, maxChars * 4);
    fd = openSync(args.file, "r");
    const buffer = Buffer.alloc(bytesToRead);
    const read = readSync(fd, buffer, 0, bytesToRead, 0);
    source = buffer.subarray(0, read).toString("utf-8");
  } catch (error) {
    console.error(`cannot read history file: ${error.message}`);
    return 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const sanitized = redact(source).slice(0, maxChars);
  const root = args.registry || join(homedir(), ".agents", "skills", ".parasite-skill");
  const outDir = join(root, "history");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${Date.now()}-${basename(args.file).replace(/[^a-z0-9._-]/gi, "-")}.txt`);
  writeFileSync(out, sanitized, "utf-8");
  if (args.json) console.log(JSON.stringify({ imported: true, saved: `history/${basename(out)}`, chars: sanitized.length }, null, 2));
  else console.log(`history imported: history/${basename(out)} (${sanitized.length} chars, sanitized)`);
  return 0;
}
