// Multi-client support: where each AI coding client keeps its skills.
// Paths for the first 12 are verified against agentskills.io/specification and
// vercel-labs/skills. Extra clients use best-effort conventions (verified:false)
// and only activate when their directories actually exist on the machine.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pickList, progress } from "./tui.js";
import { banner, smallLogo } from "./logo.js";

export const SKILL_NAME = "parasite-skill";

// Test hook: PARASITE_SKILL_HOME redirects the home base (sandbox installs).
const homeBase = () => process.env.PARASITE_SKILL_HOME || homedir();  // || so "" falls back

const H = homeBase;

const v = (id, label, user, project) => ({ id, label, user, project, verified: true });
const b = (id, label, user, project) => ({ id, label, user, project, verified: false });

export const CLIENTS = [
  v("claude-code", "Claude Code", join(H(), ".claude", "skills"), join(".claude", "skills")),
  v("codex", "Codex CLI", join(H(), ".codex", "skills"), join(".agents", "skills")),
  v("opencode", "OpenCode", join(H(), ".config", "opencode", "skills"), join(".agents", "skills")),
  v("cline", "Cline", join(H(), ".agents", "skills"), join(".agents", "skills")),
  v("cursor", "Cursor", join(H(), ".cursor", "skills"), join(".agents", "skills")),
  v("windsurf", "Windsurf", join(H(), ".codeium", "windsurf", "skills"), join(".windsurf", "skills")),
  v("gemini-cli", "Gemini CLI", join(H(), ".gemini", "skills"), join(".agents", "skills")),
  v("warp", "Warp", join(H(), ".agents", "skills"), join(".agents", "skills")),
  v("github-copilot", "GitHub Copilot CLI", join(H(), ".copilot", "skills"), join(".agents", "skills")),
  v("continue", "Continue", join(H(), ".continue", "skills"), join(".continue", "skills")),
  v("zed", "Zed", join(H(), ".agents", "skills"), join(".agents", "skills")),
  v("universal", "Universal (~/.agents/skills)", join(H(), ".agents", "skills"), join(".agents", "skills")),
  b("roo-code", "Roo Code", join(H(), ".roo", "skills"), join(".roo", "skills")),
  b("kilocode", "Kilo Code", join(H(), ".kilo", "skills"), join(".kilo", "skills")),
  b("antigravity", "Antigravity", join(H(), ".antigravity", "skills"), join(".antigravity", "skills")),
  b("openhands", "OpenHands", join(H(), ".openhands", "skills"), join(".openhands", "skills")),
  b("pi", "Pi", join(H(), ".config", "pi", "skills"), join(".agents", "skills")),
  b("kimi-code", "Kimi Code", join(H(), ".kimi", "skills"), join(".kimi", "skills")),
  b("trae", "Trae", join(H(), ".trae", "skills"), join(".trae", "skills")),
  b("qwen-code", "Qwen Code", join(H(), ".qwen-code", "skills"), join(".qwen-code", "skills")),
  b("codebuddy", "CodeBuddy", join(H(), ".codebuddy", "skills"), join(".codebuddy", "skills")),
  b("goose", "Goose", join(H(), ".goose", "skills"), join(".goose", "skills")),
  b("amp", "Amp", join(H(), ".amp", "skills"), join(".amp", "skills")),
  b("kiro", "Kiro CLI", join(H(), ".kiro", "skills"), join(".kiro", "skills")),
  b("devin", "Devin for Terminal", join(H(), ".devin", "skills"), join(".devin", "skills")),
];

export function skillSourceDir() {
  // The skill/ payload lives at the package root.
  const here = new URL("..", import.meta.url);
  return join(here.pathname.replace(/^\/([A-Za-z]:)/, "$1"), "skill");
}

export function detectClients(list = CLIENTS) {
  // A client is detected if its user-level skills dir (or its parent config dir) exists.
  // The client list is injectable so tests can probe the detection rules against a
  // synthetic home instead of the machine's real one.
  return list.filter((c) => {
    if (existsSync(c.user)) return true;
    const parent = c.user.split(/[\\/]/).slice(0, -1).join("/");
    return existsSync(parent);
  });
}

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function removeDest(dest) {
  if (!existsSync(dest)) return false;
  rmSync(dest, { recursive: true, force: true });
  return true;
}

function parentOf(p) {
  return p.split(/[\\/]/).slice(0, -1).join("/");
}

function installOne(dest, mode, source, force) {
  const parent = parentOf(dest);
  mkdirSync(parent, { recursive: true });
  // Install to a temp sibling first, then swap — a failed install never
  // destroys the previous one.
  const tmp = join(parent, ".parasite-skill-install-tmp");
  removeDest(tmp);
  let res;
  if (mode === "link") {
    try {
      symlinkSync(source, tmp, process.platform === "win32" ? "junction" : "dir");
      res = { ok: true, mode: "link" };
    } catch (err) {
      res = { ok: false, mode: "link", error: String(err.message ?? err) };
    }
  } else {
    try {
      cpSync(source, tmp, { recursive: true, force: true });
      res = { ok: true, mode: "copy" };
    } catch (err) {
      res = { ok: false, mode: "copy", error: String(err.message ?? err) };
    }
  }
  if (!res.ok) {
    removeDest(tmp);
    return res;
  }
  if (!force && existsSync(dest)) {
    removeDest(tmp);
    return { ok: false, mode: res.mode, error: "already exists (use --force to replace)" };
  }
  removeDest(dest);
  try {
    renameSync(tmp, dest);
    return { ok: true, mode: res.mode, note: "installed" };
  } catch (err) {
    removeDest(tmp);
    return { ok: false, mode: res.mode, error: String(err.message ?? err) };
  }
}

