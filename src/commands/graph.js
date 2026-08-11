import { loadRegistry, registryDir } from "../engine.js";
import { smallLogo } from "../logo.js";

// Skill-relatedness graph — inspired by the code-graph idea from the
// ix-infrastructure ecosystem (ix map/compass style: nodes = entities,
// edges = semantic proximity). This is a self-contained inspiration layer:
// no ix code is vendored, so upstream updates can never conflict.

function similarity(a, b) {
  // Jaccard on keyword sets (both keywords + name tokens).
  const sa = new Set(a.keywords);
  const sb = new Set(b.keywords);
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * graph [--top N] [--dot | --mmd] [--threshold 0.15]
 * Emits a relatedness graph: each skill is a node; edges connect skills that
 * share vocabulary. DOT (graphviz) and Mermaid are both supported.
 */
export function cmdGraph(args = {}) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const skills = payload.skills;
  if (!skills.length) {
    console.error("no skills indexed — run scan first");
    return 1;
  }
  const threshold = Number(args.threshold ?? 0.15);
  const top = Number(args.top ?? 10);

  // Build edges.
  const edges = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const w = similarity(skills[i], skills[j]);
      if (w >= threshold) edges.push([skills[i].name, skills[j].name, w]);
    }
  }
  edges.sort((a, b) => b[2] - a[2]);
  const kept = edges.slice(0, top);

  const fmt = args.dot ? "dot" : args.mmd ? "mmd" : "dot";
  if (fmt === "mmd") {
    console.log("flowchart LR");
    for (const [a, b, w] of kept) {
      console.log(`  ${a} ---|${(w * 100).toFixed(0)}%| ${b}`);
    }
  } else {
    console.log("digraph skills {");
    console.log('  rankdir=LR;');
    console.log('  node [shape=box, style="rounded,filled", fillcolor="#eef4ff"];');
    for (const s of skills) console.log(`  "${s.name}";`);
    for (const [a, b, w] of kept) {
      console.log(`  "${a}" -> "${b}" [label="${(w * 100).toFixed(0)}%", penwidth="${(w * 3).toFixed(1)}"];`);
    }
    console.log("}");
  }
  console.error(`${smallLogo()} ${skills.length} nodes, ${kept.length}/${edges.length} edges (threshold ${threshold}, top ${top})`);
  return 0;
}
