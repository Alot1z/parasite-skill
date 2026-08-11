import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, registryDir } from "../engine.js";
import { listSkillTools } from "../ai-tools.js";
import { fmt, readTemplate } from "./_lib.js";

export function cmdRefs(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const refsRoot = join(reg, "refs");
  mkdirSync(refsRoot, { recursive: true });
  const template = readTemplate("ref-skill.md");
  const index = ["# Skill Refs Index", ""];
  // Per-skill callable AI-tools (scripts/hooks/tools) are listed on each ref
  // page so the refs surface also inventories what can actually be executed.
  const toolsBySkill = new Map();
  for (const tool of listSkillTools(payload)) {
    const list = toolsBySkill.get(tool.skill) ?? [];
    list.push(tool);
    toolsBySkill.set(tool.skill, list);
  }
  for (const s of payload.skills) {
    const d = join(refsRoot, s.name);
    mkdirSync(d, { recursive: true });
    const scripts = s.dirs.scripts ?? [];
    const refs = s.dirs.references ?? [];
    const assets = s.dirs.assets ?? [];
    const page = template
      .replaceAll("{{name}}", s.name)
      .replaceAll("{{description}}", s.description)
      .replaceAll("{{path}}", s.path)
      .replaceAll("{{languages}}", s.languages.join(", ") || "none")
      .replaceAll("{{tags}}", s.tags.join(", ") || "none")
      .replaceAll("{{spec_ok}}", String(s.spec_ok))
      .replaceAll("{{scripts_count}}", String(scripts.length))
      .replaceAll("{{references_count}}", String(refs.length))
      .replaceAll("{{assets_count}}", String(assets.length))
      .replaceAll("{{scripts_list}}", scripts.map((x) => `- ${x}`).join("\n") || "- none")
      .replaceAll("{{references_list}}", refs.map((x) => `- ${x}`).join("\n") || "- none")
      .replaceAll(
        "{{tools_list}}",
        (toolsBySkill.get(s.name) ?? [])
          .map((tool) => `- \`${tool.name}\` (${tool.language}${tool.argsSchema ? ", schema" : ""}) — ${tool.description.slice(0, 100)}`)
          .join("\n") || "- none",
      );
    writeFileSync(join(d, "index.md"), page);
    index.push(`- [${s.name}](${s.name}/index.md) — ${s.description.slice(0, 90)}`);
    if (args.per_skill) {
      const dest = join(s.path, "refs");
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, "index.md"), page);
    }
  }
  writeFileSync(join(refsRoot, "index.md"), index.join("\n"));
  console.log(`refs written: ${fmt(refsRoot)} (${payload.skills.length} skills)${args.per_skill ? " + per-skill copies" : ""}`);
  return 0;
}
