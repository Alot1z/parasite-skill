import { loadRegistry, loadSets, registryDir, scoreIdea } from "../engine.js";

export function cmdRoute(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.idea) {
    console.error('missing idea text: skill-router route "<idea>" [--set <name>]');
    return 1;
  }
  const allSets = loadSets(reg);
  const { scored, setScores } = scoreIdea(payload, args.idea, allSets);
  const top = scored.slice(0, Number.isFinite(args.top) && args.top > 0 ? args.top : 8);
  // --set <name>: constrain routing to one skill-set (values, not the boolean).
  if (typeof args.set === "string") {
    const members = allSets[args.set]?.members;
    if (!members) {
      console.error(`unknown skill-set: ${args.set}`);
      return 1;
    }
    const inSet = new Set(members);
    const within = scored.filter(([name]) => inSet.has(name)).slice(0, top.length);
    if (args.json) {
      console.log(JSON.stringify({ idea: args.idea, set: args.set, scores: within }, null, 2));
      return 0;
    }
    console.log(`idea: ${JSON.stringify(args.idea)}`);
    console.log(`top skills within set '${args.set}':`);
    for (const [name, score] of within) console.log(`  ${String(score).padStart(6)}  ${name}`);
    return 0;
  }
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
    (allSets[set]?.members ?? []).forEach((m, i) => console.log(`  ${i + 1}. ${m}${installed.has(m) ? "" : "  (not installed)"}`));
  }
  return 0;
}
