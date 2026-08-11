import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETS, loadRegistry, registryDir } from "../engine.js";
import { MULTIPLICATIVE_PAIRS } from "../data/sets.js";
import { fmt, readTemplate } from "./_lib.js";

export function cmdWikis(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  const wiki = join(reg, "wikis");
  mkdirSync(wiki, { recursive: true });
  const byTag = {};
  for (const s of skills) for (const t of s.tags) (byTag[t] ??= []).push(s.name);

  const skillsMd = ["# All Skills", "", `${skills.length} registered`, "", "| Skill | Tags | Languages | Spec |", "|---|---|---|---|"];
  for (const s of skills) {
    skillsMd.push(`| [${s.name}](skills/${s.name}/index.md) | ${s.tags.join(", ")} | ${s.languages.join(", ") || "-"} | ${s.spec_ok ? "ok" : "ISSUE"} |`);
  }
  writeFileSync(join(wiki, "Skills.md"), skillsMd.join("\n"));

  const cats = ["# Categories", ""];
  for (const tag of Object.keys(byTag).sort()) {
    cats.push(`## ${tag}`, byTag[tag].join(", "), "");
  }
  writeFileSync(join(wiki, "Categories.md"), cats.join("\n"));

  const setsMd = ["# Skill-Sets", ""];
  for (const [name, set] of Object.entries(SETS)) {
    setsMd.push(`## ${name} — ${set.desc}`, set.members.join(", "), "");
  }
  writeFileSync(join(wiki, "SkillSets.md"), setsMd.join("\n"));

  const mult = ["# Multiplicative Pairs (A x B x C)", "", "An outcome is a product: if any factor fails, the outcome fails.", ""];
  for (const [outcome, members] of MULTIPLICATIVE_PAIRS) {
    mult.push(`## ${outcome}`, ...members.map((m) => `- ${m}`), "");
  }
  writeFileSync(join(wiki, "MultiplicativePairs.md"), mult.join("\n"));

  const dot = ["digraph skills {", "  rankdir=LR;", "  node [shape=box, style=rounded];"];
  for (const s of skills) dot.push(`  "${s.name}" [label="${s.name}"];`);
  for (const [name, set] of Object.entries(SETS)) {
    dot.push(`  subgraph cluster_${name} { label="${name}";`);
    for (const m of set.members) if (skills.some((x) => x.name === m)) dot.push(`    "${m}";`);
    dot.push("  }");
  }
  dot.push("}");
  writeFileSync(join(wiki, "graph.dot"), dot.join("\n"));

  const mmd = ["graph LR"];
  for (const [name, set] of Object.entries(SETS)) {
    mmd.push(`  subgraph ${name}`);
    for (const m of set.members) if (skills.some((x) => x.name === m)) mmd.push(`    ${m.replaceAll("-", "_")}[${m}]`);
    mmd.push("  end");
  }
  writeFileSync(join(wiki, "graph.mmd"), mmd.join("\n"));

  const tpl = readTemplate("wiki-skill.md");
  const per = join(wiki, "skills");
  mkdirSync(per, { recursive: true });
  for (const s of skills) {
    const memberSets = Object.entries(SETS).filter(([, set]) => set.members.includes(s.name)).map(([n]) => n);
    const related = [...new Set(s.tags.flatMap((t) => byTag[t] ?? []).filter((t) => t !== s.name))].sort().slice(0, 12).join(", ") || "none";
    const page = tpl
      .replaceAll("{{name}}", s.name)
      .replaceAll("{{description}}", s.description)
      .replaceAll("{{tags}}", s.tags.join(", "))
      .replaceAll("{{languages}}", s.languages.join(", ") || "none")
      .replaceAll("{{sets}}", memberSets.join(", ") || "none")
      .replaceAll("{{related}}", related);
    const d = join(per, s.name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.md"), page);
  }

  writeFileSync(
    join(wiki, "Home.md"),
    [
      "# Parasite Skill Wiki",
      "",
      `${skills.length} skills indexed. ${Object.keys(SETS).length} skill-sets.`,
      `Generated ${payload.generated_at} by parasite-skill v${payload.version}.`,
      "",
      "- [All skills](Skills.md)",
      "- [Categories](Categories.md)",
      "- [Skill-sets](SkillSets.md)",
      "- [Multiplicative pairs](MultiplicativePairs.md)",
      "- [Graph (DOT)](graph.dot)",
      "- [Graph (Mermaid)](graph.mmd)",
      "",
    ].join("\n"),
  );
  console.log(`wiki written: ${fmt(wiki)}`);
  return 0;
}
