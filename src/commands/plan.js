import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION, loadRegistry, loadSetsWithProject, registryDir, scoreIdea } from "../engine.js";
import { fmt } from "./_lib.js";

export function cmdPlan(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.request) {
    console.error('missing request text: parasite-skill plan "<request>"');
    return 1;
  }
  const allSets = loadSetsWithProject(reg, args.sets);
  const { scored, setScores } = scoreIdea(payload, args.request, allSets);
  const top = scored.slice(0, 5);
  const best = setScores[0]?.[0] ?? "thinking";
  const slug = (args.request.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "")) || "request";
  const plan = [
    `# Execution Plan: ${args.request}`,
    "",
    `Routed by parasite-skill v${VERSION} — deterministic scores are hypotheses; the agent layer re-verifies.`,
    "",
    "## Phases",
    "",
    "### START (before tool use)",
    "1. tractatus-thinking — decompose the request",
    "2. sequential-thinking — build a reasoning chain",
    "3. deepwiki / context7 / find-docs — verify domain facts",
    "",
    "### ROUTE (top skills)",
    "",
    ...top.map(([name, score]) => `- ${name} (score ${score})`),
    "",
    `### EXECUTE (skill-set: ${best})`,
    "",
    ...(allSets[best]?.members ?? []).map((m) => `- load: ${m}`),
    "",
    "### BETWEEN tool calls",
    "- doubt-driven-development before non-trivial decisions",
    "- debug-thinking / debugging-and-error-recovery on failure",
    "- context-engineering on drift; stop-slop before prose",
    "- re-invoke thinking skills (--force) rather than continuing stale",
    "",
    "### AFTER each milestone",
    "- verification-before-completion (evidence before claims)",
    "- code-review-and-quality",
    "- documentation-and-adrs if decisions were made",
    "",
  ];
  const outDir = join(reg, "plan");
  mkdirSync(outDir, { recursive: true });
  const f = join(outDir, `${slug}-plan.md`);
  writeFileSync(f, plan.join("\n"));
  console.log(plan.join("\n"));
  console.log(`\nplan saved: ${fmt(f)}`);
  return 0;
}
