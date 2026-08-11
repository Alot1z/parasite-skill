import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composePayload, loadRegistry, loadSetsWithProject, registryDir } from "../engine.js";
import { auditSkillTools } from "../ai-tools.js";
import { fmt } from "./_lib.js";

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-|-$/g, "") || "request";
}

export function cmdCompose(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const idea = args.idea ?? args.request;
  if (!idea) {
    console.error('missing request text: parasite-skill compose "<request>"');
    return 1;
  }
  const sets = loadSetsWithProject(reg, args.sets);
  // Each selected skill's callable tools carry their static-audit risk so the
  // payload shows posture; the engine joins it via the toolsRisk option.
  const toolsRisk = Object.fromEntries(auditSkillTools(payload).map((entry) => [entry.name, entry.risk]));
  const runtime = composePayload(payload, idea, {
    sets,
    top: args.top,
    maxChars: args.maxChars,
    excludeSkills: args.excludeSkills,
    enabledSets: args.enabledSets,
    auto: args.auto === true,
    toolsRisk,
  });
  const outDir = join(reg, "payload");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${slugify(idea)}.json`);
  writeFileSync(out, JSON.stringify(runtime, null, 2) + "\n", "utf-8");

  if (args.json) {
    console.log(JSON.stringify({ ...runtime, saved: `payload/${slugify(idea)}.json` }, null, 2));
    return 0;
  }
  console.log(`request: ${JSON.stringify(runtime.request)}`);
  console.log(`modes: ${runtime.decision.modes.join(", ")}`);
  console.log(`selected set: ${runtime.decision.selectedSkillSet}`);
  if (runtime.decision.auto) console.log("mode: auto-max — always-on cadence pinned around the routed skills");
  console.log("selected skills:");
  for (const skill of runtime.selectedSkills) {
    const excerpt = skill.excerpts.length ? `, ${skill.excerpts.length} excerpt${skill.excerpts.length === 1 ? "" : "s"}` : "";
    const tools = skill.tools.length ? `, ${skill.tools.length} callable tool${skill.tools.length === 1 ? "" : "s"}` : "";
    console.log(`  ${skill.name} (${skill.score}) — ${skill.assets.length} assets${excerpt}${tools}`);
  }
  const totalTools = runtime.selectedSkills.reduce((n, skill) => n + skill.tools.length, 0);
  if (totalTools) console.log(`callable tools: ${totalTools} (execute with tools run <name>; policy-filtered)`);
  console.log(`payload: ${fmt(out)}`);
  console.log(`chat budget: ${runtime.loading.excerptChars}/${runtime.loading.maxExcerptChars} excerpt chars; full content on demand`);
  return 0;
}
