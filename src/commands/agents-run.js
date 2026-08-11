// agents run <profile> "<request>": execute a declarative agent profile.
// Routes the request through the profile's sets and skills, runs the selected
// skills' script tools (explicit, bounded, captured), asserts the profile's
// guardrails, and saves a report to the registry. It never executes hidden
// code, bypasses permissions, or touches files outside the selected tools.
// `agents run --all "<request>"` runs every profile once and writes a combined
// report, deduplicating tool execution across profiles.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composePayload, loadRegistry, loadSetsWithProject, registryDir } from "../engine.js";
import { AGENT_PROFILES } from "../data/agent-profiles.js";
import { auditSkillTools, listSkillTools, policyFor, resolveToolRun, runSkillTool } from "../ai-tools.js";
import { fmt } from "./_lib.js";
import { smallLogo } from "../logo.js";

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-|-$/g, "") || "request";
}

function runProfile(profile, request, { payload, sets, reg, policyConfig, maxTools, timeoutMs, maxChars, top, excludeSkills, ranTools, dryRun = false, riskByName }) {
  const def = AGENT_PROFILES[profile];
  // Per-tool static-audit risk is joined once in cmdAgentsRun and passed down
  // so every report entry carries its posture without re-reading every asset
  // per profile (agents run --all runs six profiles over the same payload).
  // Per-profile policy resolution: project base rules merged with scoped rules
  // keyed by profile:<name> and sets:<set> — so one config file can express
  // different tool boundaries per agent role without hand-editing.
  const policy = policyFor(policyConfig, { profile, sets: def.sets });
  // Use the resolved policy (base + scoped profile/set) so a scoped timeoutMs
  // actually reaches the tool run; an explicit CLI flag still wins.
  const runTimeoutMs = timeoutMs ?? policy?.timeoutMs;

  // Route within the profile's sets first; fall back to the full registry when
  // the profile's named skills are not installed, so the run is still useful.
  let runtime = composePayload(payload, request, {
    sets,
    top: top ?? 6,
    maxChars,
    enabledSets: def.sets,
    excludeSkills,
  });
  const scoped = runtime.selectedSkills.length > 0;
  if (!scoped) {
    runtime = composePayload(payload, request, { sets, top: top ?? 6, maxChars, excludeSkills });
  }

  const selectedNames = new Set(runtime.selectedSkills.map((skill) => skill.name));
  const available = listSkillTools(payload).filter((tool) => selectedNames.has(tool.skill));
  const cap = Math.max(0, Math.min(Number(maxTools) || 6, 20));
  const toolRuns = [];
  let skipped = 0;
  for (const tool of available.slice(0, cap)) {
    if (ranTools.has(tool.name)) {
      skipped++;
      continue;
    }
    ranTools.add(tool.name);
    if (dryRun) {
      // Preview only: resolve the exact command and check policy without
      // executing anything or touching the audit ledger.
      try {
        const resolved = resolveToolRun(payload, tool.name, request, { policy });
        toolRuns.push({
          ok: true,
          dry_run: true,
          name: tool.name,
          skill: tool.skill,
          command: resolved.tool.command,
          argv: resolved.argv.map(String),
          cwd: resolved.cwd,
          timeout_ms: resolved.timeoutMs,
          duration_ms: 0,
        });
      } catch (err) {
        const blocked = err.code === "TOOL_DENIED" || err.code === "TOOL_NOT_ALLOWED";
        toolRuns.push({ ok: false, blocked, name: tool.name, skill: tool.skill, status: 2, stderr: String(err.message ?? err), duration_ms: 0 });
      }
      continue;
    }
    try {
      toolRuns.push(runSkillTool(payload, tool.name, request, { timeoutMs: runTimeoutMs, policy, registry: reg }));
    } catch (err) {
      const blocked = err.code === "TOOL_DENIED" || err.code === "TOOL_NOT_ALLOWED";
      toolRuns.push({ ok: false, blocked, name: tool.name, skill: tool.skill, status: 2, stderr: String(err.message ?? err), duration_ms: 0 });
    }
  }

  const guardrails = (def.guardrails ?? []).map((rule) => ({
    rule,
    status: "declared",
    note: "satisfied by construction: execution stays explicit, bounded, local, and reversible; no unsupported targets are touched",
  }));

  return {
    profile,
    profile_desc: def.desc,
    scoped_to_profile_sets: scoped,
    decision: {
      selectedSet: runtime.decision.selectedSkillSet,
      selectedSkills: runtime.selectedSkills.map((skill) => ({ name: skill.name, score: skill.score })),
    },
    guardrails,
    tool_runs: toolRuns.map((run) => ({
      ok: run.ok,
      name: run.name,
      skill: run.skill,
      status: run.status,
      duration_ms: run.duration_ms,
      risk: riskByName.get(run.name) ?? "low",
      stdout_chars: (run.stdout ?? "").length,
      stderr_chars: (run.stderr ?? "").length,
    })),
    runs: toolRuns,
    summary: `${toolRuns.filter((run) => run.ok).length}/${toolRuns.length} tools succeeded${skipped ? ` (${skipped} deduped)` : ""}`,
  };
}

