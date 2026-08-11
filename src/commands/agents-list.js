// agents list | agents show <profile>: inventory the declarative agent profiles
// without running anything. Shows the profile recipe: description, skills, sets,
// assets, MCP tools, and guardrails.
import { AGENT_PROFILES } from "../data/agent-profiles.js";

export function cmdAgentsList(args = {}) {
  const raw = Array.isArray(args._) ? args._ : [];
  const profile = args.profile ?? raw[2];

  if (profile) {
    const def = AGENT_PROFILES[profile];
    if (!def) {
      console.error(`unknown agent profile: ${profile}. available: ${Object.keys(AGENT_PROFILES).join(", ")}`);
      return 1;
    }
    console.log(`agent profile: ${profile}`);
    console.log(`  description: ${def.desc}`);
    console.log(`  skills:  ${(def.skills ?? []).join(", ") || "none"}`);
    console.log(`  sets:    ${(def.sets ?? []).join(", ") || "none"}`);
    console.log(`  assets:  ${(def.assets ?? []).join(", ") || "none"}`);
    console.log(`  mcp:     ${(def.mcpTools ?? []).join(", ") || "none"}`);
    console.log(`  guardrails:`);
    for (const rule of def.guardrails ?? []) console.log(`    - ${rule}`);
    console.log(`  run:     parasite-skill agents run ${profile} \"<request>\"`);
    return 0;
  }

  console.log(`agent profiles: ${Object.keys(AGENT_PROFILES).length}`);
  for (const [name, def] of Object.entries(AGENT_PROFILES)) {
    console.log(`  ${name}  — ${def.desc}`);
  }
  console.log('run: parasite-skill agents run <profile> "<request>" | agents list | agents show <profile>');
  return 0;
}
