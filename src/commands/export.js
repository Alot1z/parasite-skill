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
    ? { path: project._path.replace(/\\/g, "/"), sets: Object.keys(project.sets ?? {}) }
    : null;

  // ---- LLM-ready JSON ------------------------------------------------------
  const llm = {
    kind: "skill-router-ecosystem",
    version: VERSION,
    generated_at: payload.generated_at ?? new Date().toISOString(),
    counts: {
      skills: skills.length,
      sets: Object.keys(sets).length,
      clients_installed: installedCount,
      extensions: extensions.reduce((n, e) => n + e.injections, 0),
      mcp_registered: mcp.filter((m) => m.registered).length,
      rule_files: globalRules.length,
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
    project_config: projectInfo,
    note: "Paths and names only — no file contents or secrets. Regenerate with: skill-router export",
  };
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, "ecosystem.json"), JSON.stringify(llm, null, 2));

  // ---- human-ready ECOSYSTEM.md --------------------------------------------
  const md = [];
  md.push("# Skill Router Ecosystem — full inventory", "");
  md.push(`Generated ${llm.generated_at} by skill-router v${VERSION}.`, "");
  md.push(
    `**${skills.length} skills · ${Object.keys(sets).length} skill-sets · ${installedCount} client installs · ` +
      `${llm.counts.extensions} runtime extensions · ${llm.counts.mcp_registered} MCP registrations · ${globalRules.length} rule files.**`,
    "",
  );
  md.push("Paths and names only — no contents, no secrets. Regenerate anytime: `skill-router export`", "");

  md.push("## Skills", "", `| Skill | Tags | Languages | Spec | Sets |`, `|---|---|---|---|---|`);
  for (const s of skills) {
    const memberSets = Object.entries(sets).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n);
    md.push(`| ${s.name} | ${s.tags.join(", ") || "-"} | ${s.languages.join(", ") || "-"} | ${s.spec_ok ? "ok" : "ISSUE"} | ${memberSets.join(", ") || "-"} |`);
  }
  md.push("");

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

  md.push("## MCP Registrations", "", `| Target | Registered | File |`, `|---|---|---|`);
  for (const m of mcp) md.push(`| ${m.label} | ${m.registered ? "yes" : "-"} | ${m.file} |`);
  md.push("");

  md.push("## Rules & Configs (existence only)", "");
  if (globalRules.length) md.push("### Global", "", ...globalRules.map((p) => `- ${p}`), "");
  if (perClientRules.length) md.push("### Per-client skill installs", "", ...perClientRules.map((p) => `- ${p}`), "");
  if (projectInfo) md.push("### Project config", `- ${projectInfo.path} — sets: ${projectInfo.sets.join(", ") || "none"}`, "");
  if (!globalRules.length && !perClientRules.length && !projectInfo) md.push("None found.", "");

  writeFileSync(join(reg, "ECOSYSTEM.md"), md.join("\n"));
  console.log(`ecosystem written: ${fmt(join(reg, "ECOSYSTEM.md"))}`);
  console.log(`llm-ready json:    ${fmt(join(reg, "ecosystem.json"))}`);
  console.log(`${skills.length} skills · ${Object.keys(sets).length} sets · ${installedCount} client installs · ${llm.counts.extensions} extensions`);
  return 0;
}
