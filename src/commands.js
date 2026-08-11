// skill-router commands: scan, validate, route, sets, refs, wikis, plan, trace, link.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETS,
  VERSION,
  expandDirs,
  loadRegistry,
  registryDir,
  scan,
  scoreIdea,
} from "./engine.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fmt(p) {
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------- scan

export function cmdScan(args) {
  const reg = registryDir(args.registry);
  const payload = scan(expandDirs(args.dirs));
  writeFileSync(join(reg, "registry.json"), JSON.stringify(payload, null, 2));
  const langs = [...new Set(payload.skills.flatMap((s) => s.languages))].sort();
  const invalid = payload.skills.filter((s) => !s.spec_ok).map((s) => s.name);
  if (args.json) {
    console.log(JSON.stringify({ total: payload.skills.length, languages: langs, issues: invalid }, null, 2));
    return 0;
  }
  console.log(`scanned ${payload.skills.length} skills from ${payload.scan_dirs.length} dirs`);
  console.log(`languages detected: ${langs.join(", ") || "none"}`);
  console.log(`spec issues: ${invalid.length} (${invalid.join(", ") || "none"})`);
  console.log(`registry: ${fmt(join(reg, "registry.json"))}`);
  return 0;
}

// ---------------------------------------------------------------- validate

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

// ---------------------------------------------------------------- route

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

// ---------------------------------------------------------------- sets

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

// ---------------------------------------------------------------- refs

export function cmdRefs(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const refsRoot = join(reg, "refs");
  mkdirSync(refsRoot, { recursive: true });
  const template = readFileSync(join(PKG_ROOT, "skill", "templates", "ref-skill.md"), "utf-8");
  const index = ["# Skill Refs Index", ""];
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
      .replaceAll("{{references_list}}", refs.map((x) => `- ${x}`).join("\n") || "- none");
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

// ---------------------------------------------------------------- wikis

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
  const pairs = [
    ["Correct implementation", ["source-driven-development", "incremental-implementation", "test-driven-development"]],
    ["Working UI", ["frontend-ui-engineering", "browser-testing-with-devtools", "webapp-testing"]],
    ["Safe launch", ["security-and-hardening", "ci-cd-and-automation", "observability-and-instrumentation", "shipping-and-launch"]],
    ["Right thing built", ["interview-me", "brainstorming", "spec-driven-development"]],
    ["Maintainable codebase", ["code-review-and-quality", "code-simplification", "documentation-and-adrs", "knip"]],
  ];
  for (const [outcome, members] of pairs) {
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

  const tpl = readFileSync(join(PKG_ROOT, "skill", "templates", "wiki-skill.md"), "utf-8");
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
      "# Skill Router Wiki",
      "",
      `${skills.length} skills indexed. ${Object.keys(SETS).length} skill-sets.`,
      `Generated ${payload.generated_at} by skill-router v${payload.version}.`,
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

// ---------------------------------------------------------------- plan

export function cmdPlan(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const { scored, setScores } = scoreIdea(payload, args.request);
  const top = scored.slice(0, 5);
  const best = setScores[0]?.[0] ?? "thinking";
  const slug = (args.request.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "")) || "request";
  const plan = [
    `# Execution Plan: ${args.request}`,
    "",
    `Routed by skill-router v${VERSION} — deterministic scores are hypotheses; the agent layer re-verifies.`,
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
    ...SETS[best].members.map((m) => `- load: ${m}`),
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

// ---------------------------------------------------------------- trace

export function cmdTrace(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  if (!args.file || !existsSync(args.file)) {
    console.error("provide a transcript file path");
    return 1;
  }
  const text = readFileSync(args.file, "utf-8");
  const alwaysOn = new Set(["tractatus-thinking", "sequential-thinking", "doubt-driven-development", "debug-thinking", "stop-slop", "verification-before-completion"]);
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const counts = [];
  for (const s of payload.skills) {
    const c = (text.match(new RegExp(esc(s.name), "gi")) ?? []).length;
    if (c > 0) counts.push([s.name, c]);
  }
  counts.sort((a, b) => b[1] - a[1]);
  console.log(`skills mentioned in transcript: ${counts.length}`);
  for (const [name, c] of counts) {
    console.log(`  ${String(c).padStart(4)}  ${name}${alwaysOn.has(name) ? "  [always-on]" : ""}`);
  }
  return 0;
}

// ---------------------------------------------------------------- link

function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function cmdLink(args) {
  const reg = registryDir(args.registry);
  const dirs = args.no_default
    ? (args.dirs ?? "").split(",").map((p) => p.trim()).filter(Boolean)
    : expandDirs(args.dirs);
  if (!dirs.length) {
    console.error("no dirs given: use --dirs <path> (optionally with --no-default)");
    return 1;
  }
  const rows = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || !e.isDirectory()) continue;
      const skillPath = join(d, e.name);
      if (!existsSync(join(skillPath, "SKILL.md"))) continue;
      const manifest = join(skillPath, ".skill-router.links.json");
      const name = e.name;
      if (args.unlink) {
        const errors = [];
        for (const link of ["refs", "wiki"]) {
          const lp = join(skillPath, link);
          if (isLink(lp)) {
            rmSync(lp, { recursive: true, force: true });
          } else if (existsSync(lp)) {
            try {
              rmSync(lp, { recursive: false, force: true });
            } catch {
              errors.push(`could not remove ${link}`);
            }
          }
        }
        if (errors.length) {
          rows.push(`${name}: ${errors.join("; ")} (left in place, no data removed)`);
        } else {
          if (existsSync(manifest)) rmSync(manifest);
          rows.push(`unlinked ${name}`);
        }
      } else {
        const messages = [];
        const refsTarget = join(reg, "refs", name);
        const wikiTarget = join(reg, "wikis", "skills", name);
        mkdirSync(refsTarget, { recursive: true });
        mkdirSync(wikiTarget, { recursive: true });
        for (const [linkName, target] of [["refs", refsTarget], ["wiki", wikiTarget]]) {
          const lp = join(skillPath, linkName);
          if (existsSync(lp) || isLink(lp)) {
            messages.push(`${linkName}:skipped-exists`);
            continue;
          }
          try {
            symlinkSync(target, lp, process.platform === "win32" ? "junction" : "dir");
            messages.push(`${linkName}:link`);
          } catch {
            messages.push(`${linkName}:manifest-only`);
          }
        }
        writeFileSync(
          manifest,
          JSON.stringify(
            {
              skill: name,
              registry: fmt(reg),
              refs: fmt(join(refsTarget, "index.md")),
              wiki: fmt(join(wikiTarget, "index.md")),
              links: messages,
              created_at: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        rows.push(`${name}: ${messages.join(", ")}`);
      }
    }
  }
  console.log(rows.join("\n"));
  console.log(`${args.unlink ? "unlinked" : "linked"} ${rows.length} skills`);
  return 0;
}
