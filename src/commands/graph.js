import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadRegistry, registryDir, loadSetsWithProject } from "../engine.js";
import { CLIENTS, SKILL_NAME } from "../clients.js";
import { getInjectionStatus } from "../parasite/index.js";
import { mcpRegistrationStatus } from "../mcp-register.js";
import { AGENT_PROFILES } from "../data/agent-profiles.js";
import { buildEcosystemGraph, ecosystemToDot, ecosystemToMermaid, publicGraph } from "../ecosystem-graph.js";
import { listSkillTools } from "../ai-tools.js";
import { smallLogo } from "../logo.js";

function similarity(a, b) {
  const sa = new Set(a.keywords);
  const sb = new Set(b.keywords);
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function legacyGraph(skills, args) {
  const threshold = Number(args.threshold ?? 0.15);
  const top = Number(args.top ?? 10);
  const edges = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const w = similarity(skills[i], skills[j]);
      if (w >= threshold) edges.push([skills[i].name, skills[j].name, w]);
    }
  }
  edges.sort((a, b) => b[2] - a[2]);
  const kept = edges.slice(0, top);
  if (args.mmd) {
    console.log("flowchart LR");
    for (const [a, b, w] of kept) console.log(`  ${a} ---|${(w * 100).toFixed(0)}%| ${b}`);
  } else {
    console.log("digraph skills {");
    console.log("  rankdir=LR;");
    console.log('  node [shape=box, style="rounded,filled", fillcolor="#eef4ff"];');
    for (const s of skills) console.log(`  "${s.name}";`);
    for (const [a, b, w] of kept) {
      console.log(`  "${a}" -> "${b}" [label="${(w * 100).toFixed(0)}%", penwidth="${(w * 3).toFixed(1)}"];`);
    }
    console.log("}");
  }
  console.error(`${smallLogo()} ${skills.length} skill nodes, ${kept.length}/${edges.length} relatedness edges (threshold ${threshold}, top ${top})`);
}

function safeRules() {
  // The graph records known rule paths only. It does not read rule contents.
  const known = [
    "AGENTS.md", "CLAUDE.md", join(".claude", "CLAUDE.md"), join(".claude", "settings.json"),
    join(".cursor", "rules"), join(".codex", "config.toml"), join(".gemini", "settings.json"),
    join(".codeium", "windsurf", "rules"), join(".continue", "config.json"), join(".copilot", "settings.json"),
  ];
  return {
    global: known.map((path) => join(homedir(), path)).filter(existsSync),
    per_client: [],
  };
}

/**
 * graph [--ecosystem] [--json | --dot | --mmd] [--top N] [--threshold X]
 *
 * Legacy mode remains a skill vocabulary graph. Ecosystem mode adds typed
 * relationships for skills, sets, assets, clients, extensions, MCP targets,
 * rules, agent profiles, and tools.
 */
export function cmdGraph(args = {}) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  if (!skills.length) {
    console.error("no skills indexed — run scan first");
    return 1;
  }
  if (!args.ecosystem) {
    legacyGraph(skills, args);
    return 0;
  }

  const sets = loadSetsWithProject(reg, args.sets);
  const clients = CLIENTS.map((client) => ({
    id: client.id,
    label: client.label,
    installed: existsSync(join(client.user, SKILL_NAME)),
    path: client.user,
  }));
  const extensions = getInjectionStatus().map((entry) => ({
    client: entry.client,
    label: entry.label,
    injections: entry.injections,
    active: entry.active,
    path: entry.path,
  }));
  const mcp = mcpRegistrationStatus();
  const graph = buildEcosystemGraph({ skills, sets, clients, extensions, mcp, rules: safeRules(), profiles: AGENT_PROFILES, tools: listSkillTools(payload) });
  const outputGraph = args.public ? publicGraph(graph) : graph;

  if (args.json) console.log(JSON.stringify(outputGraph, null, 2));
  else if (args.mmd) console.log(ecosystemToMermaid(outputGraph));
  else console.log(ecosystemToDot(outputGraph));
  console.error(`${smallLogo()} ecosystem graph: ${outputGraph.nodes.length} nodes, ${outputGraph.edges.length} edges${args.public ? " (public metadata)" : ""}`);
  return 0;
}
