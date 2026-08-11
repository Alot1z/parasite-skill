import { SETS, loadRegistry, registryDir } from "../engine.js";

export function cmdSets(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const installed = new Set(payload.skills.map((s) => s.name));
  if (args.apply) {
    const set = SETS[args.apply];
    if (!set) {
      console.error(`unknown set '${args.apply}'. available: ${Object.keys(SETS).join(", ")}`);
      return 1;
    }
    console.log(`set '${args.apply}': ${set.desc}`);
    set.members.forEach((m, i) => console.log(`  ${i + 1}. ${m}${installed.has(m) ? "" : "  (not installed)"}`));
    console.log("\nalways-on prepend: tractatus-thinking, sequential-thinking");
    console.log("always-on append: verification-before-completion, code-review-and-quality");
    return 0;
  }
  for (const [name, set] of Object.entries(SETS)) {
    const present = set.members.filter((m) => installed.has(m)).length;
    console.log(`${name.padEnd(14)} ${set.desc.padEnd(32)} ${present}/${set.members.length} installed`);
  }
  return 0;
}