function verify(dest) {
  return existsSync(join(dest, "SKILL.md"));
}

// ---------------------------------------------------------------- commands

export async function runInstall(args) {
  const source = skillSourceDir();
  const scope = args.scope === "project" ? "project" : "user";
  const mode = args.mode === "link" ? "link" : "copy";
  // --dest installs to an explicit path (any directory the user chooses),
  // bypassing client detection. The skill lands at <dest>/parasite-skill.
  if (args.dest) {
    const dest = join(args.dest, SKILL_NAME);
    console.log(banner());
    console.log(`  installing to custom path: ${dest}`);
    const res = installOne(dest, mode, source, args.force);
    const ok = res.ok && verify(dest);
    console.log(`  ${smallLogo()} ${ok ? "ok" : "FAIL"} (${res.mode}) -> ${dest.replace(/\\/g, "/")}`);
    return ok ? 0 : 1;
  }

  const wanted = args.all
    ? CLIENTS
    : args.agents?.length
      ? CLIENTS.filter((c) => args.agents.includes(c.id))
      : detectClients();
  if (!wanted.length) {
    console.warn("no clients selected: use --all, --agent <ids>, or install the client first");
    return 1;
  }

  // Deduplicate by destination dir; the skill is always <dir>/parasite-skill.
  const seen = new Set();
  const targets = [];
  for (const c of wanted) {
    const dir = scope === "project" ? join(process.cwd(), c.project) : c.user;
    if (seen.has(dir)) continue;
    seen.add(dir);
    targets.push({ ...c, dir, dest: join(dir, SKILL_NAME) });
  }

  let chosen = targets;
  if (!args.yes && !args.all && targets.length > 1 && !args.agents?.length) {
    console.log(banner());
    const picked = await pickList(
      targets.map((t, i) => ({ id: String(i), label: t.label, detail: t.dest.replace(/\\/g, "/"), checked: i === 0 })),
      { multi: true, title: "Which clients should get parasite-skill?" },
    );
    if (picked === null) {
      console.log("cancelled");
      return 1;
    }
    chosen = picked.map((idx) => targets[Number(idx)]).filter(Boolean);
  } else {
    console.log(banner());
  }
  const rows = await progress("installing parasite-skill", async (draw) => {
    const out = [];
    for (let i = 0; i < chosen.length; i++) {
      const t = chosen[i];
      draw((i + 0.5) / chosen.length, t.label);
      const res = installOne(t.dest, mode, source, args.force);
      const ok = res.ok && verify(t.dest);
      out.push({ label: t.label, dest: t.dest.replace(/\\/g, "/"), mode: res.mode, ok, error: res.error ?? res.note });
    }
    return out;
  });

  console.log("");
  for (const r of rows) {
    const mark = r.ok ? smallLogo() : "FAIL";
    const extra = r.ok ? `(${r.mode})` : `(${r.error})`;
    console.log(`  ${mark} ${r.label}: ${r.dest} ${extra}`);
  }
  const okCount = rows.filter((r) => r.ok).length;
  console.log(`\ninstalled ${okCount}/${rows.length} -> ${scope} scope, mode: ${mode}`);
  console.log("verified: dest/SKILL.md present for every ok row");
  return okCount === rows.length ? 0 : 1;
}

export function runList() {
  console.log("parasite-skill instances:");
  let found = 0;
  for (const c of CLIENTS) {
    const dest = join(c.user, SKILL_NAME);
    if (existsSync(dest)) {
      const link = isLink(dest) ? "link" : "copy";
      const ok = verify(dest);
      const pathMark = c.verified ? "" : " (best-effort path)";
      console.log(`  [${ok ? "ok" : "MISSING SKILL.md"}] ${c.label} (${link})${pathMark} -> ${dest.replace(/\\/g, "/")}`);
      found++;
    }
  }
  if (!found) console.log("  none installed");
  return 0;
}

export function runRemove(args) {
  const wanted = args.all
    ? CLIENTS
    : args.agents?.length
      ? CLIENTS.filter((c) => args.agents.includes(c.id))
      : detectClients();
  const seen = new Set();
  let removed = 0;
  for (const c of wanted) {
    const dest = join(c.user, SKILL_NAME);
    if (seen.has(dest)) continue;
    seen.add(dest);
    if (existsSync(dest)) {
      removeDest(dest);
      console.log(`  removed ${c.label}: ${dest.replace(/\\/g, "/")}`);
      removed++;
    }
  }
  console.log(`removed ${removed} instance(s)`);
  return 0;
}

export async function runRefresh(args) {
  const source = skillSourceDir();
  const scope = args.scope === "project" ? "project" : "user";
  const mode = args.mode === "link" ? "link" : "copy";
  
  // Find all installed instances
  const installed = [];
  for (const c of CLIENTS) {
    const dir = scope === "project" ? join(process.cwd(), c.project) : c.user;
    const dest = join(dir, SKILL_NAME);
    if (existsSync(dest)) {
      installed.push({ ...c, dest });
    }
  }
  
  if (installed.length === 0) {
    console.log("no installed instances found");
    console.log("  run: parasite-skill install  (to install first)");
    return 0;
  }
  
  console.log(banner());
  console.log(`  refreshing ${installed.length} installed instance(s)...`);
  
  let refreshed = 0;
  for (const c of installed) {
    const res = installOne(c.dest, mode, source, true); // force=true to overwrite
    if (res.ok) {
      refreshed++;
      console.log(`  ${smallLogo()} ${c.label}: refreshed (${res.mode})`);
    } else {
      console.log(`  FAIL ${c.label}: ${res.error}`);
    }
  }
  
  console.log(`\nrefreshed ${refreshed}/${installed.length} instance(s)`);
  return refreshed === installed.length ? 0 : 1;
}
