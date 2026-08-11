import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadRegistry, registryDir, loadSetsWithProject } from "../engine.js";
import { CLIENTS } from "../clients.js";
import { getInjectionStatus } from "../parasite/index.js";
import { mcpRegistrationStatus } from "../mcp-register.js";
import { AGENT_PROFILES } from "../data/agent-profiles.js";
import { buildEcosystemGraph, ecosystemToDot, ecosystemToMermaid, publicGraph, sanitizePublicText } from "../ecosystem-graph.js";
import { MULTIPLICATIVE_PAIRS } from "../data/sets.js";
import { fmt, readTemplate } from "./_lib.js";

const RULE_PATHS = [
  "AGENTS.md", "CLAUDE.md", join(".claude", "CLAUDE.md"), join(".claude", "settings.json"),
  join(".cursor", "rules"), join(".codex", "config.toml"), join(".gemini", "settings.json"),
  join(".codeium", "windsurf", "rules"), join(".continue", "config.json"), join(".copilot", "settings.json"),
];

function rulesInventory() {
  const global = RULE_PATHS.map((path) => join(homedir(), path))
    .filter(existsSync)
    .map((path) => path.replace(/\\/g, "/"));
  return { global, per_client: [] };
}

// Conservative public text projection. Static profile text is trusted package
// data; scanned skill descriptions and set labels are not. Token redaction keeps
// this code portable across Windows and Unix without a fragile path regex.
function publicText(value) {
  return sanitizePublicText(value);
}

function publicProfile(profile) {
  return {
    ...profile,
    desc: publicText(profile.desc),
    guardrails: (profile.guardrails ?? []).map(publicText),
  };
}

export function cmdWikis(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  const sets = loadSetsWithProject(reg, args.sets);
  const wiki = join(reg, "wikis");
  mkdirSync(wiki, { recursive: true });
  const byTag = {};
  for (const s of skills) for (const t of s.tags) (byTag[t] ??= []).push(s.name);

  const skillsMd = ["# All Skills", "", `${skills.length} registered`, "", "| Skill | Tags | Languages | Spec |", "|---|---|---|---|"];
  for (const s of skills) skillsMd.push(`| [${s.name}](skills/${s.name}/index.md) | ${s.tags.join(", ")} | ${s.languages.join(", ") || "-"} | ${s.spec_ok ? "ok" : "ISSUE"} |`);
  writeFileSync(join(wiki, "Skills.md"), skillsMd.join("\n"));

  const cats = ["# Categories", ""];
  for (const tag of Object.keys(byTag).sort()) cats.push(`## ${tag}`, byTag[tag].join(", "), "");
  writeFileSync(join(wiki, "Categories.md"), cats.join("\n"));

  const setsMd = ["# Skill-Sets", ""];
  for (const [name, set] of Object.entries(sets)) {
    const desc = args.public ? publicText(set.desc) : set.desc;
    setsMd.push(`## ${name} — ${desc}`, set.members.join(", "), "");
  }
  writeFileSync(join(wiki, "SkillSets.md"), setsMd.join("\n"));

  const mult = ["# Multiplicative Pairs (A x B x C)", "", "An outcome is a product: if any factor fails, the outcome fails.", ""];
  for (const [outcome, members] of MULTIPLICATIVE_PAIRS) mult.push(`## ${outcome}`, ...members.map((m) => `- ${m}`), "");
  writeFileSync(join(wiki, "MultiplicativePairs.md"), mult.join("\n"));

  const graph = buildEcosystemGraph({
    skills,
    sets,
    clients: CLIENTS.map((client) => ({ id: client.id, label: client.label, installed: false, path: client.user })),
    extensions: getInjectionStatus(),
    mcp: mcpRegistrationStatus(),
    rules: rulesInventory(),
    profiles: AGENT_PROFILES,
  });
  const outputGraph = args.public ? publicGraph(graph) : graph;
  writeFileSync(join(wiki, "graph.json"), JSON.stringify(outputGraph, null, 2) + "\n");
  writeFileSync(join(wiki, "graph.dot"), ecosystemToDot(outputGraph));
  writeFileSync(join(wiki, "graph.mmd"), ecosystemToMermaid(outputGraph));

  const agentDir = join(wiki, "agents");
  mkdirSync(agentDir, { recursive: true });
  const agentsIndex = ["# Agent Profiles", "", "These are declarative routing recipes. They do not execute hidden code or bypass client permissions.", ""];
  for (const [name, rawProfile] of Object.entries(AGENT_PROFILES)) {
    const profile = args.public ? publicProfile(rawProfile) : rawProfile;
    agentsIndex.push(`- [${name}](agents/${name}.md) — ${profile.desc}`);
    const page = [
      `# ${name}`, "", profile.desc, "", "## Route through",
      `- Skills: ${(profile.skills ?? []).join(", ") || "none"}`,
      `- Sets: ${(profile.sets ?? []).join(", ") || "none"}`,
      `- Assets: ${(profile.assets ?? []).join(", ") || "none"}`,
      `- MCP tools: ${(profile.mcpTools ?? []).join(", ") || "none"}`,
      `- Clients: ${(profile.clients ?? []).join(", ") || "none"}`, "", "## Guardrails",
      ...(profile.guardrails ?? []).map((guardrail) => `- ${guardrail}`), "",
    ].join("\n");
    writeFileSync(join(agentDir, `${name}.md`), page);
  }
  writeFileSync(join(wiki, "Agents.md"), agentsIndex.join("\n") + "\n");

  const tpl = readTemplate("wiki-skill.md");
  const per = join(wiki, "skills");
  mkdirSync(per, { recursive: true });
  for (const s of skills) {
    const memberSets = Object.entries(sets).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n);
    const related = [...new Set(s.tags.flatMap((t) => byTag[t] ?? []).filter((t) => t !== s.name))].sort().slice(0, 12).join(", ") || "none";
    const description = args.public ? publicText(s.description) : s.description;
    const page = tpl.replaceAll("{{name}}", s.name).replaceAll("{{description}}", description).replaceAll("{{tags}}", s.tags.join(", ")).replaceAll("{{languages}}", s.languages.join(", ") || "none").replaceAll("{{sets}}", memberSets.join(", ") || "none").replaceAll("{{related}}", related);
    const d = join(per, s.name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.md"), page);
  }

  writeFileSync(join(wiki, "Home.md"), [
    "# Parasite Skill Wiki", "", `${skills.length} skills indexed. ${Object.keys(sets).length} skill-sets.`,
    `Generated ${payload.generated_at} by parasite-skill v${payload.version}.`, "",
    "- [All skills](Skills.md)", "- [Categories](Categories.md)", "- [Skill-sets](SkillSets.md)",
    "- [Agent profiles](Agents.md)", "- [Typed ecosystem graph](graph.json)", "- [Graph (DOT)](graph.dot)", "- [Graph (Mermaid)](graph.mmd)", "- [Multiplicative pairs](MultiplicativePairs.md)", "",
  ].join("\n"));
  console.log(`wiki written: ${fmt(wiki)}`);
  return 0;
}
