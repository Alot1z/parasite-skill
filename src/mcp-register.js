// MCP auto-registration — the "no manual config" path.
// Registers the parasite-skill MCP server into each client's config file so the
// user never touches JSON by hand. Mirrors how freebuff/codebuff-style CLIs
// self-configure their tooling.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { banner, smallLogo } from "./logo.js";

const SR = "parasite-skill";
const HOME = () => process.env.PARASITE_SKILL_HOME || homedir();  // || so "" falls back

// Where the MCP server entry point lives (this package's src/mcp-server.js).
// Works when run from the repo or from an installed copy inside a client dir.
export function mcpServerEntry() {
  const candidates = [
    new URL("./mcp-server.js", import.meta.url),
    new URL("../scripts/mcp_server.py", import.meta.url),
    new URL("../../skill/scripts/mcp_server.py", import.meta.url),
  ];
  for (const u of candidates) {
    try {
      const p = u.pathname.replace(/^\/([A-Za-z]:)/, "$1");
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return new URL("./mcp-server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}

// Runtime preference: node is universal; bun is faster to boot.
export function mcpRuntime(pref) {
  const bun = process.env.PARASITE_SKILL_RUNTIME ?? (process.argv[0] && process.argv[0].toLowerCase().includes("bun") ? "bun" : null);
  if (pref === "bun" || bun) return { command: "bun", args: ["run"] };
  return { command: process.execPath || "node", args: [] };
}

// ---------------------------------------------------------------- config targets
// Each entry knows how to locate, read, and write its MCP config.
const APPDATA = process.env.APPDATA ? process.env.APPDATA.replace(/\\/g, "/") : join(HOME(), "AppData", "Roaming");

const TARGETS = [
  {
    id: "claude-code",
    label: "Claude Code",
    // ~/.claude.json holds the global mcpServers map (older/newer layouts both use "mcpServers").
    file: () => join(HOME(), ".claude.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
  {
    id: "claude-code-project",
    label: "Claude Code (project .mcp.json)",
    // Project-scope MCP config (the shared .mcp.json Claude Code reads at repo root).
    file: () => join(process.cwd(), ".mcp.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    file: () =>
      process.platform === "win32"
        ? join(APPDATA, "Claude", "claude_desktop_config.json")
        : process.platform === "darwin"
          ? join(HOME(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
          : join(HOME(), ".config", "Claude", "claude_desktop_config.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
  {
    id: "cursor",
    label: "Cursor",
    file: () => join(process.cwd(), ".cursor", "mcp.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
  {
    id: "continue",
    label: "Continue",
    file: () => join(HOME(), ".continue", "config.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    file: () => join(HOME(), ".codeium", "windsurf", "mcp_config.json"),
    get: (cfg) => cfg.mcpServers,
    set: (cfg, v) => (cfg.mcpServers = v),
  },
];

// Returns null when the file exists but cannot be parsed — callers must abort
// rather than overwrite a high-value config (e.g. ~/.claude.json).
function readJson(file) {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function backupFile(file) {
  try {
    if (existsSync(file)) writeFileSync(file + ".bak", readFileSync(file, "utf-8"), "utf-8");
  } catch {
    /* best-effort */
  }
}

function writeJson(file, cfg) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function entryFor(runtime) {
  const { command, args } = mcpRuntime(runtime);
  return {
    command,
    args: [...args, mcpServerEntry()],
  };
}

// ---------------------------------------------------------------- commands

/** Register (or update) parasite-skill in each available client config. */
export function runMcpAdd(args = {}) {
  const runtime = args.runtime;
  const entry = entryFor(runtime);
  const rows = [];
  let any = false;
  for (const t of TARGETS) {
    if (args.clients?.length && !args.clients.includes(t.id)) continue;
    const file = t.file();
    const cfg = readJson(file);
    if (cfg === null) {
      console.error(`  [skip] ${t.label}: cannot parse ${file} — backing up and leaving untouched`);
      backupFile(file);
      continue;
    }
    const map = t.get(cfg) ?? {};
    map[SR] = entry;
    t.set(cfg, map);
    backupFile(file);
    writeJson(file, cfg);
    rows.push({ label: t.label, file, added: true });
    any = true;
  }
  if (!any) {
    console.log("no MCP config targets matched (use --clients claude-code,cursor,continue,windsurf)");
    return 1;
  }
  console.log(banner());
  for (const r of rows) console.log(`  ${smallLogo()} MCP registered: ${r.label} -> ${r.file}`);
  console.log(`\nMCP server: ${mcpServerEntry()}`);
  console.log("boots on demand; no resident process, no memory while idle");
  return 0;
}

/** Remove parasite-skill entries from client configs. */
export function runMcpRemove(args = {}) {
  const rows = [];
  let any = false;
  for (const t of TARGETS) {
    if (args.clients?.length && !args.clients.includes(t.id)) continue;
    const file = t.file();
    const cfg = readJson(file);
    if (cfg === null) {
      console.error(`  [skip] ${t.label}: cannot parse ${file}`);
      continue;
    }
    const map = t.get(cfg);
    if (map && typeof map === "object" && map[SR]) {
      delete map[SR];
      t.set(cfg, map);
      writeJson(file, cfg);
      rows.push({ label: t.label, file, removed: true });
      any = true;
    }
  }
  if (!any) {
    console.log("parasite-skill MCP not registered in any target config");
    return 0;
  }
  for (const r of rows) console.log(`  ${smallLogo()} MCP removed: ${r.label} -> ${r.file}`);
  return 0;
}

/** Data getter: which configs currently reference parasite-skill (for export/status). */
export function mcpRegistrationStatus() {
  const rows = [];
  for (const t of TARGETS) {
    const file = t.file();
    const cfg = readJson(file);
    const map = t.get(cfg);
    rows.push({
      id: t.id,
      label: t.label,
      file: file.replace(/\\/g, "/"),
      registered: !!(map && typeof map === "object" && map[SR]),
    });
  }
  return rows;
}

/** Show which configs currently reference parasite-skill. */
export function runMcpList() {
  console.log("parasite-skill MCP registration:");
  let found = 0;
  for (const t of TARGETS) {
    const file = t.file();
    const cfg = readJson(file);
    const map = t.get(cfg);
    const present = map && typeof map === "object" && map[SR];
    if (present) {
      console.log(`  [ok] ${t.label} -> ${file}`);
      found++;
    } else {
      console.log(`  [ -] ${t.label} -> ${file}`);
    }
  }
  console.log(found ? `\n${found} client(s) registered` : "\nnone registered — run `parasite-skill mcp add`");
  return found ? 0 : 1;
}
