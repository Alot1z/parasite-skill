// tools command: surface skill scripts/hooks/tools as callable AI tools.
//  tools list                       inventory every callable skill tool
//  tools describe <name>            JSON schema-style description for LLM use
//  tools run <name> [args]          execute one tool (explicit, bounded, redacted)
//  tools run-batch a,b,c [args]     execute several tools sequentially, shared ledger
//  tools dry-run <name> [args]      preview the exact command without executing
//  tools audit                      static risk audit of discovered tools
//  tools docs                       generate a TOOLS.md reference of the tool surface
//  tools policy                     read or edit the project tools policy in
//                                   parasite-skill.json (allow/deny/env/timeoutMs/scoped)
//  tools history                    show the local execution ledger
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { loadProjectConfig, loadRegistry, registryDir } from "../engine.js";
import { auditSkillTools, clearToolRuns, filterToolsByPolicy, listSkillTools, readToolRuns, renderToolsDocs, resolveToolRun, runSkillTool } from "../ai-tools.js";

function parseKeyValues(raw) {
  if (!raw) return null;
  const out = {};
  for (const part of String(raw).split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1);
  }
  return Object.keys(out).length ? out : null;
}

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
      const { tool, argv, cwd, timeoutMs } = resolveToolRun(payload, name, toolArgs, {
        policy,
        ...(args.jsonArgs !== undefined ? { jsonArgs: args.jsonArgs } : {}),
      });
      console.log(JSON.stringify({ name, command: tool.command, argv, cwd, timeoutMs, would_execute: true }, null, 2));
      return 0;
    } catch (err) {
      console.error(String(err.message ?? err));
      if (err.code === "UNKNOWN_TOOL" || err.code === "MISSING_FILE") return 1;
      return err.code === "ARGS_INVALID" ? 3 : 2;
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
    writeFileSync(out, renderToolsDocs(payload, policy), "utf-8");
    console.log(`TOOLS.md generated -> ${out}`);
    return 0;
  }

  if (sub === "policy") {
    const splitList = (value) => String(value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const ops = [];
    if (args.policyAllow !== undefined) ops.push(["allow", splitList(args.policyAllow)]);
    if (args.policyDeny !== undefined) ops.push(["deny", splitList(args.policyDeny)]);
    if (args.policyEnv !== undefined) ops.push(["env", splitList(args.policyEnv)]);
    if (args.policyTimeoutMs !== undefined) {
      const n = Number(args.policyTimeoutMs);
      if (!Number.isFinite(n) || n < 1000) {
        console.error("--policy-timeout-ms must be a number >= 1000");
        return 1;
      }
      ops.push(["timeoutMs", n]);
    }
    if (args.dropPolicy) ops.push(["__drop__", true]);
    const scopedKey = args.scoped;
    const scopedOps = [];
    if (scopedKey) {
      if (args.scopedAllow !== undefined) scopedOps.push(["allow", splitList(args.scopedAllow)]);
      if (args.scopedDeny !== undefined) scopedOps.push(["deny", splitList(args.scopedDeny)]);
      if (args.scopedEnv !== undefined) scopedOps.push(["env", splitList(args.scopedEnv)]);
    }
    if (args.clearScoped && !scopedKey) {
      console.error("--clear-scoped requires --scoped NAME");
      return 1;
    }
    const hasWriteOps = ops.length > 0 || scopedOps.length > 0 || !!args.clearScoped;
    if (!hasWriteOps) {
      console.log(JSON.stringify(policy ?? { unset: true }, null, 2));
      return 0;
    }
    // Locate the config file: explicit --policy-file, the walked-up project
    // config, or a fresh parasite-skill.json in the current directory.
    let configPath = args.policyFile ? (isAbsolute(args.policyFile) ? args.policyFile : join(process.cwd(), args.policyFile)) : null;
    let config = {};
    if (configPath) {
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch (err) {
          console.error(`failed to parse ${configPath}: ${err.message}`);
          return 1;
        }
      }
    } else {
      const found = loadProjectConfig();
      if (found) {
        configPath = found._path;
        config = { ...found };
        delete config._path;
        delete config._dir;
      } else {
        configPath = join(process.cwd(), "parasite-skill.json");
      }
    }
    const before = JSON.stringify(config.tools ?? null, null, 2);
    let dropped = false;
    const tools = { ...(config.tools && typeof config.tools === "object" && !Array.isArray(config.tools) ? config.tools : {}) };
    for (const [key, value] of ops) {
      if (key === "__drop__") {
        // Drop wins over any other mutation in the same call: remove the block
        // and never re-assign the stale copy below.
        dropped = true;
        delete config.tools;
        break;
      }
      tools[key] = value;
    }
    if (scopedKey) {
      const scoped = { ...(tools.scoped ?? {}) };
      if (args.clearScoped) delete scoped[scopedKey];
      const entry = { ...(scoped[scopedKey] ?? {}) };
      for (const [key, value] of scopedOps) entry[key] = value;
      scoped[scopedKey] = entry;
      tools.scoped = scoped;
    }
    if (!dropped && (ops.length || scopedOps.length || args.clearScoped)) config.tools = tools;
    const after = JSON.stringify(config.tools ?? null, null, 2);
    console.log(`tools policy -> ${configPath}`);
    if (before !== after) {
      console.log(`  before: ${before}`);
      console.log(`  after:  ${after}`);
    } else {
      console.log("  (no change)");
    }
    if (args.policyDryRun) {
      console.log("  (dry-run: not written)");
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      console.log("  written");
    }
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
    const envExtra = parseKeyValues(args.toolEnv);
    const results = [];
    let code = 0;
    for (const name of names) {
      try {
        const result = runSkillTool(payload, name, toolArgs, {
          timeoutMs,
          policy,
          registry: reg,
          ...(args.jsonArgs !== undefined ? { jsonArgs: args.jsonArgs } : {}),
          ...(envExtra ? { env: { ...process.env, ...envExtra } } : {}),
        });
        results.push(result);
        if (!result.ok) code = Math.max(code, 1);
        if (!result.ok && stopOnError) break;
      } catch (err) {
        const status = err.code === "ARGS_INVALID" ? 3 : 2;
        results.push({ ok: false, name, status, stderr: String(err.message ?? err), duration_ms: 0 });
        code = Math.max(code, status);
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
    const envExtra = parseKeyValues(args.toolEnv);
    try {
      const result = runSkillTool(payload, name, toolArgs, {
        timeoutMs: args.timeoutMs ?? args.tools?.timeoutMs,
        policy,
        registry: reg,
        ...(args.jsonArgs !== undefined ? { jsonArgs: args.jsonArgs } : {}),
        ...(envExtra ? { env: { ...process.env, ...envExtra } } : {}),
      });
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
      return err.code === "ARGS_INVALID" ? 3 : 2;
    }
  }

  console.error("tools action must be list, describe, run, run-batch, dry-run, audit, docs, policy, or history");
  return 1;
}
