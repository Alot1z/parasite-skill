// skill-router engine core — plain ESM JS, runs under Node.js and Bun.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export const TAG_RULES = {
  security: ["security", "secure", "secret", "auth", "owasp", "vulnerab", "hardening", "privacy", "gitleaks"],
  performance: ["perform", "fast", "optim", "latency", "cache", "speed", "bottleneck", "scale"],
  frontend: ["frontend", "ui", "css", "html", "react", "component", "accessib", "design", "theme", "canvas", "art", "favicon", "typography"],
  browser: ["browser", "playwright", "devtools", "web", "dom", "console", "screenshot", "chrome", "network"],
  testing: ["test", "tdd", "red-green", "verif", "qa", "regression"],
  debugging: ["debug", "fix", "error", "bug", "root-cause", "trace", "localize", "reproduce"],
  research: ["documentation", "research", "wiki", "find", "retriev", "search", "source", "docs", "official"],
  api: ["api", "mcp", "rest", "graphql", "endpoint", "sdk", "connector", "openapi", "interface", "integration", "schema"],
  git: ["git", "commit", "branch", "worktree", "version", "ci", "cd", "deploy", "release", "pipeline", "action", "rollback"],
  planning: ["plan", "spec", "task", "breakdown", "requirement", "story", "roadmap", "acceptance"],
  docs: ["doc", "readme", "adr", "write", "content", "prose", "guide", "manual", "communicat", "report"],
  automation: ["autom", "cli", "script", "launcher", "pinokio", "computer", "desktop", "mcp", "orchestr"],
  data: ["pdf", "docx", "pptx", "slide", "form", "table", "extract", "convert"],
  thinking: ["think", "reason", "decompos", "logic", "proposition", "clarif", "question", "interview", "doubt", "sequential", "tractatus", "cognitive"],
  codebase: ["codebase", "graph", "symbol", "architect", "module", "dependency", "knip", "unused", "refactor", "smell", "callers", "impact"],
};

export const LANG_EXT = {
  ".py": "python", ".pyw": "python",
  ".ts": "typescript", ".mts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
  ".rb": "ruby", ".php": "php", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".ps1": "powershell", ".c": "c/c++", ".h": "c/c++", ".cpp": "c/c++", ".hpp": "c/c++",
  ".cc": "c/c++", ".cs": "csharp", ".swift": "swift", ".zig": "zig", ".lua": "lua",
  ".r": "r", ".sql": "sql",
};

export const SETS = {
  thinking: { desc: "Decompose, reason, doubt", members: ["tractatus-thinking", "sequential-thinking", "7-scared-circle-clarity", "debug-thinking", "doubt-driven-development"] },
  research: { desc: "Verify against real sources", members: ["deepwiki", "context7", "find-docs", "web-reader", "research", "gitingest", "source-driven-development"] },
  planning: { desc: "Idea -> spec -> tasks", members: ["interview-me", "brainstorming", "idea-refine", "spec-driven-development", "writing-plans", "planning-and-task-breakdown", "story-quality"] },
  build: { desc: "Implement in slices", members: ["incremental-implementation", "api-and-interface-design", "system-connector", "mcp-builder", "tdd", "test-driven-development", "autonomous-implementation-pattern"] },
  docs: { desc: "Write + keep docs honest", members: ["documentation-writer", "documentation-and-adrs", "readme-skill", "api-docs-skill", "internal-comms", "stop-slop", "docx", "pdf", "pptx"] },
  review: { desc: "Gate before merge", members: ["code-review-and-quality", "code-review-graph", "code-simplification", "verification-before-completion"] },
  frontend: { desc: "UI that actually works", members: ["frontend-design", "frontend-ui-engineering", "theme-factory", "artifacts-builder", "favicon", "browser-testing-with-devtools", "webapp-testing", "playwright-cli", "agent-browser"] },
  ops: { desc: "Ship safely", members: ["git-workflow-and-versioning", "using-git-worktrees", "ci-cd-and-automation", "github-actions-docs", "shipping-and-launch", "observability-and-instrumentation", "security-and-hardening"] },
  intelligence: { desc: "Understand the codebase", members: ["ix", "understand", "code-review-graph", "graphify", "improve-codebase-architecture", "knip"] },
};

// ---------------------------------------------------------------- paths

export function registryDir(override) {
  const d = override
    ? override
    : join(HOME, ".agents", "skills", REGISTRY_NAME);
  mkdirSync(d, { recursive: true });
  return d;
}

export function defaultScanDirs() {
  const dirs = [];
  for (const d of [
    join(HOME, ".agents", "skills"),
    join(HOME, ".claude", "skills"),
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
        const lang = LANG_EXT[full.slice(full.lastIndexOf(".")).toLowerCase()];
        if (lang && !languages.includes(lang)) languages.push(lang);
      }
    }
  };
  walk(join(skillPath, "scripts"));
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
      if (e.name.startsWith(".") || !e.isDirectory()) continue;
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

export function scoreIdea(payload, idea) {
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
  const setScores = Object.entries(SETS)
    .map(([sn, { members }]) => [
      sn,
      Math.round(scored.filter(([nm]) => members.includes(nm)).reduce((a, [, sc]) => a + sc, 0) * 100) / 100,
    ])
    .sort((a, b) => b[1] - a[1]);
  return { scored, setScores };
}
