// Ecosystem export — "know everything installed without rescanning."
// Writes a human-ready ECOSYSTEM.md + an LLM-ready ecosystem.json covering:
// skills, skill-sets, clients (installed instances), parasite extensions,
// MCP registrations, and global/per-client rule files.
//
// Privacy: only names and paths are emitted. Never file contents, never
// secrets, never anything user-specific beyond a path.
import { existsSync, mkdirSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VERSION, loadProjectConfig, loadRegistry, loadSetsWithProject, registryDir } from "../engine.js";
import { CLIENTS, SKILL_NAME } from "../clients.js";
import { getInjectionStatus } from "../parasite/index.js";
import { mcpRegistrationStatus } from "../mcp-register.js";
import { AGENT_PROFILES } from "../data/agent-profiles.js";
import { buildEcosystemGraph } from "../ecosystem-graph.js";
import { auditSkillTools, listSkillTools } from "../ai-tools.js";
import { fmt } from "./_lib.js";

// Rule/config files checked for existence only (no contents).
const GLOBAL_RULES = [
  "AGENTS.md",
  "CLAUDE.md",
  join(".claude", "CLAUDE.md"),
  join(".claude", "settings.json"),
  join(".cursor", "rules"),
  join(".codex", "config.toml"),
  join(".gemini", "settings.json"),
  join(".codeium", "windsurf", "rules"),
  join(".continue", "config.json"),
  join(".copilot", "settings.json"),
];

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function listDirMd(p) {
  try {
    return readdirSync(p)
      .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
      .map((f) => join(p, f).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

export function cmdExport(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  const sets = loadSetsWithProject(reg, args.sets);
  const home = homedir();

  // ---- clients inventory ---------------------------------------------------
  const clients = [];
  for (const c of CLIENTS) {
    const dest = join(c.user, SKILL_NAME);
    const installed = existsSync(dest);
    clients.push({
      id: c.id,
      label: c.label,
      installed,
      mode: installed ? (isLink(dest) ? "link" : "copy") : null,
      path: dest.replace(/\\/g, "/"),
    });
  }
  const installedCount = clients.filter((c) => c.installed).length;

  // ---- parasite extensions -------------------------------------------------
  const extensions = getInjectionStatus().map((e) => ({
    client: e.client,
    label: e.label,
    injections: e.injections,
    active: e.active,
    path: String(e.path || "").replace(/\\/g, "/"),
  }));

  // ---- MCP registrations ---------------------------------------------------
  const mcp = mcpRegistrationStatus();

  // ---- rules (existence only) ----------------------------------------------
  const globalRules = [];
  for (const rel of GLOBAL_RULES) {
    const p = join(home, rel);
    if (existsSync(p)) {
      globalRules.push(...(rel.endsWith("rules") ? listDirMd(p) : [p.replace(/\\/g, "/")]));
    }
  }
  const perClientRules = [];
  for (const c of CLIENTS) {
    const dest = join(c.user, SKILL_NAME);
    if (!existsSync(dest)) continue;
    perClientRules.push(dest.replace(/\\/g, "/"));
  }

  // ---- project config ------------------------------------------------------
  const project = loadProjectConfig();
  const projectInfo = project
    ? {
        path: project._path.replace(/\\/g, "/"),
        sets: Object.keys(project.sets ?? {}),
        enabledSets: Array.isArray(project.enabledSets) ? project.enabledSets : [],
        excludeSkills: Array.isArray(project.excludeSkills) ? project.excludeSkills : [],
        parasite:
          project.parasite === false
            ? { enabled: false }
            : project.parasite === true
              ? { enabled: true }
              : project.parasite && typeof project.parasite === "object"
                ? project.parasite
                : null,
        envKeys: project.env && typeof project.env === "object" ? Object.keys(project.env) : [],
        clients: Array.isArray(project.clients) ? project.clients : [],
        tools:
          project.tools && typeof project.tools === "object" && !Array.isArray(project.tools)
            ? {
                allow: Array.isArray(project.tools.allow) ? project.tools.allow : [],
                deny: Array.isArray(project.tools.deny) ? project.tools.deny : [],
                envKeys: Array.isArray(project.tools.env) ? project.tools.env : [],
                timeoutMs: typeof project.tools.timeoutMs === "number" ? project.tools.timeoutMs : null,
                scopedKeys: project.tools.scoped && typeof project.tools.scoped === "object" ? Object.keys(project.tools.scoped) : [],
              }
            : null,
      }
    : null;

  // ---- callable AI-tools inventory (names/risk only, no contents) ----------
  const tools = listSkillTools(payload);
  const riskByName = new Map(auditSkillTools(payload).map((entry) => [entry.name, entry.risk]));
  const toolInventory = tools.map((tool) => ({
    name: tool.name,
    skill: tool.skill,
    language: tool.language,
    risk: riskByName.get(tool.name) ?? "low",
    declared_timeout_ms: tool.timeoutMs ?? null,
    args_schema: !!tool.argsSchema,
  }));

  // ---- LLM-ready JSON ------------------------------------------------------
  const llm = {
    kind: "parasite-skill-ecosystem",
    version: VERSION,
    generated_at: payload.generated_at ?? new Date().toISOString(),
    counts: {
      skills: skills.length,
      sets: Object.keys(sets).length,
      clients_installed: installedCount,
      extensions: extensions.reduce((n, e) => n + e.injections, 0),
      mcp_registered: mcp.filter((m) => m.registered).length,
      rule_files: globalRules.length,
      callable_tools: toolInventory.length,
    },
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      tags: s.tags,
      languages: s.languages,
      spec_ok: s.spec_ok,
      path: String(s.path || "").replace(/\\/g, "/"),
      sets: Object.entries(sets).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n),
    })),
    sets: Object.fromEntries(
      Object.entries(sets).map(([name, set]) => [name, { desc: set.desc, members: set.members, project: !!set.project }]),
    ),
    clients,
    extensions,
    mcp,
    rules: { global: globalRules, per_client: perClientRules },
    agents: AGENT_PROFILES,
    tools: toolInventory,
    graph: buildEcosystemGraph({
      skills,
      sets,
      clients,
      extensions,
      mcp,
      rules: { global: globalRules, per_client: perClientRules },
      profiles: AGENT_PROFILES,
      tools: listSkillTools(payload),
    }),
    project_config: projectInfo,
    note: "Paths and names only — no file contents or secrets. Regenerate with: parasite-skill export",
  };
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, "ecosystem.json"), JSON.stringify(llm, null, 2));

  // ---- human-ready ECOSYSTEM.md --------------------------------------------
  const md = [];
  md.push("# Parasite Skill Ecosystem — full inventory", "");
  md.push(`Generated ${llm.generated_at} by parasite-skill v${VERSION}.`, "");
  md.push(
    `**${skills.length} skills · ${Object.keys(sets).length} skill-sets · ${installedCount} client installs · ` +
      `${llm.counts.extensions} runtime extensions · ${llm.counts.mcp_registered} MCP registrations · ${globalRules.length} rule files.**`,
    "",
  );
  md.push("Paths and names only — no contents, no secrets. Regenerate anytime: `parasite-skill export`", "");

  md.push("## Skills", "", `| Skill | Tags | Languages | Spec | Sets |`, `|---|---|---|---|---|`);
  for (const s of skills) {
    const memberSets = Object.entries(sets).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n);
    md.push(`| ${s.name} | ${s.tags.join(", ") || "-"} | ${s.languages.join(", ") || "-"} | ${s.spec_ok ? "ok" : "ISSUE"} | ${memberSets.join(", ") || "-"} |`);
  }
  md.push("");

  md.push("## Callable AI-Tools", "", `| Tool | Skill | Language | Risk | Schema |`, `|---|---|---|---|---|`);
  for (const tool of toolInventory) {
    md.push(`| \`${tool.name}\` | ${tool.skill} | ${tool.language} | ${tool.risk} | ${tool.args_schema ? "yes" : "-"} |`);
  }
  if (!toolInventory.length) md.push("_No callable tools discovered._", "");
  else md.push("");

  md.push("## Skill-Sets", "");
  for (const [name, set] of Object.entries(sets)) {
    const projectMark = set.project ? " *(project)*" : "";
    md.push(`### ${name}${projectMark} — ${set.desc}`, set.members.join(", "), "");
  }

  md.push("## Clients", "", `| Client | Installed | Mode | Path |`, `|---|---|---|---|`);
  for (const c of clients) {
    md.push(`| ${c.label} | ${c.installed ? "yes" : "-"} | ${c.mode ?? "-"} | ${c.path} |`);
  }
  md.push("");

  md.push("## Runtime Extensions (parasite)", "");
  const activeExts = extensions.filter((e) => e.injections > 0);
  if (activeExts.length === 0) {
    md.push("None registered.", "");
  } else {
    md.push(`| Client | Injections | Active | Path |`, `|---|---|---|---|`);
    for (const e of activeExts) md.push(`| ${e.label} | ${e.injections} | ${e.active} | ${e.path} |`);
    md.push("");
  }

  md.push("## Agent Profiles", "", ...Object.entries(AGENT_PROFILES).map(([name, profile]) => `- **${name}** — ${profile.desc}`), "");

  md.push("## MCP Registrations", "", `| Target | Registered | File |`, `|---|---|---|`);
  for (const m of mcp) md.push(`| ${m.label} | ${m.registered ? "yes" : "-"} | ${m.file} |`);
  md.push("");

  md.push("## Rules & Configs (existence only)", "");
  if (globalRules.length) md.push("### Global", "", ...globalRules.map((p) => `- ${p}`), "");
  if (perClientRules.length) md.push("### Per-client skill installs", "", ...perClientRules.map((p) => `- ${p}`), "");
  if (projectInfo) {
    md.push("### Project config", `- ${projectInfo.path}`, "");
    md.push(`  - sets: ${projectInfo.sets.join(", ") || "none"}`);
    if (projectInfo.enabledSets.length) md.push(`  - enabledSets: ${projectInfo.enabledSets.join(", ")}`);
    if (projectInfo.excludeSkills.length) md.push(`  - excludeSkills: ${projectInfo.excludeSkills.join(", ")}`);
    if (projectInfo.parasite) {
      const p = projectInfo.parasite;
      let parasiteDesc = p.enabled === false ? "disabled" : "enabled";
      if (p.enabled !== false && Array.isArray(p.clients) && p.clients.length) {
        parasiteDesc += ` (clients: ${p.clients.join(", ")})`;
      }
      md.push(`  - parasite: ${parasiteDesc}`);
    }
    if (projectInfo.envKeys.length) md.push(`  - env: ${projectInfo.envKeys.join(", ")} (key names only)`);
    if (projectInfo.clients.length) md.push(`  - clients: ${projectInfo.clients.join(", ")}`);
    if (projectInfo.tools) {
      const t = projectInfo.tools;
      const parts = [`allow ${t.allow.join(",") || "none"}`, `deny ${t.deny.join(",") || "none"}`];
      if (t.envKeys.length) parts.push(`env ${t.envKeys.join(",")}`);
      if (t.timeoutMs) parts.push(`timeoutMs ${t.timeoutMs}`);
      if (t.scopedKeys.length) parts.push(`scoped ${t.scopedKeys.join(",")}`);
      md.push(`  - tools: ${parts.join(" · ")}`);
    }
    md.push("");
  }
  if (!globalRules.length && !perClientRules.length && !projectInfo) md.push("None found.", "");

  writeFileSync(join(reg, "ECOSYSTEM.md"), md.join("\n"));
  console.log(`ecosystem written: ${fmt(join(reg, "ECOSYSTEM.md"))}`);
  console.log(`llm-ready json:    ${fmt(join(reg, "ecosystem.json"))}`);
  console.log(`${skills.length} skills · ${Object.keys(sets).length} sets · ${installedCount} client installs · ${llm.counts.extensions} extensions`);
  return 0;
}
