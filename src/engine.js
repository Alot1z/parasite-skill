// parasite-skill engine core — plain ESM JS, runs under Node.js and Bun.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { LANG_EXT, TAG_RULES } from "./data/tags.js";
import { SETS as SETS_DATA } from "./data/sets.js";

export const SETS = SETS_DATA;

// Custom skill-sets live in the registry dir (sets.custom.json) and are merged
// over the built-ins — the skill-sets editor writes here so edits survive.
export function loadSets(reg) {
  try {
    const f = join(reg, "sets.custom.json");
    if (existsSync(f)) {
      const custom = JSON.parse(readFileSync(f, "utf-8"));
      if (custom && typeof custom === "object") {
        return { ...SETS_DATA, ...custom };
      }
    }
  } catch {
    /* fall through to built-ins */
  }
  return SETS_DATA;
}

// Save a full custom-sets object (only non-built-in names are persisted).
export function saveCustomSets(reg, custom) {
  const f = join(reg, "sets.custom.json");
  writeFileSync(f, JSON.stringify(custom, null, 2) + "\n", "utf-8");
  return f;
}

// Merge project-defined sets (from parasite-skill.json) over the registry sets.
// A project can declare its own workflow sets without touching sets.custom.json
// or the built-ins. Project sets are marked so listings can label them.
export function loadSetsWithProject(reg, projectSets) {
  const sets = { ...loadSets(reg) };
  if (projectSets && typeof projectSets === "object") {
    for (const [name, def] of Object.entries(projectSets)) {
      if (def && typeof def === "object" && Array.isArray(def.members)) {
        sets[name] = {
          desc: typeof def.desc === "string" ? def.desc : "project set",
          members: def.members.filter((m) => typeof m === "string"),
          project: true,
        };
      }
    }
  }
  return sets;
}

export const VERSION = "1.1.0";
export const REGISTRY_NAME = ".parasite-skill";
export const HOME = homedir();

export const STOPWORDS = new Set(
  ("a an and or of to in for on with use when this that is are be was were it its as at by from into over after " +
    "before between then what how all can not you your they them he she we will would could should may might must " +
    "if than so such do does did have has had the their there here about which who whom any each more most other " +
    "some only own same too very just also ever never once many few much well good great like using used use usage " +
    "user users request idea text skill skills need needs want wants help").split(" "),
);

// ---------------------------------------------------------------- paths

// PARASITE_SKILL_HOME is honored across the whole package (installs, sync, MCP,
// and now the registry) so sandboxed runs and tests stay fully isolated.
const BASE_HOME = () => process.env.PARASITE_SKILL_HOME || HOME;  // || not ?? so "" falls back

export function registryDir(override) {
  const d = override ? override : join(BASE_HOME(), ".agents", "skills", REGISTRY_NAME);
  mkdirSync(d, { recursive: true });
  return d;
}

export function defaultScanDirs() {
  const dirs = [];
  const base = BASE_HOME();
  for (const d of [
    join(base, ".agents", "skills"),
    join(base, ".claude", "skills"),
    join(".agents", "skills"),
    join(".claude", "skills"),
  ]) {
    if (existsSync(d)) dirs.push(d);
  }
  return dirs;
}

export function expandDirs(extra) {
  const dirs = defaultScanDirs();
  if (extra) {
    for (const part of extra.split(",")) {
      const p = part.trim();
      if (p && existsSync(p)) dirs.push(p);
    }
  }
  return [...new Set(dirs)];
}

// ---------------------------------------------------------------- parsing

