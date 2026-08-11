// tools command: surface skill scripts/hooks/tools as callable AI tools.
//  tools list                       inventory every callable skill tool
//  tools describe <name>            JSON schema-style description for LLM use
//  tools run <name> [args]          execute one tool (explicit, bounded, redacted)
//  tools run-batch a,b,c [args]     execute several tools sequentially, shared ledger
//  tools dry-run <name> [args]      preview the exact command without executing
//  tools audit [--baseline]         static risk audit; diff against a persisted
//                                   baseline (--write-baseline seeds it)
//  tools verify                     readiness check: scripts exist, policy, schemas
//  tools docs                       generate a TOOLS.md reference of the tool surface
//  tools policy                     read or edit the project tools policy in
//                                   parasite-skill.json (allow/deny/env/timeoutMs/scoped)
//  tools history [--name/--skill/--status]  audit ledger, filterable
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { loadProjectConfig, loadRegistry, registryDir } from "../engine.js";
import { auditSkillTools, clearToolRuns, filterToolsByPolicy, listSkillTools, readToolRuns, renderToolsDocs, resolveToolRun, runSkillTool } from "../ai-tools.js";
import { fmt } from "./_lib.js";

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

function globToRegExp(pattern) {
  return new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
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
    let tools = filterToolsByPolicy(listSkillTools(payload), policy);
    const riskLevels = ["low", "medium", "high"];
    if (args.listSkill) {
      const pattern = globToRegExp(args.listSkill);
      tools = tools.filter((tool) => pattern.test(tool.skill));
    }
    if (args.listRisk) {
      const minIndex = riskLevels.indexOf(args.listRisk);
      if (minIndex < 0) {
        console.error("--risk must be one of low|medium|high");
        return 1;
      }
      // Join the static audit so the caller can see only tools at/above a risk.
      const riskByName = new Map(auditSkillTools(payload).map((entry) => [entry.name, entry.risk]));
      tools = tools.filter((tool) => riskLevels.indexOf(riskByName.get(tool.name) ?? "low") >= minIndex);
    }
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

    if (args.writeBaseline) {
      const baseline = {
        version: 1,
        generated_at: new Date().toISOString(),
        tools: Object.fromEntries(audits.map((entry) => [entry.name, entry.risk])),
      };
      writeFileSync(join(reg, "tool-audit-baseline.json"), JSON.stringify(baseline, null, 2) + "\n", "utf-8");
      console.log(`baseline written -> ${fmt(join(reg, "tool-audit-baseline.json"))} (${audits.length} tools)`);
      return 0;
    }

    if (args.baseline) {
      const baselineFile = join(reg, "tool-audit-baseline.json");
      if (!existsSync(baselineFile)) {
        console.error(`no audit baseline found; run: tools audit --write-baseline`);
        return 2;
      }
      let baseline;
      try {
        baseline = JSON.parse(readFileSync(baselineFile, "utf-8")).tools ?? {};
      } catch (err) {
        console.error(`failed to parse audit baseline: ${err.message}`);
        return 2;
      }
      const drift = [];
      let regressions = 0;
      for (const entry of audits) {
        const expected = baseline[entry.name];
        if (!expected) {
          drift.push({ name: entry.name, risk: entry.risk, expected: null, change: "new" });
        } else if (expected !== entry.risk) {
          const worse = levels.indexOf(entry.risk) > levels.indexOf(expected);
          if (worse) regressions++;
          drift.push({ name: entry.name, risk: entry.risk, expected, change: worse ? "regression" : "improvement" });
        }
      }
      if (args.json) {
        console.log(JSON.stringify({ threshold, baseline: baselineFile, drift, regressions }, null, 2));
      } else {
        console.log(`tool risk audit vs baseline (threshold ${threshold}):`);
        if (!drift.length) console.log("  no drift from baseline");
        for (const entry of drift) {
          const arrow = entry.change === "regression" ? "UP" : entry.change === "improvement" ? "down" : "new";
          console.log(`  [${arrow}] ${entry.name}: ${entry.expected ?? "-"} -> ${entry.risk}`);
        }
        console.log(`${regressions} regression(s)`);
      }
      return regressions ? 1 : 0;
    }

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

  if (sub === "verify") {
    const tools = listSkillTools(payload);
    const checks = [];
    let broken = 0;
    for (const tool of tools) {
      const script = join(payload.skills.find((s) => s.name === tool.skill)?.path ?? "", tool.path);
      const status = {};
      if (!existsSync(script)) {
        status.missing = true;
        broken++;
      }
      try {
        resolveToolRun(payload, tool.name, "", { policy });
      } catch (err) {
        if (err.code === "TOOL_DENIED" || err.code === "TOOL_NOT_ALLOWED") status.blocked = true;
        else if (err.code !== "MISSING_FILE") {
          status.error = String(err.message ?? err);
          broken++;
        }
      }
      if (tool.argsSchema && (typeof tool.argsSchema !== "object" || Array.isArray(tool.argsSchema))) {
        status.badSchema = true;
        broken++;
      } else if (tool.argsSchema?.properties != null && typeof tool.argsSchema.properties !== "object") {
        status.badSchema = true;
        broken++;
      }
      checks.push({ name: tool.name, skill: tool.skill, command: tool.command, ...status });
    }
    if (args.json) {
      console.log(JSON.stringify({ count: checks.length, broken, checks }, null, 2));
    } else {
      console.log(`tool readiness check: ${checks.length - broken}/${checks.length} ready`);
      for (const check of checks) {
        const mark = check.missing ? "missing" : check.error ? "error" : check.badSchema ? "schema" : check.blocked ? "blocked" : "ok";
        console.log(`  [${mark}] ${check.name}${check.blocked ? " (policy)" : ""}${check.missing ? " (file missing)" : ""}${check.error ? ` — ${check.error}` : ""}`);
      }
    }
    return broken ? 1 : 0;
  }

  if (sub === "history") {
    if (args.clear) {
      clearToolRuns(reg);
      console.log("tool run ledger cleared");
      return 0;
    }
    const limit = Math.max(1, Number(args.limit) || 50);
    let entries = readToolRuns(reg, 5000);
    if (args.historyName) {
      const pattern = globToRegExp(args.historyName);
      entries = entries.filter((entry) => pattern.test(entry.name));
    }
    if (args.historySkill) {
      const pattern = globToRegExp(args.historySkill);
      entries = entries.filter((entry) => pattern.test(entry.skill ?? ""));
    }
    if (args.historyStatus === "ok") entries = entries.filter((entry) => entry.status === 0);
    if (args.historyStatus === "fail") entries = entries.filter((entry) => entry.status !== 0);
    entries = entries.slice(0, limit);
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
    // --json-args for a batch accepts either a plain object (applied to every
    // tool) or a map keyed by tool name (per-tool structured args). Each tool's
    // args are validated against its own declared argsSchema.
    let parsedBatchArgs = undefined;
    if (args.jsonArgs !== undefined) {
      try {
        parsedBatchArgs = typeof args.jsonArgs === "string" ? JSON.parse(args.jsonArgs) : args.jsonArgs;
      } catch {
        console.error("--json-args is not valid JSON");
        return 3;
      }
    }
    const nameSet = new Set(names);
    const isMap =
      parsedBatchArgs !== undefined &&
      parsedBatchArgs !== null &&
      typeof parsedBatchArgs === "object" &&
      !Array.isArray(parsedBatchArgs) &&
      names.some((name) => name in parsedBatchArgs);

    // --dry-run previews the whole batch: resolve + policy-check every tool,
    // print the exact commands, execute nothing, and never touch the ledger.
    // Exit codes mirror the real run: 1 on any failure, 3 on invalid args.
    if (args.dryRun) {
      const previews = [];
      let failCount = 0;
      let invalidArgs = 0;
      for (const name of names) {
        const jsonArgsForTool = isMap ? parsedBatchArgs[name] : parsedBatchArgs;
        try {
          const resolved = resolveToolRun(payload, name, toolArgs, {
            timeoutMs,
            policy,
            ...(jsonArgsForTool !== undefined ? { jsonArgs: jsonArgsForTool } : {}),
          });
          previews.push({ ok: true, name, command: resolved.tool.command, argv: resolved.argv.map(String), cwd: resolved.cwd, timeout_ms: resolved.timeoutMs });
        } catch (err) {
          const blocked = err.code === "TOOL_DENIED" || err.code === "TOOL_NOT_ALLOWED";
          const invalid = err.code === "ARGS_INVALID";
          if (blocked || invalid) failCount++;
          if (invalid) invalidArgs++;
          previews.push({ ok: false, name, blocked, status: invalid ? 3 : 2, stderr: String(err.message ?? err) });
        }
      }
      if (args.json) {
        console.log(JSON.stringify({ count: previews.length, dry_run: true, previews }, null, 2));
      } else {
        console.log(`batch dry-run: ${names.length} tools (nothing executed)`);
        for (const preview of previews) {
          if (preview.ok) {
            console.log(`  ${preview.name}: ${preview.command} ${preview.argv.slice(1).join(" ").slice(0, 120)} (cwd ${preview.cwd}, timeout ${preview.timeout_ms}ms)`);
          } else {
            console.log(`  ${preview.name}: ${preview.blocked ? "blocked" : "error"} — ${preview.stderr}`);
          }
        }
        console.log("  ledger untouched");
      }
      return invalidArgs ? 3 : failCount ? 1 : 0;
    }

    const results = [];
    let code = 0;
    for (const name of names) {
      const jsonArgsForTool = isMap ? parsedBatchArgs[name] : parsedBatchArgs;
      try {
        const result = runSkillTool(payload, name, toolArgs, {
          timeoutMs,
          policy,
          registry: reg,
          ...(jsonArgsForTool !== undefined ? { jsonArgs: jsonArgsForTool } : {}),
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

  console.error("tools action must be list, describe, run, run-batch, dry-run, audit, verify, docs, policy, or history");
  return 1;
}
