import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION, composePayload, loadRegistry, loadSetsWithProject, registryDir } from "../engine.js";
import { fmt } from "./_lib.js";

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-|-$/g, "") || "request";
}

export function cmdPlan(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.request) {
    console.error('missing request text: parasite-skill plan "<request>"');
    return 1;
  }
  const allSets = loadSetsWithProject(reg, args.sets);
  const runtime = composePayload(payload, args.request, {
    sets: allSets,
    top: args.top ?? 6,
    maxChars: args.maxChars,
    excludeSkills: args.excludeSkills,
    enabledSets: args.enabledSets,
  });
  const chatSafe = args.chatSafe === true;
  const slug = slugify(args.request);
  const outDir = join(reg, "plan");
  mkdirSync(outDir, { recursive: true });
  const payloadFile = join(outDir, `${slug}-payload.json`);
  const displayRequest = chatSafe ? runtime.request : args.request;
  const payloadLabel = chatSafe ? `plan/${slug}-payload.json` : fmt(payloadFile);
  writeFileSync(payloadFile, JSON.stringify(runtime, null, 2) + "\n", "utf-8");
  const selected = runtime.selectedSkills;
  const plan = [
    `# Execution Plan: ${displayRequest}`,
    "",
    `Routed by parasite-skill v${VERSION}; the runtime payload contains only selected skills and bounded excerpts.`,
    `Decision modes: ${runtime.decision.modes.join(", ")}`,
    `Selected set: ${runtime.decision.selectedSkillSet}`,
    "",
    "## Selected execution order",
    "",
    ...(selected.length
      ? selected.map((skill, index) => `${index + 1}. **${skill.name}** — ${skill.why.matched.join(", ") || "semantic/tag match"}; assets on demand: ${skill.assets.length}`)
      : ["No positive skill match. Use the request as the contract and ask for clarification before loading unrelated skills."]),
    "",
    "## Cadence",
    "",
    `- START: ${runtime.execution.cadence.start.join(" -> ")}`,
    `- BETWEEN: ${runtime.execution.cadence.between.join("; ")}`,
    `- AFTER: ${runtime.execution.cadence.after.join(" -> ")}`,
    "",
    "## Loading policy",
    "",
    "- Load only the selected excerpts and asset manifests in the runtime payload.",
    "- Load full SKILL.md, reference, template, script, hook, or tool contents only when the selected step requires them.",
    "- Do not put absolute paths, environment values, credentials, or unselected skill documents into chat.",
    "",
    `Payload: ${payloadLabel}`,
    `Excerpt budget: ${runtime.loading.excerptChars}/${runtime.loading.maxExcerptChars} characters`,
    "",
  ];
  const out = join(outDir, `${slug}-plan.md`);
  writeFileSync(out, plan.join("\n"), "utf-8");
  console.log(plan.join("\n"));
  if (chatSafe) {
    console.log(`plan saved: plan/${slug}.md`);
    console.log(`payload saved: plan/${slug}-payload.json`);
  } else {
    console.log(`plan saved: ${fmt(out)}`);
    console.log(`payload saved: ${fmt(payloadFile)}`);
  }
  return 0;
}