export function parseFrontmatter(text) {
  const meta = {};
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*\r?\n/m);
  if (!m) return meta;
  let key = null;
  let buf = [];
  let inBlock = false;
  const commit = () => {
    if (key !== null) meta[key] = buf.join(" ").trim();
    key = null;
    buf = [];
  };
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (inBlock) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        buf.push(line.trim());
        continue;
      }
      inBlock = false;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(k)) continue;
    commit();
    key = k;
    const rest = line.slice(idx + 1).trim();
    if (rest === "" || ["|", ">", "|-", ">-", "|2", "|2-"].includes(rest)) {
      inBlock = true;
      buf = [];
    } else {
      buf = [rest.replace(/^["']|["']$/g, "")];
      commit();
    }
  }
  commit();
  return meta;
}

export function stem(w) {
  if (w.length > 4) {
    for (const suf of ["ing", "ed", "es"]) {
      if (w.endsWith(suf)) {
        let base = w.slice(0, -suf.length);
        // collapse doubled final consonant (debugging -> debug, running -> run)
        if (base.length > 2 && base.at(-1) === base.at(-2)) base = base.slice(0, -1);
        return base;
      }
    }
    if (w.endsWith("s")) return w.slice(0, -1);
  }
  return w;
}

export function tokenize(text) {
  return [...text.toLowerCase().matchAll(/[a-z0-9][a-z0-9'-]*/g)]
    .map((m) => m[0])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

export function inferTags(name, description) {
  const hay = `${name} ${description}`.toLowerCase();
  return Object.entries(TAG_RULES)
    .filter(([, words]) => words.some((w) => hay.includes(w)))
    .map(([tag]) => tag)
    .sort();
}

// ---------------------------------------------------------------- scanning

// Manifest-based detection: build files reveal the language even when the
// scripts dir holds no source files (Rust Cargo.toml, Go go.mod, ...).
// Keys are lowercase; lookups normalize the file name before matching,
// mirroring the LANG_EXT convention in src/data/tags.js.
const ASSET_DIRS = ["references", "templates", "scripts", "assets", "hooks", "prompts", "tools", "examples", "docs"];
const SAFE_EXCERPT_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const SENSITIVE_ASSET_NAME = /(^|[._-])(env|secret|credential|password|token|private[-_]?key)([._-]|$)/i;

const MANIFEST_LANG = {
  "cargo.toml": "rust",
  "cargo.lock": "rust",
  "cargo.toml.example": "rust",
  "go.mod": "go",
  "package.json": "javascript",
  "bun.lock": "javascript",
  "bun.lockb": "javascript",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "pom.xml": "java",
  "build.gradle": "java",
  "mod.ts": "typescript",
  "deno.json": "typescript",
  "composer.json": "php",
  "gemfile": "ruby",
  "mix.exs": "elixir",
};

export function scanSkillDir(skillPath) {
  const md = join(skillPath, "SKILL.md");
  if (!existsSync(md)) return null;
  let text = "";
  try {
    text = readFileSync(md, "utf-8");
  } catch {
    text = "";
  }
  const meta = parseFrontmatter(text);
  const name = meta.name ?? skillPath.split(/[\\/]/).pop() ?? "?";
  const description = meta.description ?? "";
  const subdirs = {};
  for (const d of ASSET_DIRS) {
    const p = join(skillPath, d);
    if (existsSync(p)) {
      try {
        subdirs[d] = readdirSync(p).filter((name) => !name.startsWith("."));
      } catch {
        subdirs[d] = [];
      }
    }
  }
  const assets = scanSkillAssets(skillPath);
  // Skills may declare AI-tool metadata (description / argsSchema overrides) as
  // a `tools:` JSON block in the frontmatter, keyed by tool name or asset path.
  let toolsMeta = null;
  if (typeof meta.tools === "string" && meta.tools.trim()) {
    try {
      const parsed = JSON.parse(meta.tools);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) toolsMeta = parsed;
    } catch {
      toolsMeta = null; // malformed metadata is ignored, never fatal
    }
  }
  const languages = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const manifestLang = MANIFEST_LANG[e.name.toLowerCase()];
        if (manifestLang && !languages.includes(manifestLang)) languages.push(manifestLang);
        const lang = LANG_EXT[full.slice(full.lastIndexOf(".")).toLowerCase()];
        if (lang && !languages.includes(lang)) languages.push(lang);
      }
    }
  };
  walk(join(skillPath, "scripts"));
  // Also check the skill root for manifests (scripts may be absent entirely).
  try {
    for (const e of readdirSync(skillPath, { withFileTypes: true })) {
      const manifestLang = MANIFEST_LANG[e.name.toLowerCase()];
      if (manifestLang && !languages.includes(manifestLang)) languages.push(manifestLang);
    }
  } catch {
    /* ignore */
  }
  const issues = [];
  if (name !== (skillPath.split(/[\\/]/).pop() ?? "")) issues.push(`name '${name}' != directory`);
  if (!description) issues.push("missing description");
  else if (description.length < 1 || description.length > 1024) issues.push("description length out of 1-1024");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) issues.push(`name '${name}' fails spec format`);
  const keywords = [...new Set([...tokenize(`${name} ${description}`), ...inferTags(name, description)])].sort();
  // Body keywords: tokenize the SKILL.md content after the frontmatter so
  // routing can match skills whose description is thin but body is rich.
  const bodyMatch = text.match(/^---[ \t]*\r?\n[\s\S]*?^---[ \t]*\r?\n([\s\S]*)$/m);
  const bodyKeywords = [...new Set(tokenize(bodyMatch ? bodyMatch[1] : text).filter((t) => t.length >= 3))].sort();
  return {
    name,
    path: skillPath.replace(/\\/g, "/"),
    description,
    dirs: subdirs,
    assets,
    languages: languages.sort(),
    tags: inferTags(name, description),
    keywords,
    bodyKeywords,
    spec_ok: issues.length === 0,
    issues,
    ...(toolsMeta ? { toolsMeta } : {}),
  };
}

