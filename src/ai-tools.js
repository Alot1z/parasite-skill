// AI-tools layer: turns skill scripts, hooks, and tools into callable, bounded
// tools that the host LLM (or a CLI/MCP caller) can invoke. Execution is always
// explicit, time-bounded, captured, and redacted — never automatic, never
// triggered by merely routing a request, and never on imported chat content.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { VERSION } from "./engine.js";

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
        // A skill may declare a per-tool timeout (>= 1000ms) in its tools:
        // frontmatter block; an explicit CLI --timeout-ms or project
        // tools.timeoutMs still wins in resolveToolRun.
        ...(typeof meta.timeoutMs === "number" && meta.timeoutMs >= 1000 ? { timeoutMs: meta.timeoutMs } : {}),
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

// ---------------------------------------------------------------- args validation

function validateScalar(propSchema, key, value) {
  const t = propSchema.type;
  if (t === "string") {
    if (typeof value !== "string") return `${key} must be a string`;
    if (propSchema.minLength != null && value.length < propSchema.minLength) return `${key} below minLength ${propSchema.minLength}`;
    if (propSchema.maxLength != null && value.length > propSchema.maxLength) return `${key} exceeds maxLength ${propSchema.maxLength}`;
  } else if (t === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) return `${key} must be a number`;
  } else if (t === "integer") {
    if (!Number.isInteger(value)) return `${key} must be an integer`;
  } else if (t === "boolean") {
    if (typeof value !== "boolean") return `${key} must be a boolean`;
  } else if (t === "array") {
    if (!Array.isArray(value)) return `${key} must be an array`;
  }
  if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
    return `${key} must be one of ${propSchema.enum.join(", ")}`;
  }
  return null;
}

function argsError(message) {
  const err = new Error(message);
  err.code = "ARGS_INVALID";
  return err;
}

/**
 * Validate the arguments for a tool against its declared argsSchema. Two modes:
 * - positional string mode (default): bounded by an optional `args` maxLength;
 *   if the schema declares required properties, structured --json-args is required.
 * - structured mode (options.jsonArgs): the value is parsed as JSON and every
 *   property is type/required/enum checked against schema.properties.
 * Returns the normalized structured object, or null for plain positional args.
 * Throws with code ARGS_INVALID on any violation; never executes anything.
 */
export function validateToolArgs(tool, argsString, jsonArgs) {
  if (!tool?.argsSchema) {
    if (jsonArgs !== undefined) {
      throw argsError(`tool ${tool?.name ?? "?"} declares no argsSchema; structured --json-args rejected`);
    }
    return null;
  }
  const schema = tool.argsSchema;
  if (schema.type && schema.type !== "object") {
    throw argsError(`argsSchema for ${tool.name} must be object type`);
  }
  if (jsonArgs !== undefined) {
    let obj;
    try {
      obj = typeof jsonArgs === "string" ? JSON.parse(jsonArgs) : jsonArgs;
    } catch {
      throw argsError(`json args for ${tool.name} are not valid JSON`);
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      throw argsError(`json args for ${tool.name} must be an object`);
    }
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in obj)) throw argsError(`missing required arg for ${tool.name}: ${key}`);
    }
    for (const [key, value] of Object.entries(obj)) {
      const prop = props[key];
      if (!prop || typeof prop !== "object") throw argsError(`unknown arg for ${tool.name}: ${key}`);
      const violation = validateScalar(prop, key, value);
      if (violation) throw argsError(`${tool.name}: ${violation}`);
    }
    return obj;
  }
  // Positional mode: only strings, capped when the schema says so.
  if (schema.properties?.args?.type === "string" && schema.properties.args.maxLength != null) {
    if (String(argsString ?? "").length > schema.properties.args.maxLength) {
      throw argsError(`${tool.name}: args exceed maxLength ${schema.properties.args.maxLength}`);
    }
  }
  if (Array.isArray(schema.required) && schema.required.length) {
    throw argsError(`${tool.name} requires structured --json-args (required: ${schema.required.join(", ")})`);
  }
  return null;
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
  const validated = validateToolArgs(tool, args, options.jsonArgs);
  // Structured args become deterministic `key=value` argv entries (sorted so
  // repeated runs are stable); plain positional args stay space-split.
  const argvArgs =
    validated !== null
      ? Object.entries(validated).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      : String(args ?? "").split(/\s+/).filter(Boolean);
  const argv = [script, ...argvArgs];
  // Timeout precedence: explicit CLI/project timeout wins, then a per-tool
  // declared timeoutMs from the skill's tools: frontmatter block, then 30s.
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || tool.timeoutMs || 30_000, 300_000));
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

