import { loadRegistry, registryDir } from "../engine.js";

export function cmdValidate(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const bad = payload.skills.filter((s) => !s.spec_ok).map((s) => [s.name, s.issues]);
  if (args.json) {
    console.log(JSON.stringify({ total: payload.skills.length, issues: bad }, null, 2));
    return bad.length ? 1 : 0;
  }
  console.log(`${payload.skills.length} skills, ${bad.length} with spec issues`);
  for (const [name, issues] of bad) console.log(`  ! ${name}: ${issues.join("; ")}`);
  return bad.length ? 1 : 0;
}
