// skill-router engine core — plain ESM JS, runs under Node.js and Bun.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
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

// Merge project-defined sets (from skill-router.json) over the registry sets.
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

export const VERSION = "1.0.0";
export const REGISTRY_NAME = ".skill-router";
export const HOME = homedir();

export const STOPWORDS = new Set(
  ("a an and or of to in for on with use when this that is are be was were it its as at by from into over after " +
    "before between then what how all can not you your they them he she we will would could should may might must " +
    "if than so such do does did have has had the their there here about which who whom any each more most other " +
    "some only own same too very just also ever never once many few much well good great like using used use usage " +
    "user users request idea text skill skills need needs want wants help").split(" "),
);

// ---------------------------------------------------------------- paths

// SKILL_ROUTER_HOME is honored across the whole package (installs, sync, MCP,
// and now the registry) so sandboxed runs and tests stay fully isolated.
const BASE_HOME = () => process.env.SKILL_ROUTER_HOME || HOME;  // || not ?? so "" falls back

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
  for (const d of ["scripts", "references", "assets"]) {
    const p = join(skillPath, d);
    if (existsSync(p)) {
      try {
        subdirs[d] = readdirSync(p);
      } catch {
        subdirs[d] = [];
      }
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
  return {
    name,
    path: skillPath.replace(/\\/g, "/"),
    description,
    dirs: subdirs,
    languages: languages.sort(),
    tags: inferTags(name, description),
    keywords,
    spec_ok: issues.length === 0,
    issues,
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
    for (const k of new Set(s.keywords)) df[k] = (df[k] ?? 0) + 1;
  }
  const tokens = tokenize(idea);
  const scored = [];
  for (const s of skills) {
    const kw = new Set(s.keywords);
    let score = 0;
    for (const t of tokens) {
      if (kw.has(t)) score += 1 + Math.log(1 + n / (1 + (df[t] ?? 0)));
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

// Load project-level config from skill-router.json in the current working
// directory. This allows each project to define default sets, registry
// location, scan dirs, and other settings.
export function loadProjectConfig(startDir = process.cwd()) {
  const configNames = ["skill-router.json", ".skill-router.json"];
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
      console.error("Warning: invalid 'registry' in skill-router.json (expected string)");
    }
  }
  
  if (projectConfig.dirs && !cliFlags.dirs) {
    // Handle both array and string formats for dirs
    if (Array.isArray(projectConfig.dirs)) {
      merged.dirs = projectConfig.dirs.join(",");
    } else if (typeof projectConfig.dirs === "string") {
      merged.dirs = projectConfig.dirs;
    } else {
      console.error("Warning: invalid 'dirs' in skill-router.json (expected string or array)");
    }
  }
  
  if (projectConfig.defaultSet && !cliFlags.set) {
    // Validate defaultSet is a string
    if (typeof projectConfig.defaultSet === "string") {
      merged.set = projectConfig.defaultSet;
    } else {
      console.error("Warning: invalid 'defaultSet' in skill-router.json (expected string)");
    }
  }
  
  if (projectConfig.force !== undefined && !cliFlags.force) {
    // Validate force is a boolean
    if (typeof projectConfig.force === "boolean") {
      merged.force = projectConfig.force;
    } else {
      console.error("Warning: invalid 'force' in skill-router.json (expected boolean)");
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
      else console.error("Warning: 'sets' in skill-router.json has no valid {name: {members[]}} entries");
    } else {
      console.error("Warning: invalid 'sets' in skill-router.json (expected object of {name: {desc, members[]}})");
    }
  }
  
  return merged;
}