export function cmdAgentsRun(args = {}) {
  const raw = Array.isArray(args._) ? args._ : [];
  const profile = args.profile ?? raw[2];
  const request = raw.length > 3 ? raw.slice(3).join(" ") : (args.request ?? "");

  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const sets = loadSetsWithProject(reg, args.sets);
  const policy = args.tools ?? null;
  // One audit for the whole run, shared by every profile's report.
  const riskByName = new Map(auditSkillTools(payload).map((entry) => [entry.name, entry.risk]));

  if (args.all) {
    if (!request) {
      console.error('agents run --all requires a request: parasite-skill agents run --all "<request>"');
      return 1;
    }
    // --profiles a,b runs only the named subset of profiles.
    let profileNames = Object.keys(AGENT_PROFILES);
    if (args.profiles) {
      profileNames = String(args.profiles).split(",").map((name) => name.trim()).filter(Boolean);
      const unknown = profileNames.filter((name) => !AGENT_PROFILES[name]);
      if (unknown.length) {
        console.error(`unknown profile(s): ${unknown.join(", ")}. available: ${Object.keys(AGENT_PROFILES).join(", ")}`);
        return 1;
      }
    }
    const allProfiles = !args.profiles;
    const ranTools = new Set();
    const reports = profileNames.map((name) =>
      runProfile(name, request, { payload, sets, reg, policyConfig: policy, maxTools: args.maxTools, timeoutMs: args.timeoutMs, maxChars: args.maxChars, top: args.top, excludeSkills: args.excludeSkills, ranTools, dryRun: args.dryRun, riskByName }),
    );
    if (args.dryRun) {
      const dir = join(reg, "agents");
      mkdirSync(dir, { recursive: true });
      const base = `all-${slugify(request)}`;
      const blockedTotal = reports.reduce((n, report) => n + report.runs.filter((run) => run.blocked).length, 0);
      const dryRunReport = {
        kind: "parasite-skill-agent-dry-run-all",
        request,
        profiles: reports.length,
        nothing_executed: true,
        blocked_total: blockedTotal,
        strict: args.strict === true,
        reports: reports.map((report) => ({
          profile: report.profile,
          profile_desc: report.profile_desc,
          selected_skills: report.decision.selectedSkills.map((skill) => skill.name),
          would_run: report.runs.filter((run) => run.ok).map((run) => ({ name: run.name, skill: run.skill, command: run.command, argv: run.argv.map(String), cwd: run.cwd, timeout_ms: run.timeout_ms })),
          blocked: report.runs.filter((run) => run.blocked).map((run) => ({ name: run.name, reason: run.stderr })),
        })),
      };
      writeFileSync(join(dir, `${base}.dryrun.json`), JSON.stringify(dryRunReport, null, 2) + "\n", "utf-8");
      const md = [
        `# Agent Dry-Run: all profiles`,
        "",
        `Request: ${request}`,
        "Nothing was executed; the audit ledger was not touched.",
        `Blocked by policy: ${blockedTotal}`, "",
        ...reports.map((report) => [
          `## ${report.profile} — ${report.profile_desc}`,
          `Set: ${report.decision.selectedSet}`, "",
          "### Would run",
          ...(report.runs.filter((run) => run.ok).map((run) => `- ${run.name}: ${run.command} ${run.argv.slice(1).join(" ").slice(0, 120)}`)),
          "",
          ...(report.runs.some((run) => run.blocked) ? ["### Blocked by policy", ...report.runs.filter((run) => run.blocked).map((run) => `- ${run.name}: ${run.stderr}`), ""] : []),
        ]).flat(),
        `Report: ${base}.dryrun.json`,
      ];
      writeFileSync(join(dir, `${base}.dryrun.md`), md.join("\n") + "\n", "utf-8");
      if (args.json) {
        console.log(JSON.stringify({ ...dryRunReport, saved: `agents/${base}.dryrun.json` }, null, 2));
      } else {
        console.log(`${smallLogo()} agent dry-run: all ${reports.length} profiles (nothing executed)`);
        for (const report of reports) {
          const wouldRun = report.runs.filter((run) => run.ok);
          console.log(`  ${report.profile}: ${wouldRun.length}/${report.runs.length} tools would run`);
          for (const run of wouldRun) {
            console.log(`    - ${run.name}: ${run.command} ${run.argv.slice(1).join(" ").slice(0, 120)}`);
          }
          for (const blocked of report.runs.filter((run) => run.blocked)) {
            console.log(`    - ${blocked.name}: blocked — ${blocked.stderr}`);
          }
        }
        console.log(`  report: ${fmt(join(dir, `${base}.dryrun.md`))} (ledger untouched)`);
      }
      // --strict turns policy-blocked tools into a hard failure (exit 2).
      return args.strict === true && blockedTotal > 0 ? 2 : 0;
    }
    const combined = {
      kind: "parasite-skill-agent-run-all",
      request,
      profiles: reports.length,
      reports: reports.map(({ runs: _runs, ...rest }) => rest),
      total_tools: reports.reduce((n, report) => n + report.tool_runs.length, 0),
      successful_tools: reports.reduce((n, report) => n + report.tool_runs.filter((run) => run.ok).length, 0),
      generated_at: new Date().toISOString(),
    };
    const dir = join(reg, "agents");
    mkdirSync(dir, { recursive: true });
    const base = `all-${slugify(request)}`;
    writeFileSync(join(dir, `${base}.json`), JSON.stringify(combined, null, 2) + "\n", "utf-8");
    const md = [
      `# Agent Run: all profiles`,
      "",
      `Request: ${request}`,
      `${combined.profiles} profiles · ${combined.total_tools} tool runs · ${combined.successful_tools} succeeded`,
      "",
      ...reports.map((report) => [
        `## ${report.profile} — ${report.profile_desc}`,
        `Routed ${report.scoped_to_profile_sets ? "within profile sets" : "full registry"} -> set ${report.decision.selectedSet}`,
        `Tools: ${report.summary}`,
        ...report.tool_runs.map((run) => `- ${run.name}: ${run.ok ? "ok" : `exit ${run.status}`} (${run.duration_ms}ms) [risk ${run.risk}]`),
        "",
      ]).flat(),
      `Report: ${base}.json`,
    ];
    writeFileSync(join(dir, `${base}.md`), md.join("\n") + "\n", "utf-8");
    if (args.json) {
      console.log(JSON.stringify({ ...combined, saved: `agents/${base}.json` }, null, 2));
    } else {
      console.log(`${smallLogo()} agent run: ${allProfiles ? "all " : ""}${combined.profiles} profile${combined.profiles === 1 ? "" : "s"}`);
      console.log(`  request: ${request}`);
      console.log(`  tools: ${combined.successful_tools}/${combined.total_tools} succeeded (deduped across profiles)`);
      console.log(`  report: ${fmt(join(dir, `${base}.md`))}`);
    }
    if (args.strict === true && reports.some((report) => report.runs.some((run) => run.blocked))) return 2;
    // --min-tools N gates on the number of successful tool runs (CI check).
    if (args.minTools != null && combined.successful_tools < Number(args.minTools)) {
      console.error(`--min-tools ${args.minTools} not met: ${combined.successful_tools} successful tool runs`);
      return 1;
    }
    return 0;
  }

  if (!profile || !AGENT_PROFILES[profile]) {
    console.error(`agents run requires a profile name. available: ${Object.keys(AGENT_PROFILES).join(", ")}`);
    console.error('usage: parasite-skill agents run <profile> "<request>" [--max-tools N]  |  agents run --all "<request>"');
    return 1;
  }
  if (!request) {
    console.error("agents run requires a request: parasite-skill agents run <profile> \"<request>\"");
    return 1;
  }

  const ranTools = new Set();
  const report = runProfile(profile, request, { payload, sets, reg, policyConfig: policy, maxTools: args.maxTools, timeoutMs: args.timeoutMs, maxChars: args.maxChars, top: args.top, excludeSkills: args.excludeSkills, ranTools, dryRun: args.dryRun, riskByName });
  if (args.dryRun) {
    const dir = join(reg, "agents");
    mkdirSync(dir, { recursive: true });
    const base = `${profile}-${slugify(request)}`;
    const wouldRun = report.runs.filter((run) => run.ok);
    const blocked = report.runs.filter((run) => run.blocked);
    const dryRunReport = {
      kind: "parasite-skill-agent-dry-run",
      profile,
      profile_desc: report.profile_desc,
      request,
      nothing_executed: true,
      blocked_count: blocked.length,
      strict: args.strict === true,
      selected_skills: report.decision.selectedSkills.map((skill) => ({ name: skill.name, score: skill.score })),
      would_run: wouldRun.map((run) => ({ name: run.name, skill: run.skill, command: run.command, argv: run.argv.map(String), cwd: run.cwd, timeout_ms: run.timeout_ms })),
      blocked: blocked.map((run) => ({ name: run.name, reason: run.stderr })),
    };
    writeFileSync(join(dir, `${base}.dryrun.json`), JSON.stringify(dryRunReport, null, 2) + "\n", "utf-8");
    const md = [
      `# Agent Dry-Run: ${profile}`,
      "",
      report.profile_desc,
      "",
      `Request: ${request}`,
      "Nothing was executed; the audit ledger was not touched.",
      `Selected skills: ${report.decision.selectedSkills.map((skill) => skill.name).join(", ") || "none"}`,
      "",
      "## Would run",
      ...(wouldRun.length ? wouldRun.map((run) => `- ${run.name}: ${run.command} ${run.argv.slice(1).join(" ").slice(0, 120)} (cwd ${run.cwd})`) : ["- none"]),
      "",
      ...(blocked.length ? ["## Blocked by policy", ...blocked.map((run) => `- ${run.name}: ${run.stderr}`), ""] : []),
      `Report: ${base}.dryrun.json`,
    ];
    writeFileSync(join(dir, `${base}.dryrun.md`), md.join("\n") + "\n", "utf-8");
    if (args.json) {
      console.log(JSON.stringify({ ...dryRunReport, saved: `agents/${base}.dryrun.json` }, null, 2));
    } else {
      console.log(`${smallLogo()} agent dry-run: ${profile} (nothing executed)`);
      console.log(`  request: ${request}`);
      console.log(`  skills:  ${report.decision.selectedSkills.map((skill) => skill.name).join(", ") || "none"}`);
      console.log(`  tools:   ${wouldRun.length}/${report.runs.length} would run`);
      for (const run of wouldRun) {
        console.log(`    - ${run.name}: ${run.command} ${run.argv.slice(1).join(" ").slice(0, 120)} (cwd ${run.cwd})`);
      }
      for (const blockedRun of blocked) {
        console.log(`    - ${blockedRun.name}: blocked — ${blockedRun.stderr}`);
      }
      console.log(`  report: ${fmt(join(dir, `${base}.dryrun.md`))} (ledger untouched)`);
    }
    // --strict turns policy-blocked tools into a hard failure (exit 2).
    return args.strict === true && blocked.length > 0 ? 2 : 0;
  }
  const dir = join(reg, "agents");
  mkdirSync(dir, { recursive: true });
  const base = `${profile}-${slugify(request)}`;
  // Keep the saved report bounded: summaries only, never full tool output.
  const { runs: _runs, ...summaryReport } = report;
  writeFileSync(join(dir, `${base}.json`), JSON.stringify({ kind: "parasite-skill-agent-run", ...summaryReport, request, generated_at: new Date().toISOString() }, null, 2) + "\n", "utf-8");
  const md = [
    `# Agent Run: ${profile}`,
    "",
    report.profile_desc,
    "",
    `Request: ${request}`,
    `Routed ${report.scoped_to_profile_sets ? "within profile sets" : "across the full registry"} -> set: ${report.decision.selectedSet}`,
    "",
    "## Selected skills",
    ...(report.decision.selectedSkills.length
      ? report.decision.selectedSkills.map((skill) => `- ${skill.name} (score ${skill.score})`)
      : ["- none matched"]),
    "",
    "## Tool runs",
    ...(report.tool_runs.length
      ? report.tool_runs.map((run) => `- ${run.name}: ${run.ok ? "ok" : `exit ${run.status}`} (${run.duration_ms}ms) [risk ${run.risk}]` + (run.stderr ? ` — ${run.stderr.slice(0, 200)}` : ""))
      : ["- no script tools selected"]),
    "",
    "## Guardrails",
    ...report.guardrails.map((g) => `- [x] ${g.rule}`),
    "",
    `Report: ${base}.json`,
  ];
  writeFileSync(join(dir, `${base}.md`), md.join("\n") + "\n", "utf-8");

  if (args.json) {
    console.log(JSON.stringify({ kind: "parasite-skill-agent-run", ...summaryReport, request, generated_at: new Date().toISOString(), saved: `agents/${base}.json` }, null, 2));
  } else {
    console.log(`${smallLogo()} agent run: ${profile}`);
    console.log(`  request: ${request}`);
    console.log(`  routed: ${report.scoped_to_profile_sets ? "profile sets" : "full registry"} -> set ${report.decision.selectedSet}`);
    console.log(`  skills: ${report.decision.selectedSkills.map((skill) => skill.name).join(", ") || "none"}`);
    console.log(`  tools:  ${report.summary}`);
    for (const run of report.tool_runs) {
      const mark = run.ok ? "ok" : `exit ${run.status}`;
      console.log(`    - ${run.name}: ${mark} (${run.duration_ms}ms)`);
    }
    for (const run of report.runs) {
      if (run.blocked) console.log(`    - ${run.name}: blocked — ${run.stderr}`);
      if (run.stdout) {
        const echoed = run.stdout.slice(0, 400).replace(/\n/g, "\n    ");
        console.log(`    | ${echoed}`);
      }
    }
    console.log(`  report: ${fmt(join(dir, `${base}.md`))}`);
  }
  // --strict turns policy-blocked tools into a hard failure (exit 2), so CI
  // and scripted callers can treat a partially-blocked agent run as a gate.
  if (args.strict === true && report.runs.some((run) => run.blocked)) return 2;
  // --min-tools N gates on the number of successful tool runs.
  if (args.minTools != null) {
    const okCount = report.tool_runs.filter((run) => run.ok).length;
    if (okCount < Number(args.minTools)) {
      console.error(`--min-tools ${args.minTools} not met: ${okCount} successful tool runs`);
      return 1;
    }
  }
  return 0;
}
