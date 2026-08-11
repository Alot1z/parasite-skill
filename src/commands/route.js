import { SETS, loadRegistry, registryDir, scoreIdea } from "../engine.js";

export function cmdRoute(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const { scored, setScores } = scoreIdea(payload, args.idea);
  const top = scored.slice(0, Number.isFinite(args.top) && args.top > 0 ? args.top : 8);
  if (args.json) {
    console.log(JSON.stringify({ idea: args.idea, scores: top, sets: setScores }, null, 2));
    return 0;
  }
  console.log(`idea: ${JSON.stringify(args.idea)}`);
  console.log("top skills:");
  for (const [name, score] of top) console.log(`  ${String(score).padStart(6)}  ${name}`);
  console.log("best skill-sets:");
  for (const [name, score] of setScores.slice(0, 3)) console.log(`  ${String(score).padStart(6)}  ${name}`);
  if (args.set && setScores[0]) {
    const set = setScores[0][0];
    const installed = new Set(payload.skills.map((s) => s.name));
    console.log(`\nload order for '${set}':`);
    SETS[set].members.forEach((m, i) => console.log(`  ${i + 1}. ${m}${installed.has(m) ? "" : "  (not installed)"}`));
  }
  return 0;
}