/**
 * Integrity + size check of the audit ledger (tool-runs.jsonl). Returns
 * { exists, total, valid, corrupt, out_of_order, first_ts, last_ts, bytes }.
 * `corrupt` counts lines that fail to parse; `out_of_order` counts entries
 * whose timestamp precedes the previous valid entry (append-order drift, e.g.
 * a clock jump or a hand-edited ledger). Never throws: a missing or unreadable
 * ledger reports exists: false / zeroed counts.
 */
export function ledgerCheck(regDir) {
  const empty = { exists: false, total: 0, valid: 0, corrupt: 0, out_of_order: 0, first_ts: null, last_ts: null, bytes: 0 };
  if (!regDir) return empty;
  const file = join(regDir, LEDGER_FILE);
  try {
    if (!existsSync(file)) return empty;
    const stat = statSync(file);
    const rawLines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    let valid = 0;
    let corrupt = 0;
    let outOfOrder = 0;
    let prevTs = null;
    let firstTs = null;
    let lastTs = null;
    for (const line of rawLines) {
      let ts = null;
      try {
        const entry = JSON.parse(line);
        ts = typeof entry.ts === "string" && entry.ts ? Date.parse(entry.ts) : null;
        if (!Number.isFinite(ts)) ts = null;
      } catch {
        /* corrupt line */
      }
      if (ts === null) {
        corrupt++;
        continue;
      }
      valid++;
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
      if (prevTs !== null && ts < prevTs) outOfOrder++;
      prevTs = ts;
    }
    return {
      exists: true,
      total: rawLines.length,
      valid,
      corrupt,
      out_of_order: outOfOrder,
      first_ts: firstTs,
      last_ts: lastTs,
      bytes: stat.size,
    };
  } catch {
    return empty;
  }
}

/**
 * Aggregate stats over the whole ledger: totals, integrity, ok/fail counts,
 * average duration, and per-skill/per-tool run counts. Shared by the `tools
 * ledger --stats` command and the Python twin's skill_tools_ledger tool.
 */
export function ledgerStats(regDir) {
  const check = ledgerCheck(regDir);
  const stats = {
    ...check,
    ok: 0,
    fail: 0,
    avg_duration_ms: null,
    by_skill: {},
    by_tool: {},
  };
  if (!check.exists) return stats;
  try {
    const lines = readFileSync(join(regDir, LEDGER_FILE), "utf-8").split("\n").filter(Boolean);
    const durations = [];
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.status === 0) stats.ok++;
      else stats.fail++;
      const skill = entry.skill ?? "?";
      const name = entry.name ?? "?";
      stats.by_skill[skill] = (stats.by_skill[skill] ?? 0) + 1;
      stats.by_tool[name] = (stats.by_tool[name] ?? 0) + 1;
      if (Number.isFinite(entry.duration_ms)) durations.push(entry.duration_ms);
    }
    if (durations.length) stats.avg_duration_ms = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  } catch {
    /* stats are best-effort over whatever is readable */
  }
  return stats;
}

// ---------------------------------------------------------------- TOOLS.md render

/**
 * Render the TOOLS.md reference for a policy-filtered tool list. Shared by the
 * `tools docs` CLI command and the MCP `skill_tools_docs` tool so both surfaces
 * cannot drift.
 */
export function renderToolsDocs(payload, policy) {
  const tools = filterToolsByPolicy(listSkillTools(payload), policy);
  const esc = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    "# Skill AI-Tools (TOOLS.md)",
    "",
    `Generated by parasite-skill v${VERSION}. Callable scripts/hooks/tools discovered from the registry.`,
    "",
    `${tools.length} callable tools`,
    "",
    "| Tool | Language | Skill | Description |",
    "|---|---|---|---|",
    ...tools.map((tool) => `| \`${tool.name}\` | ${tool.language} | ${tool.skill} | ${esc(tool.description).slice(0, 80)} |`),
    "",
    "## Run policy",
    "- Execution is explicit (`tools run <name>`), time-bounded (default 30000ms, cap 300000ms), captured, redacted, and recorded in the audit ledger.",
    "- Project policy (`parasite-skill.json` `tools` block): allow/deny/env lists; deny wins, a non-empty allow list must match, `*` globs supported.",
    "- Scoped policy keys (`scoped`): `profile:<name>` and `sets:<set-name>` merge extra allow/deny/env for agents run.",
    "- Structured args follow each tool's declared `argsSchema` (validated before execution).",
    "- Routing or planning alone never executes tools.",
    "",
    "## Per-skill details",
    ...tools.map((tool) => [
      `### ${tool.name}`,
      "",
      `- Skill: ${tool.skill}`,
      `- Language: ${tool.language}`,
      `- Script: \`${tool.path}\``,
      `- Description: ${esc(tool.description)}`,
      ...(tool.argsSchema ? [`- Args schema: \`${JSON.stringify(tool.argsSchema)}\``] : []),
      ...(tool.timeoutMs ? [`- Declared timeout: ${tool.timeoutMs}ms`] : []),
      "",
    ]).flat(),
  ];
  return lines.join("\n") + "\n";
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
