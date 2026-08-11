// tools command: surface skill scripts/hooks/tools as callable AI tools.
//  tools list                       inventory every callable skill tool
//  tools describe <name>            JSON schema-style description for LLM use
//  tools run <name> [args]          execute one tool (explicit, bounded, redacted)
//  tools run-batch a,b,c [args]     execute several tools sequentially, shared ledger
//  tools dry-run <name> [args]      preview the exact command without executing
//  tools audit                      static risk audit of discovered tools
//  tools docs                       generate a TOOLS.md reference of the tool surface
//  tools history                    show the local execution ledger
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRegistry, registryDir, VERSION } from "../engine.js";
import { auditSkillTools, clearToolRuns, filterToolsByPolicy, listSkillTools, readToolRuns, resolveToolRun, runSkillTool } from "../ai-tools.js";

function actionArgs(args) {
  const raw = Array.isArray(args._) ? args._ : [];
  const sub = args.toolsAction ?? raw[1] ?? "list";
  const tail = raw.slice(2);
  return { raw, sub, tail };
}

export function cmdTools(args = {}) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const policy = args.tools ?? null;
  const { sub, tail } = actionArgs(args);

  if (sub === "list") {
    const tools = filterToolsByPolicy(listSkillTools(payload), policy);
    if (args.json) {
      console.log(JSON.stringify(tools, null, 2));
    } else {
      console.log(`callable skill tools: ${tools.length}`);
      for (const tool of tools) {
        console.log(`  ${tool.name}  (${tool.language}, ${tool.skill})  — ${tool.description}`);
      }
      console.log("run one: parasite-skill tools run <name> [args]  (explicit, bounded, captured)");
    }
    return 0;
  }

  if (sub === "describe") {
    const name = args.name ?? tail[0];
    const tool = listSkillTools(payload).find((entry) => entry.name === name);
    if (!tool) {
      console.error(`unknown skill tool: ${name}`);
      return 1;
    }
    console.log(
      JSON.stringify(
        {
          ...tool,
          run: {
            args: "space-separated string appended to the script command",
            timeoutMs: "default 30000, cap 300000",
            note: "execution is explicit, time-bounded, captured, and redacted",
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (sub === "dry-run") {
    const name = args.name ?? tail[0];
    const toolArgs = args.args ?? tail.slice(1).join(" ");
    if (!name) {
      console.error('missing tool name: parasite-skill tools dry-run <name> [args]');
      return 1;
    }
    try {
      const { tool, argv, cwd, timeoutMs } = resolveToolRun(payload, name, toolArgs, { policy });
      console.log(JSON.stringify({ name, command: tool.command, argv, cwd, timeoutMs, would_execute: true }, null, 2));
      return 0;
    } catch (err) {
      console.error(String(err.message ?? err));
      return err.code === "UNKNOWN_TOOL" || err.code === "MISSING_FILE" ? 1 : 2;
    }
  }

  if (sub === "audit") {
    const audits = auditSkillTools(payload);
    const threshold = args.threshold ?? "medium";
    const levels = ["low", "medium", "high"];
    const minIndex = levels.indexOf(threshold);
    const flagged = audits.filter((entry) => levels.indexOf(entry.risk) >= minIndex);
    if (args.json) {
      console.log(JSON.stringify({ threshold, tools: audits, flagged: flagged.length }, null, 2));
    } else {
      console.log(`tool risk audit (threshold ${threshold}):`);
      for (const entry of audits) {
        const mark = entry.risk === "high" ? "H" : entry.risk === "medium" ? "M" : "L";
        const flagNames = entry.flags.map((flag) => flag.pattern).slice(0, 4).join(", ");
        console.log(`  [${mark}] ${entry.name} (${entry.risk})${flagNames ? ` — ${flagNames}` : ""}`);
      }
      console.log(`${flagged.length}/${audits.length} tool(s) at or above ${threshold} risk`);
    }
    return flagged.length ? 1 : 0;
  }

  if (sub === "history") {
    if (args.clear) {
      clearToolRuns(reg);
      console.log("tool run ledger cleared");
      return 0;
    }
    const limit = Math.max(1, Number(args.limit) || 50);
    const entries = readToolRuns(reg, limit);
    if (args.json) {
      console.log(JSON.stringify({ count: entries.length, entries }, null, 2));
    } else {
      console.log(`tool run ledger (${entries.length} shown):`);
      for (const entry of entries) {
        const mark = entry.status === 0 ? "ok" : `exit ${entry.status}`;
        console.log(`  ${entry.ts}  ${entry.name}  ${mark}  ${entry.duration_ms}ms  out=${entry.stdout_chars} err=${entry.stderr_chars}`);
        if (entry.args) console.log(`    args: ${entry.args}`);
      }
      if (!entries.length) console.log("  none recorded yet");
    }
    return 0;
  }

  if (sub === "docs") {
    const out = args.out ? join(process.cwd(), args.out) : join(reg, "TOOLS.md");
    mkdirSync(dirname(out), { recursive: true });
    const tools = filterToolsByPolicy(listSkillTools(payload), policy);
    const esc = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const lines = [
      "# Skill AI-Tools (TOOLS.md)",
      "",
      `Generated by parasite-skill v${VERSION}. Callable scripts/hooks/tools discovered from the registry.`,
      "",
      `${tools.length} callable tools`,
      "",
      "| Tool | Language | Skill | Description |",
      "|---|---|---|---|",
      ...tools.map((tool) => `| \`${tool.name}\` | ${tool.language} | ${tool.skill} | ${esc(tool.description).slice(0, 80)} |`),
      "",
      "## Run policy",
      "- Execution is explicit (`tools run <name>`), time-bounded (default 30000ms, cap 300000ms), captured, redacted, and recorded in the audit ledger.",
      "- Project policy (`parasite-skill.json` `tools` block): allow/deny/env lists; deny wins, a non-empty allow list must match, `*` globs supported.",
      "- Scoped policy keys (`scoped`): `profile:<name>` and `sets:<set-name>` merge extra allow/deny/env for agents run.",
      "- Routing or planning alone never executes tools.",
      "",
      "## Per-skill details",
      ...tools.map((tool) => [
        `### ${tool.name}`,
        "",
        `- Skill: ${tool.skill}`,
        `- Language: ${tool.language}`,
        `- Script: \`${tool.path}\``,
        `- Description: ${esc(tool.description)}`,
        ...(tool.argsSchema ? [`- Args schema: \`${JSON.stringify(tool.argsSchema)}\``] : []),
        "",
      ]).flat(),
    ];
    writeFileSync(out, lines.join("\n") + "\n", "utf-8");
    console.log(`TOOLS.md generated -> ${out} (${tools.length} tools)`);
    return 0;
  }

  if (sub === "run-batch") {
    const names = (args.names ?? tail[0] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
    if (!names.length) {
      console.error('tools run-batch requires tool names: parasite-skill tools run-batch a,b,c [--args "..."] [--continue]');
      return 1;
    }
    const toolArgs = args.args ?? "";
    const timeoutMs = args.timeoutMs ?? args.tools?.timeoutMs;
    const stopOnError = args.continue !== true;
    const results = [];
    let code = 0;
    for (const name of names) {
      try {
        const result = runSkillTool(payload, name, toolArgs, { timeoutMs, policy, registry: reg });
        results.push(result);
        if (!result.ok) code = Math.max(code, 1);
        if (!result.ok && stopOnError) break;
      } catch (err) {
        results.push({ ok: false, name, status: 2, stderr: String(err.message ?? err), duration_ms: 0 });
        code = Math.max(code, 2);
        if (stopOnError) break;
      }
    }
    if (args.json) {
      console.log(JSON.stringify({ count: results.length, results }, null, 2));
    } else {
      for (const result of results) {
        if (result.stdout) console.log(result.stdout);
        if (result.stderr) console.error(result.stderr);
        console.log(`[tool ${result.name}: exit ${result.status} in ${result.duration_ms}ms]`);
      }
      console.log(`${results.filter((result) => result.ok).length}/${results.length} succeeded`);
    }
    return code;
  }

  if (sub === "run") {
    const name = args.name ?? tail[0];
    const toolArgs = args.args ?? tail.slice(1).join(" ");
    if (!name) {
      console.error('missing tool name: parasite-skill tools run <name> [args]');
      return 1;
    }
    try {
      const result = runSkillTool(payload, name, toolArgs, { timeoutMs: args.timeoutMs ?? args.tools?.timeoutMs, policy, registry: reg });
      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.stdout) console.log(result.stdout);
        if (result.stderr) console.error(result.stderr);
        console.log(`[tool ${result.name}: exit ${result.status} in ${result.duration_ms}ms]`);
      }
      return result.ok ? 0 : 1;
    } catch (err) {
      console.error(String(err.message ?? err));
      return 2;
    }
  }

  console.error("tools action must be list, describe, run, run-batch, dry-run, audit, docs, or history");
  return 1;
}
