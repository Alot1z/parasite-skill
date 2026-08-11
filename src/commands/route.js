import { loadRegistry, loadSetsWithProject, registryDir, scoreIdea } from "../engine.js";

export function cmdRoute(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.idea) {
    console.error('missing idea text: parasite-skill route "<idea>" [--set <name>]');
    return 1;
  }
  const allSets = loadSetsWithProject(reg, args.sets);
  let { scored, setScores } = scoreIdea(payload, args.idea, allSets);

  // Project-level routing controls from parasite-skill.json (merged into args):
  //  - excludeSkills: never route to these skills
  //  - enabledSets:   only route within the members of these sets
  //  - route.minScore: drop scores below the floor
  //  - route.top:     default top-N when --top is not given
  const exclude = new Set(Array.isArray(args.excludeSkills) ? args.excludeSkills : []);
  if (exclude.size) scored = scored.filter(([name]) => !exclude.has(name));

  if (Array.isArray(args.enabledSets) && args.enabledSets.length) {
    const allowed = new Set();
    for (const sn of args.enabledSets) {
      const members = allSets[sn]?.members;
      if (Array.isArray(members)) for (const m of members) allowed.add(m);
      else console.error(`unknown skill-set in enabledSets: ${sn}`);
    }
    scored = scored.filter(([name]) => allowed.has(name));
    setScores = setScores.filter(([sn]) => args.enabledSets.includes(sn));
  }

  const minScore = typeof args.route?.minScore === "number" ? args.route.minScore : 0;
  if (minScore > 0) scored = scored.filter(([, s]) => s >= minScore);

  const topN =
    Number.isFinite(args.top) && args.top > 0
      ? args.top
      : typeof args.route?.top === "number" && args.route.top > 0
        ? args.route.top
        : 8;
  const top = scored.slice(0, topN);
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
      console.log(JSON.stringify({ idea: args.idea, set: args.set, scores: within, filters: { excludeSkills: [...exclude], enabledSets: args.enabledSets ?? [], minScore } }, null, 2));
      return 0;
    }
    console.log(`idea: ${JSON.stringify(args.idea)}`);
    console.log(`top skills within set '${args.set}':`);
    for (const [name, score] of within) console.log(`  ${String(score).padStart(6)}  ${name}`);
    return 0;
  }
  if (args.json) {
    console.log(JSON.stringify({ idea: args.idea, scores: top, sets: setScores, filters: { excludeSkills: [...exclude], enabledSets: args.enabledSets ?? [], minScore } }, null, 2));
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
