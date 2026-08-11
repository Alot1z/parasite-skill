// AI-tools layer: turns skill scripts, hooks, and tools into callable, bounded
// tools that the host LLM (or a CLI/MCP caller) can invoke. Execution is always
// explicit, time-bounded, captured, and redacted — never automatic, never
// triggered by merely routing a request, and never on imported chat content.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const TOOL_GROUPS = new Set(["scripts", "hooks", "tools"]);

// Extension -> interpreter command used to execute the asset. Python is
// resolved lazily so systems with only `python3` (or only `python`) still work.
const RUNNABLE = {
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".sh": "bash",
  ".bash": "bash",
};

let resolvedPython = null;
function pythonCommand() {
  if (resolvedPython) return resolvedPython;
  if (process.env.PARASITE_SKILL_PYTHON) {
    resolvedPython = process.env.PARASITE_SKILL_PYTHON;
    return resolvedPython;
  }
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 3000 });
      resolvedPython = candidate;
      return candidate;
    } catch {
      /* try next interpreter */
    }
  }
  resolvedPython = candidates[0];
  return resolvedPython;
}

const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

// Best-effort redaction of common credential/path/email patterns in captured
// tool output. Same conservative token approach used by the public graph.
export function sanitizeOutput(text) {
  let out = String(text);
  out = out.replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "<private-key-redacted>");
  out = out.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer <redacted>");
  out = out.replace(/\b(?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=<redacted>`);
  return out
    .split(/\s+/)
    .map((token) => {
      if (token.includes("@") && token.includes(".")) return "<email-redacted>";
      if (/^[A-Za-z]:/.test(token) || token.startsWith("/")) return "<path-redacted>";
      return token;
    })
    .join(" ");
}

function toolNameFor(skillName, assetPath) {
  const base = assetPath.split("/").pop().replace(/\.[^.]+$/, "");
  const name = `${skillName}__${base}`.toLowerCase().replace(/[^a-z0-9_-]+/gi, "_");
  return name.replace(/^_+|_+$/g, "");
}

// Pull a short human description out of the asset: python/js docstrings or the
// leading comment lines, otherwise just the file name. Reads at most 12 KB.
function describeTool(filePath, assetPath) {
  let head = "";
  try {
    const raw = readFileSync(filePath, "utf-8");
    head = raw.slice(0, 12_000);
  } catch {
    return assetPath.split("/").pop();
  }
  const pythonDoc = head.match(/"""([\s\S]*?)"""|'''([\s\S]*?)'''/);
  const lines = head.split(/\r?\n/).filter((line) => !line.trim().startsWith("#!"));
  const leadingComments = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      leadingComments.push(trimmed.replace(/^[#/*\s]+/, "").replace(/\*\/$/, "").trim());
    } else if (!trimmed) continue;
    else break;
  }
  const candidate = (pythonDoc?.[1] ?? pythonDoc?.[2] ?? pythonDoc?.[0] ?? leadingComments.join(" ")).trim();
  return candidate.length >= 10 ? candidate.slice(0, 240) : assetPath.split("/").pop();
}

/** Discover every callable script/hook/tool asset across scanned skills. */
export function listSkillTools(payload) {
  const tools = [];
  for (const skill of payload?.skills ?? []) {
    for (const asset of skill.assets ?? []) {
      if (!TOOL_GROUPS.has(asset.group)) continue;
      const ext = asset.path.slice(asset.path.lastIndexOf(".")).toLowerCase();
      const command = ext === ".py" ? pythonCommand() : RUNNABLE[ext];
      if (!command) continue;
      const name = toolNameFor(skill.name, asset.path);
      if (!TOOL_NAME_PATTERN.test(name)) continue;
      const abs = join(skill.path, asset.path);
      // Skills may declare tool metadata in SKILL.md frontmatter (`tools:` JSON
      // block) keyed by tool name or asset path: description + argsSchema.
      const meta = skill.toolsMeta?.[name] ?? skill.toolsMeta?.[asset.path] ?? {};
      tools.push({
        name,
        skill: skill.name,
        path: asset.path,
        language: asset.language ?? command,
        command,
        description: typeof meta.description === "string" && meta.description.trim() ? meta.description.trim() : describeTool(abs, asset.path),
        ...(meta.argsSchema && typeof meta.argsSchema === "object" ? { argsSchema: meta.argsSchema } : {}),
      });
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- policy

function globToRegExp(pattern) {
  return new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/**
 * Resolve a policy for a bounded context. Scoped rules keyed by
 * `profile:<name>` or `sets:<set-name>` are merged over the base allow/deny/env
 * lists (union semantics; deny always wins). Used by `agents run` so each
 * profile's tools respect its own policy without hand-editing configs.
 */
export function policyFor(policy, ctx = {}) {
  if (!policy || typeof policy !== "object") return null;
  const merged = {
    allow: [...(policy.allow ?? [])],
    deny: [...(policy.deny ?? [])],
    env: [...(policy.env ?? [])],
    ...(typeof policy.timeoutMs === "number" ? { timeoutMs: policy.timeoutMs } : {}),
  };
  const keys = [];
  if (ctx.profile) keys.push(`profile:${ctx.profile}`);
  for (const set of ctx.sets ?? []) keys.push(`sets:${set}`);
  for (const key of keys) {
    const entry = policy.scoped?.[key];
    if (!entry || typeof entry !== "object") continue;
    for (const k of ["allow", "deny", "env"]) {
      if (Array.isArray(entry[k])) merged[k].push(...entry[k].filter((v) => typeof v === "string"));
    }
    if (typeof entry.timeoutMs === "number") merged.timeoutMs = entry.timeoutMs;
  }
  return merged;
}

/**
 * Filter tools by a policy: { allow?: string[], deny?: string[], env?: string[] }.
 * A deny match always removes; a non-empty allow list must match. Tool names
 * support `*` globs (e.g. "demo-skill__*").
 */
export function filterToolsByPolicy(tools, policy) {
  if (!policy || typeof policy !== "object") return tools;
  const deny = (policy.deny ?? []).map(globToRegExp);
  const allow = (policy.allow ?? []).map(globToRegExp);
  return tools.filter((tool) => {
    if (deny.some((pattern) => pattern.test(tool.name))) return false;
    if (allow.length && !allow.some((pattern) => pattern.test(tool.name))) return false;
    return true;
  });
}

function assertAllowedByPolicy(name, policy) {
  if (!policy || typeof policy !== "object") return;
  const deny = (policy.deny ?? []).map(globToRegExp);
  const allow = (policy.allow ?? []).map(globToRegExp);
  if (deny.some((pattern) => pattern.test(name))) {
    const err = new Error(`tool denied by project policy: ${name}`);
    err.code = "TOOL_DENIED";
    throw err;
  }
  if (allow.length && !allow.some((pattern) => pattern.test(name))) {
    const err = new Error(`tool not in project allowlist: ${name}`);
    err.code = "TOOL_NOT_ALLOWED";
    throw err;
  }
}

function envForPolicy(baseEnv, policy) {
  if (!policy?.env || !Array.isArray(policy.env) || policy.env.length === 0) return baseEnv;
  const env = {};
  for (const key of policy.env) {
    if (baseEnv[key] !== undefined) env[key] = baseEnv[key];
  }
  // PATH stays so interpreter resolution inside the script keeps working.
  if (baseEnv.PATH !== undefined) env.PATH = baseEnv.PATH;
  return env;
}

// ---------------------------------------------------------------- resolution

/** Resolve the exact command/argv/cwd/timeout/env a run would use, without
 *  executing anything. Throws UNKNOWN_TOOL / MISSING_FILE / policy errors. */
export function resolveToolRun(payload, name, args = "", options = {}) {
  const tool = listSkillTools(payload).find((entry) => entry.name === name);
  if (!tool) {
    const err = new Error(`unknown skill tool: ${name}`);
    err.code = "UNKNOWN_TOOL";
    throw err;
  }
  assertAllowedByPolicy(name, options.policy);
  const skill = payload.skills.find((entry) => entry.name === tool.skill);
  const script = join(skill.path, tool.path);
  if (!existsSync(script)) {
    const err = new Error(`tool file missing: ${tool.path}`);
    err.code = "MISSING_FILE";
    throw err;
  }
  const argv = [script, ...String(args ?? "").split(/\s+/).filter(Boolean)];
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 30_000, 300_000));
  return {
    tool,
    script,
    argv,
    cwd: skill.path,
    timeoutMs,
    env: envForPolicy(options.env ?? process.env, options.policy),
  };
}

// ---------------------------------------------------------------- execution

/**
 * Execute one discovered tool. Explicit invocation only; the caller decides
 * which tool and arguments. Output is captured and redacted; a hard timeout
 * kills the process. When options.registry is set, the run is recorded to the
 * audit ledger (tool-runs.jsonl). Never auto-runs from routing or planning.
 */
export function runSkillTool(payload, name, args = "", options = {}) {
  const { tool, argv, cwd, timeoutMs, env } = resolveToolRun(payload, name, args, options);
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let status = 0;
  try {
    stdout = execFileSync(tool.command, argv, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env,
    });
  } catch (err) {
    status = typeof err.status === "number" ? err.status : 1;
    stderr = err.stderr ? String(err.stderr) : String(err.message ?? err);
    if (err.stdout) stdout = String(err.stdout);
    if (err.killed || err.signal) stderr += `\n(terminated after ${timeoutMs}ms)`;
  }
  const result = {
    ok: status === 0,
    name,
    skill: tool.skill,
    command: tool.command,
    status,
    duration_ms: Date.now() - started,
    stdout: sanitizeOutput(stdout).slice(0, 200_000),
    stderr: sanitizeOutput(stderr).slice(0, 200_000),
  };
  if (options.registry) recordToolRun(options.registry, result, args);
  return result;
}

// ---------------------------------------------------------------- audit ledger

const LEDGER_FILE = "tool-runs.jsonl";
const LEDGER_CAP = 5000;

/** Append one run to the local audit ledger (registry/tool-runs.jsonl). */
export function recordToolRun(regDir, result, argsPreview = "") {
  if (!regDir) return;
  try {
    mkdirSync(regDir, { recursive: true });
    const file = join(regDir, LEDGER_FILE);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        name: result.name,
        skill: result.skill,
        status: result.status,
        duration_ms: result.duration_ms,
        args: sanitizeOutput(String(argsPreview)).slice(0, 500),
        stdout_chars: (result.stdout ?? "").length,
        stderr_chars: (result.stderr ?? "").length,
      }) + "\n";
    appendFileSync(file, line, "utf-8");
    const all = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    if (all.length > LEDGER_CAP) writeFileSync(file, all.slice(-LEDGER_CAP).join("\n") + "\n", "utf-8");
  } catch {
    /* ledger is best-effort and never blocks execution */
  }
}

/** Read the last `limit` ledger entries (newest first). */
export function readToolRuns(regDir, limit = 50) {
  if (!regDir) return [];
  try {
    const file = join(regDir, LEDGER_FILE);
    if (!existsSync(file)) return [];
    const entries = readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return entries.slice(-Math.max(1, limit)).reverse();
  } catch {
    return [];
  }
}

/** Clear the audit ledger. */
export function clearToolRuns(regDir) {
  if (!regDir) return;
  try {
    rmSync(join(regDir, LEDGER_FILE), { force: true });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------- static audit

const RISK_PATTERNS = [
  ["high", /(?:eval|Function)\s*\(/i],
  ["high", /\bos\.system\s*\(/i],
  ["high", /\bsubprocess\b/i],
  ["high", /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\b/i],
  ["high", /System\.Diagnostics/i],
  ["medium", /\bfetch\s*\(/i],
  ["medium", /\bhttps?:\/\//i],
  ["medium", /\b(?:requests|urllib|http)\./i],
  ["medium", /\bsocket\b/i],
  ["medium", /\b(?:curl|wget)\b/i],
  ["medium", /\b(?:writeFile|writeFileSync|appendFileSync)\s*\(/i],
  ["medium", /\bopen\s*\([^)]*['"]w/i],
  ["medium", /\b(?:os\.environ|process\.env)\b/i],
  ["medium", /\b(?:rmSync|rmtree|unlink|rm -rf)\b/i],
];

/**
 * Static security audit of discovered tools. Never executes anything: reads at
 * most 64 KB per asset and flags risky patterns.
 */
export function auditSkillTools(payload) {
  return listSkillTools(payload).map((tool) => {
    let source = "";
    try {
      source = readFileSync(join(payload.skills.find((s) => s.name === tool.skill).path, tool.path), "utf-8").slice(0, 64_000);
    } catch {
      source = "";
    }
    const flags = [];
    for (const [level, pattern] of RISK_PATTERNS) {
      if (pattern.test(source)) flags.push({ level, pattern: String(pattern).replace(/^\/|\/[a-z]*$/gi, "") });
    }
    const risk = flags.some((flag) => flag.level === "high") ? "high" : flags.some((flag) => flag.level === "medium") ? "medium" : "low";
    return { name: tool.name, skill: tool.skill, path: tool.path, risk, flags };
  });
}