export function scanSkillAssets(skillPath, maxFiles = 240) {
  const assets = [];
  const walk = (root, dir) => {
    if (assets.length >= maxFiles || !existsSync(dir)) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (assets.length >= maxFiles || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (SENSITIVE_ASSET_NAME.test(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(root, full);
        continue;
      }
      if (!entry.isFile()) continue;
      let bytes = 0;
      try { bytes = statSync(full).size; } catch { /* ignore unreadable files */ }
      const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
      const rel = relative(skillPath, full).replace(/\\/g, "/");
      const top = rel.split("/")[0];
      assets.push({
        path: rel,
        group: ASSET_DIRS.includes(top) ? top : "other",
        bytes,
        language: LANG_EXT[ext] ?? null,
        excerptable: SAFE_EXCERPT_EXTENSIONS.has(ext) && bytes <= 200_000,
      });
    }
  };
  for (const dirName of ASSET_DIRS) walk(skillPath, join(skillPath, dirName));
  return assets.sort((a, b) => a.path.localeCompare(b.path));
}

function sanitizeChatText(text) {
  let redacted = String(text);
  const replace = (pattern, replacement) => {
    redacted = redacted.replace(new RegExp(pattern, "gi"), replacement);
  };
  replace(String.raw`(authorization|bearer|token|secret|password|api[_-]?key)(\s*[=:]\s*)(\S+)`, "$1$2<redacted>");
  replace(String.raw`-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----`, "<private-key-redacted>");
  replace(String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`, "<email-redacted>");
  const unixPrefixes = ["/Users/", "/home/", "/tmp/", "/workspace/", "/private/", "/mnt/", "/opt/", "/var/", "/etc/"];
  return redacted.split(" ").map((part) => {
    const normalized = part.replaceAll("\\", "/");
    const drive = normalized.charCodeAt(0);
    const windowsAbsolute = normalized.length >= 3 && drive >= 65 && drive <= 90 && normalized[1] === ":" && normalized[2] === "/";
    const unixAbsolute = unixPrefixes.some((prefix) => normalized.startsWith(prefix));
    return windowsAbsolute || unixAbsolute ? "<path-redacted>" : part;
  }).join(" ");
}

function markdownSections(text) {
  const body = text.replace(/^---[ \\t]*\\r?\\n[\\s\\S]*?^---[ \\t]*\\r?\\n/m, "");
  const matches = [...body.matchAll(/(?=^#{1,6}\\s+)/gm)];
  if (!matches.length) return [{ heading: "content", text: body.trim() }];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? body.length;
    const chunk = body.slice(start, end).trim();
    const heading = chunk.match(/^#{1,6}\\s+(.+)$/)?.[1]?.trim() ?? "content";
    return { heading, text: chunk };
  }).filter((section) => section.text);
}

function excerptForAsset(skillPath, asset, requestTokens, maxChars) {
  if (!asset.excerptable) return null;
  try {
    const text = readFileSync(join(skillPath, asset.path), "utf-8");
    const sections = asset.path.toLowerCase().endsWith(".md") || asset.path.toLowerCase().endsWith(".mdx")
      ? markdownSections(text)
      : [{ heading: "content", text }];
    const scored = sections.map((section) => {
      const tokens = new Set(tokenize(`${section.heading} ${section.text}`));
      const score = requestTokens.reduce((n, token) => n + (tokens.has(token) ? 1 : 0), 0);
      return { ...section, score };
    }).sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    const selected = scored.slice(0, 2).map((section) => section.text).join("\\n\\n");
    return sanitizeChatText(selected.slice(0, maxChars));
  } catch {
    return null;
  }
}

// Callable AI-tool naming mirrors ai-tools.js `toolNameFor` so the compose
// payload and the executable surface stay in sync: `<skill>__<base>` where base
// is the asset file name minus its extension, lowercased and sanitized. Only
// assets in the scripts/hooks/tools groups with a known interpreter are listed.
const TOOL_GROUPS_FOR_COMPOSE = new Set(["scripts", "hooks", "tools"]);
const TOOL_INTERPRETERS_FOR_COMPOSE = new Set([".py", ".js", ".mjs", ".cjs", ".sh", ".bash"]);

export function callableToolsForSkill(skill) {
  const tools = [];
  for (const asset of skill?.assets ?? []) {
    if (!TOOL_GROUPS_FOR_COMPOSE.has(asset.group)) continue;
    const ext = asset.path.slice(asset.path.lastIndexOf(".")).toLowerCase();
    if (!TOOL_INTERPRETERS_FOR_COMPOSE.has(ext)) continue;
    const base = asset.path.split("/").pop().replace(/\.[^.]+$/, "");
    const name = `${skill.name}__${base}`.toLowerCase().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
    const meta = skill.toolsMeta?.[name] ?? skill.toolsMeta?.[asset.path] ?? {};
    tools.push({
      name,
      path: asset.path,
      language: asset.language ?? (ext === ".py" ? "python" : ext.slice(1)),
      argsSchema: meta.argsSchema && typeof meta.argsSchema === "object" ? true : undefined,
      description: typeof meta.description === "string" && meta.description.trim() ? meta.description.trim().slice(0, 200) : undefined,
    });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

const REQUEST_MODE_RULES = {
  analysis: ["analy", "understand", "explain", "inspect", "trace", "map"],
  implementation: ["implement", "build", "create", "add", "change", "modify", "feature"],
  debugging: ["debug", "fix", "broken", "error", "fail", "issue", "bug"],
  research: ["research", "verify", "official", "documentation", "compare", "investigate"],
  writing: ["write", "document", "readme", "guide", "report", "prose"],
  testing: ["test", "verify", "regression", "coverage", "qa"],
  shipping: ["deploy", "release", "launch", "ci", "pipeline", "publish"],
};

export function classifyRequest(idea) {
  const lower = String(idea ?? "").toLowerCase();
  const modes = Object.entries(REQUEST_MODE_RULES)
    .filter(([, words]) => words.some((word) => lower.includes(word)))
    .map(([mode]) => mode);
  const explicitSkills = [];
  for (const name of arguments.length > 1 && arguments[1]?.skills ? arguments[1].skills : []) {
    if (lower.includes(name.toLowerCase())) explicitSkills.push(name);
  }
  return {
    modes: modes.length ? modes : ["general"],
    tags: inferTags("request", idea),
    explicitSkills,
  };
}

export function composePayload(payload, idea, options = {}) {
  const sets = options.sets ?? SETS;
  // Optional per-tool static-audit risk map (name -> low|medium|high) supplied
  // by command layers that already computed it (compose/plan/llm/agents-run).
  // When present, every selected skill's tools carry their risk so the runtime
  // payload shows posture without the engine doing its own audit.
  const toolsRisk = options.toolsRisk && typeof options.toolsRisk === "object" ? options.toolsRisk : null;
  const allSkills = payload.skills ?? [];
  const classification = classifyRequest(idea, { skills: allSkills.map((skill) => skill.name).sort() });
  const base = scoreIdea(payload, idea, sets);
  const requestTokens = tokenize(idea);
  const excluded = new Set(Array.isArray(options.excludeSkills) ? options.excludeSkills : []);
  const hasEnabledSetFilter = Array.isArray(options.enabledSets) && options.enabledSets.length > 0;
  const allowed = new Set();
  if (hasEnabledSetFilter) {
    for (const setName of options.enabledSets) for (const member of sets[setName]?.members ?? []) allowed.add(member);
  }
  const ranked = allSkills.map((skill) => {
    const original = base.scored.find(([name]) => name === skill.name)?.[1] ?? 0;
    const matched = requestTokens.filter((token) => (skill.keywords ?? []).includes(token) || (skill.bodyKeywords ?? []).includes(token));
    const explicit = classification.explicitSkills.includes(skill.name);
    const tagOverlap = classification.tags.filter((tag) => (skill.tags ?? []).includes(tag));
    const modeBoost = classification.modes.includes("general") ? 0 : tagOverlap.length * 0.75;
    return {
      skill,
      score: Math.round((original + modeBoost + (explicit ? 1000 : 0)) * 100) / 100,
      matched: [...new Set(matched)].slice(0, 8),
      tagOverlap,
      explicit,
    };
  }).filter((entry) => !excluded.has(entry.skill.name) && (!hasEnabledSetFilter || allowed.has(entry.skill.name)) && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

  const top = Math.max(1, Math.min(Number(options.top) || 6, 12));
  const selected = ranked.slice(0, top);
  const permittedSetNames = Array.isArray(options.enabledSets) && options.enabledSets.length
    ? options.enabledSets.filter((name) => sets[name])
    : Object.keys(sets);
  const memberSet = base.setScores.find(([name]) => permittedSetNames.includes(name) && selected.some((entry) => sets[name]?.members?.includes(entry.skill.name)))?.[0]
    ?? permittedSetNames.find((name) => sets[name]?.members?.some((member) => selected.some((entry) => entry.skill.name === member)));
  const modeSet = classification.modes.map((mode) => ({ analysis: "intelligence", implementation: "build", debugging: "review", research: "research", writing: "docs", testing: "review", shipping: "ops" }[mode])).find((name) => name && permittedSetNames.includes(name));
  const tagSet = classification.tags.find((tag) => permittedSetNames.includes(tag)) || (classification.tags.includes("api") && permittedSetNames.includes("build") ? "build" : null);
  const bestSet = memberSet ?? modeSet ?? tagSet ?? permittedSetNames[0] ?? (Array.isArray(options.enabledSets) && options.enabledSets.length ? "none" : "thinking");
  const requestedBudget = Number(options.maxChars);
  const excerptBudget = Number.isFinite(requestedBudget) ? Math.max(0, Math.min(requestedBudget, 20000)) : 9000;
  let usedChars = 0;
  const selectedSkills = selected.map((entry) => {
    const skill = entry.skill;
    const assets = (skill.assets?.length ? skill.assets : scanSkillAssets(skill.path)).map((asset) => ({ ...asset }));
    const assetRank = assets.map((asset) => ({
      asset,
      score: requestTokens.reduce((n, token) => n + (tokenize(asset.path).includes(token) ? 1 : 0), 0) + (asset.excerptable ? 0.25 : 0),
    })).sort((a, b) => b.score - a.score || a.asset.path.localeCompare(b.asset.path));
    const chosenAssets = assetRank.slice(0, 6).map(({ asset }) => ({
      path: sanitizeChatText(asset.path),
      group: asset.group,
      language: asset.language,
      bytes: asset.bytes,
      load: asset.excerptable ? "selected excerpt below or load on demand" : "load on demand",
    }));
    const excerpts = [];
    for (const { asset } of assetRank) {
      if (usedChars >= excerptBudget || excerpts.length >= 3) break;
      const remaining = Math.min(1600, excerptBudget - usedChars);
      const text = excerptForAsset(skill.path, asset, requestTokens, remaining);
      if (!text) continue;
      excerpts.push({ path: sanitizeChatText(asset.path), text });
      usedChars += text.length;
    }
    return {
      name: skill.name,
      description: sanitizeChatText(skill.description),
      score: entry.score,
      why: {
        matched: entry.matched,
        tags: entry.tagOverlap,
        explicit: entry.explicit,
      },
      languages: skill.languages ?? [],
      capabilities: skill.tags ?? [],
      assets: chosenAssets,
      // Callable AI-tools this skill declares (scripts/hooks/tools with a known
      // interpreter): names the host LLM can actually execute via tools run.
      // When the caller supplies a toolsRisk map, each tool carries its
      // static-audit risk so the payload shows posture.
      tools: toolsRisk
        ? callableToolsForSkill(skill).map((tool) => ({ ...tool, risk: toolsRisk[tool.name] ?? "low" }))
        : callableToolsForSkill(skill),
      excerpts,
    };
  });

  const autoMax = options.auto === true;
  // Auto-max mode pins the always-on thinking cadence ahead of the routed
  // skills so execution always starts with decomposition, stays doubtful
  // between steps, and ends with verification — without dumping the registry.
  const cadenceStart = ["tractatus-thinking", "sequential-thinking", "doubt-driven-development"];
  const cadenceEnd = ["verification-before-completion", "code-review-and-quality"];
  const selectedOrder = selectedSkills.map((skill) => skill.name);
  const executionOrder = autoMax
    ? [...new Set([...cadenceStart, ...selectedOrder, ...cadenceEnd])]
    : selectedOrder;

  return {
    kind: "parasite-skill-runtime-payload",
    version: VERSION,
    request: sanitizeChatText(String(idea)),
    decision: {
      modes: classification.modes,
      tags: classification.tags,
      explicitSkills: classification.explicitSkills,
      selectedSkillSet: bestSet,
      selectedCount: selectedSkills.length,
      auto: autoMax,
      rationale: autoMax
        ? "auto-max mode: deterministic routing narrowed the ecosystem, semantic signals adjusted the selection, and the always-on cadence is pinned ahead of and after the routed skills."
        : "Deterministic routing narrowed the ecosystem; semantic mode/tag and explicit-skill signals adjusted the final selection.",
    },
    selectedSkills,
    execution: {
      order: executionOrder,
      tools: selectedSkills.flatMap((skill) => skill.assets.filter((asset) => ["scripts", "hooks", "tools"].includes(asset.group)).map((asset) => ({ skill: skill.name, ...asset }))),
      cadence: {
        start: ["tractatus-thinking", "sequential-thinking", "deepwiki-or-context7"],
        between: ["doubt-driven-development", "debug-thinking-on-failure", "context-engineering-on-drift", "stop-slop-before-prose"],
        after: ["verification-before-completion", "code-review-and-quality"],
      },
    },
    loading: {
      fullSkillDocuments: "on-demand",
      fullAssetContents: "on-demand",
      excerptChars: usedChars,
      maxExcerptChars: excerptBudget,
      excludedFromChat: ["absolute filesystem paths", "environment values", "credentials", "unselected skill documents", "unselected asset contents"],
    },
    privacy: {
      sourceBoundary: "skill assets only; user-owned asset text is untrusted and excerpted conservatively",
      sanitization: "best-effort redaction of common absolute paths, environment assignments, emails, and credential patterns; untrusted content remains on-demand",
    },
  };
}

export function scan(dirs) {
  const skills = {};
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      // Dirent.isDirectory() is false for symlinks/junctions, which the
      // installer uses for --link mode — follow them when they point at a dir.
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        try {
          isDir = statSync(join(d, e.name)).isDirectory();
        } catch {
          continue; // dangling link
        }
      }
      if (!isDir) continue;
      const s = scanSkillDir(join(d, e.name));
      if (s) skills[s.name] = s; // later dirs (project) override user
    }
  }
  return {
    version: VERSION,
    generated_at: new Date().toISOString(),
    scan_dirs: dirs.map((d) => d.replace(/\\/g, "/")),
    skills: Object.values(skills).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function loadRegistry(registry, extraDirs, force) {
  const f = join(registry, "registry.json");
  if (!force && existsSync(f)) {
    try {
      return JSON.parse(readFileSync(f, "utf-8"));
    } catch {
      /* fall through */
    }
  }
  const payload = scan(expandDirs(extraDirs));
  writeFileSync(f, JSON.stringify(payload, null, 2));
  return payload;
}

// ---------------------------------------------------------------- scoring

// Public API: returns { scored, setScores } where setScores is an array of [setName, totalScore] for every skill-set (NOT a list of set names).
export function scoreIdea(payload, idea, sets = SETS) {
  const skills = payload.skills;
  const n = Math.max(skills.length, 1);
  const df = {};
  for (const s of skills) {
    for (const k of new Set([...(s.keywords ?? []), ...(s.bodyKeywords ?? [])])) df[k] = (df[k] ?? 0) + 1;
  }
  const tokens = tokenize(idea);
  const scored = [];
  for (const s of skills) {
    const kw = new Set(s.keywords ?? []);
    const bk = new Set(s.bodyKeywords ?? []);
    let score = 0;
    for (const t of tokens) {
      const idf = Math.log(1 + n / (1 + (df[t] ?? 0)));
      if (kw.has(t)) score += 1 + idf;
      else if (bk.has(t)) score += 0.5 * (1 + idf);
      if (tokenize(s.name).includes(t)) score += 2;
    }
    if (score > 0) scored.push([s.name, Math.round(score * 100) / 100]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return { scored, setScores: bestSets(skills, scored, sets ?? SETS) };
}

export function bestSets(skills, scored, sets = SETS) {
  const names = new Set(skills.map((s) => s.name));
  return Object.entries(sets)
    .map(([sn, { members }]) => [
      sn,
      Math.round(scored.filter(([nm]) => members.includes(nm) && names.has(nm)).reduce((a, [, sc]) => a + sc, 0) * 100) / 100,
    ])
    .sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- project config

// Load project-level config from parasite-skill.json in the current working
// directory. This allows each project to define default sets, registry
// location, scan dirs, and other settings.
export function loadProjectConfig(startDir = process.cwd()) {
  const configNames = ["parasite-skill.json", ".parasite-skill.json"];
  let dir = startDir;
  
  // Walk up the directory tree to find a config file
  while (dir !== dirname(dir)) {
    for (const name of configNames) {
      const configPath = join(dir, name);
      if (existsSync(configPath)) {
        try {
          const raw = readFileSync(configPath, "utf-8");
          const config = JSON.parse(raw);
          return {
            ...config,
            _path: configPath,
            _dir: dir,
          };
        } catch (err) {
          console.error(`Warning: failed to parse ${configPath}: ${err.message}`);
        }
      }
    }
    dir = dirname(dir);
  }
  
  return null;
}

// Merge project config with CLI flags. CLI flags take precedence.
export function mergeConfig(projectConfig, cliFlags) {
  if (!projectConfig) return cliFlags;
  
  const merged = { ...cliFlags };
  
  // Apply project defaults only if CLI didn't set them
  if (projectConfig.registry && !cliFlags.registry) {
    // Validate registry is a string
    if (typeof projectConfig.registry === "string") {
      merged.registry = projectConfig.registry;
    } else {
      console.error("Warning: invalid 'registry' in parasite-skill.json (expected string)");
    }
  }
  
  if (projectConfig.dirs && !cliFlags.dirs) {
    // Handle both array and string formats for dirs
    if (Array.isArray(projectConfig.dirs)) {
      merged.dirs = projectConfig.dirs.join(",");
    } else if (typeof projectConfig.dirs === "string") {
      merged.dirs = projectConfig.dirs;
    } else {
      console.error("Warning: invalid 'dirs' in parasite-skill.json (expected string or array)");
    }
  }
  
  if (projectConfig.defaultSet && !cliFlags.set) {
    // Validate defaultSet is a string
    if (typeof projectConfig.defaultSet === "string") {
      merged.set = projectConfig.defaultSet;
    } else {
      console.error("Warning: invalid 'defaultSet' in parasite-skill.json (expected string)");
    }
  }
  
  if (projectConfig.force !== undefined && !cliFlags.force) {
    // Validate force is a boolean
    if (typeof projectConfig.force === "boolean") {
      merged.force = projectConfig.force;
    } else {
      console.error("Warning: invalid 'force' in parasite-skill.json (expected boolean)");
    }
  }
  
  // Project-defined skill-sets ride along on the ctx so sets/route/plan can
  // overlay them. CLI flags cannot express sets, so no CLI-precedence rule.
  if (projectConfig.sets !== undefined && projectConfig.sets !== null) {
    if (typeof projectConfig.sets === "object" && !Array.isArray(projectConfig.sets)) {
      const valid = {};
      for (const [name, def] of Object.entries(projectConfig.sets)) {
        if (def && typeof def === "object" && Array.isArray(def.members) && def.members.length) {
          valid[name] = def;
        }
      }
      if (Object.keys(valid).length) merged.sets = valid;
      else console.error("Warning: 'sets' in parasite-skill.json has no valid {name: {members[]}} entries");
    } else {
      console.error("Warning: invalid 'sets' in parasite-skill.json (expected object of {name: {desc, members[]}})");
    }
  }

  // Project routing controls: enabledSets restricts routing to those sets,
  // excludeSkills blacklists skills, route tunes scoring knobs.
  if (projectConfig.enabledSets !== undefined && projectConfig.enabledSets !== null) {
    if (Array.isArray(projectConfig.enabledSets) && projectConfig.enabledSets.every((s) => typeof s === "string")) {
      merged.enabledSets = projectConfig.enabledSets;
    } else {
      console.error("Warning: invalid 'enabledSets' in parasite-skill.json (expected array of set names)");
    }
  }

  if (projectConfig.excludeSkills !== undefined && projectConfig.excludeSkills !== null) {
    if (Array.isArray(projectConfig.excludeSkills) && projectConfig.excludeSkills.every((s) => typeof s === "string")) {
      merged.excludeSkills = projectConfig.excludeSkills;
    } else {
      console.error("Warning: invalid 'excludeSkills' in parasite-skill.json (expected array of skill names)");
    }
  }

  if (projectConfig.route !== undefined && projectConfig.route !== null) {
    if (typeof projectConfig.route === "object" && !Array.isArray(projectConfig.route)) {
      const route = {};
      if (typeof projectConfig.route.top === "number" && projectConfig.route.top > 0) route.top = projectConfig.route.top;
      if (typeof projectConfig.route.minScore === "number" && projectConfig.route.minScore >= 0) route.minScore = projectConfig.route.minScore;
      if (Object.keys(route).length) merged.route = route;
      else console.error("Warning: 'route' in parasite-skill.json has no valid knobs (top > 0, minScore >= 0)");
    } else {
      console.error("Warning: invalid 'route' in parasite-skill.json (expected object)");
    }
  }

  // Per-project env isolation: an object of key/value strings applied to
  // generated parasite hooks/wrappers and exposed as ctx.env. It never
  // mutates the calling shell environment. For full sandbox isolation of the
  // whole package (registry, installs, sync, MCP) use PARASITE_SKILL_HOME.
  if (projectConfig.env !== undefined && projectConfig.env !== null) {
    if (typeof projectConfig.env === "object" && !Array.isArray(projectConfig.env)) {
      merged.env = projectConfig.env;
    } else {
      console.error("Warning: invalid 'env' in parasite-skill.json (expected object of key/value strings)");
    }
  }

  // Per-project parasite control: `false` disables runtime injections for
  // this project; an object { enabled, clients[] } restricts which clients
  // are touched. "Toggleable but also able not to use it" — per project.
  if (projectConfig.parasite !== undefined && projectConfig.parasite !== null) {
    if (typeof projectConfig.parasite === "boolean") {
      merged.parasite = { enabled: projectConfig.parasite };
    } else if (typeof projectConfig.parasite === "object" && !Array.isArray(projectConfig.parasite)) {
      const parasite = { enabled: projectConfig.parasite.enabled !== false };
      if (Array.isArray(projectConfig.parasite.clients) && projectConfig.parasite.clients.every((c) => typeof c === "string")) {
        parasite.clients = projectConfig.parasite.clients;
      }
      merged.parasite = parasite;
    } else {
      console.error("Warning: invalid 'parasite' in parasite-skill.json (expected boolean or {enabled, clients[]})");
    }
  }

  // Project GC TTL policy: prune stale registry artifacts on `tools gc` when
  // CLI flags are absent. { ageDays?: number, keep?: number, auto?: boolean }.
  // `ageDays` prunes artifacts older than N days; `keep` retains only the N
  // newest; `auto` marks the policy as safe to run unattended (CI/doctor).
  if (projectConfig.gc !== undefined && projectConfig.gc !== null) {
    if (typeof projectConfig.gc === "object" && !Array.isArray(projectConfig.gc)) {
      const gc = {};
      if (typeof projectConfig.gc.ageDays === "number" && projectConfig.gc.ageDays >= 0) gc.ageDays = projectConfig.gc.ageDays;
      if (typeof projectConfig.gc.keep === "number" && projectConfig.gc.keep >= 0) gc.keep = projectConfig.gc.keep;
      if (typeof projectConfig.gc.auto === "boolean") gc.auto = projectConfig.gc.auto;
      if (Object.keys(gc).length) merged.gc = gc;
      else console.error("Warning: 'gc' in parasite-skill.json has no valid ageDays/keep/auto values");
    } else {
      console.error("Warning: invalid 'gc' in parasite-skill.json (expected object with ageDays/keep/auto)");
    }
  }

  // Per-project AI-tools policy: { allow?: string[], deny?: string[], env?: string[] }.
  // Restricts which skill tools may execute and which environment keys are
  // visible to tool processes. CLI flags (--env-filter) still win on env keys.
  if (projectConfig.tools !== undefined && projectConfig.tools !== null) {
    if (typeof projectConfig.tools === "object" && !Array.isArray(projectConfig.tools)) {
      const tools = {};
      for (const key of ["allow", "deny", "env"]) {
        if (Array.isArray(projectConfig.tools[key]) && projectConfig.tools[key].every((v) => typeof v === "string")) {
          tools[key] = projectConfig.tools[key];
        }
      }
      // Project-wide execution timeout in ms (>=1000), overridable by --timeout-ms.
      if (typeof projectConfig.tools.timeoutMs === "number" && projectConfig.tools.timeoutMs >= 1000) {
        tools.timeoutMs = projectConfig.tools.timeoutMs;
      }
      if (Object.keys(tools).length) merged.tools = { ...(merged.tools ?? {}), ...tools };
      else console.error("Warning: 'tools' in parasite-skill.json has no valid allow/deny/env arrays");
    } else {
      console.error("Warning: invalid 'tools' in parasite-skill.json (expected object with allow/deny/env string arrays)");
    }
  }
  // CLI --env-filter a,b replaces the configured env allowlist but preserves
  // the project allow/deny lists parsed above.
  if (cliFlags.envFilter) {
    merged.tools = { ...(merged.tools ?? {}), env: String(cliFlags.envFilter).split(",").map((v) => v.trim()).filter(Boolean) };
  }

  // Project-scoped client allowlist: only these clients are managed by
  // install/refresh/parasite/export in this project. CLI --clients wins.
  if (projectConfig.clients !== undefined && projectConfig.clients !== null && !cliFlags.clients) {
    if (Array.isArray(projectConfig.clients) && projectConfig.clients.every((c) => typeof c === "string")) {
      merged.clients = projectConfig.clients;
    } else {
      console.error("Warning: invalid 'clients' in parasite-skill.json (expected array of client ids)");
    }
  }

  // Footgun guard: routing within a set that enabledSets excludes yields an
  // empty result with no explanation — surface it up front.
  if (merged.set && Array.isArray(merged.enabledSets) && merged.enabledSets.length && !merged.enabledSets.includes(merged.set)) {
    console.error(`Warning: routing set '${merged.set}' is not in enabledSets [${merged.enabledSets.join(", ")}] — routing will return no results`);
  }

  return merged;
}
