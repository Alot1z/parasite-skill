// Site data assembly. Everything is public-safe: the generated site never
// contains filesystem paths, secrets, or user-specific inventory beyond the
// names/metadata the `--public` wiki/export modes already allow.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRegistry, registryDir, loadSetsWithProject, VERSION } from "../engine.js";
import { listSkillTools } from "../ai-tools.js";
import { AGENT_PROFILES } from "../data/agent-profiles.js";
import { CLIENTS } from "../clients.js";
import { mcpRegistrationStatus } from "../mcp-register.js";
import { getInjectionStatus } from "../parasite/index.js";
import { sanitizePublicText } from "../ecosystem-graph.js";
import { PKG_ROOT } from "../commands/_lib.js";

export const REPO_URL = "https://github.com/Alot1z/parasite-skill";

const read = (p) => {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

const publicText = (value) => sanitizePublicText(String(value ?? ""));

function readRepoFile(rel) {
  return read(join(PKG_ROOT, rel));
}

function walkTree(root, rel, depth, out) {
  if (depth > 3) return;
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".bundle-tmp") continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkTree(root, path, depth + 1, out);
    else if (/\.(js|mjs|cjs|ts|py|rs|sh|json)$/.test(entry.name)) {
      try {
        const lines = readFileSync(join(root, path), "utf-8").split("\n").length;
        out.push({ path, lines });
      } catch {
        /* ignore unreadable */
      }
    }
  }
}

function recentCommits(n = 14) {
  try {
    const raw = execFileSync("git", ["log", `--max-count=${n}`, "--format=%h|%an|%ad|%s", "--date=short"], {
      encoding: "utf-8",
      cwd: PKG_ROOT,
    });
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, author, date, ...rest] = line.split("|");
        return { sha, author, date, subject: rest.join("|") };
      });
  } catch {
    return [];
  }
}

export function collectSiteData(args = {}) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  const sets = loadSetsWithProject(reg, args.sets);
  const tools = listSkillTools(payload).map((tool) => ({
    name: tool.name,
    skill: tool.skill,
    language: tool.language,
    risk: tool.risk ?? "low",
    description: publicText(tool.description ?? tool.name),
    timeoutMs: tool.timeoutMs ?? null,
    argsSchema: !!tool.argsSchema,
  }));
  const mcp = mcpRegistrationStatus().map((m) => ({ label: m.label, registered: !!m.registered }));
  const extensions = getInjectionStatus().map((e) => ({
    client: e.client,
    label: e.label,
    injections: e.injections,
    active: !!e.active,
  }));
  const clients = CLIENTS.map((c) => {
    const dest = join(c.user, "parasite-skill");
    const installed = existsSync(dest);
    return { id: c.id, label: c.label, verified: !!c.verified, installed };
  });

  const byTag = {};
  for (const s of skills) for (const t of s.tags) (byTag[t] ??= []).push(s.name);
  const publicSkills = skills.map((s) => ({
    name: s.name,
    description: publicText(s.description),
    tags: [...s.tags],
    languages: [...(s.languages ?? [])],
    spec_ok: !!s.spec_ok,
    sets: Object.entries(sets).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n),
    related: [...new Set(s.tags.flatMap((t) => byTag[t] ?? []).filter((n) => n !== s.name))].sort().slice(0, 12),
  }));

  const toolsBySkill = new Map();
  for (const tool of tools) {
    const list = toolsBySkill.get(tool.skill) ?? [];
    list.push(tool);
    toolsBySkill.set(tool.skill, list);
  }

  // Repo-authored documentation sources.
  const docs = {
    readme: readRepoFile("README.md") ?? "",
    changelog: readRepoFile("CHANGELOG.md") ?? "",
    design: readRepoFile("design.md") ?? "",
    mcp: readRepoFile(join("docs", "MCP.md")) ?? "",
    research: readRepoFile(join("docs", "RESEARCH.md")) ?? "",
    skill: readRepoFile(join("skill", "SKILL.md")) ?? "",
    exampleConfig: readRepoFile("parasite-skill.example.json") ?? "",
    references: {},
  };
  try {
    for (const name of readdirSync(join(PKG_ROOT, "skill", "references"))) {
      if (name.endsWith(".md")) docs.references[name.replace(/\.md$/, "")] = readRepoFile(join("skill", "references", name)) ?? "";
    }
  } catch {
    /* no references dir */
  }

  const srcTree = [];
  walkTree(PKG_ROOT, "src", 0, srcTree);
  walkTree(PKG_ROOT, "bin", 0, srcTree);
  walkTree(PKG_ROOT, "scripts", 0, srcTree);

  let pkg = {};
  try {
    pkg = JSON.parse(readRepoFile("package.json") ?? "{}");
  } catch {
    /* keep empty */
  }

  return {
    version: VERSION,
    pkgVersion: pkg.version,
    pkgDescription: pkg.description ?? "parasite-skill",
    repo: REPO_URL,
    generatedAt: new Date().toISOString(),
    commit: recentCommits(),
    skills: publicSkills,
    sets,
    tools,
    toolsBySkill,
    agents: AGENT_PROFILES,
    clients,
    mcp,
    extensions,
    counts: {
      skills: publicSkills.length,
      sets: Object.keys(sets).length,
      tools: tools.length,
      agents: Object.keys(AGENT_PROFILES).length,
      clients: clients.length,
      clientsInstalled: clients.filter((c) => c.installed).length,
      mcpRegistered: mcp.filter((m) => m.registered).length,
      extensions: extensions.reduce((n, e) => n + e.injections, 0),
    },
    docs,
    srcTree,
    wikiDir: join(reg, "wikis"),
    registry: reg,
  };
}
