// doctor: one-shot health check for the whole package surface.
//   parasite-skill doctor
// Runs: registry load + spec validation, tools verify (scripts/policy/schema),
// static risk audit (baseline diff when one exists), a project-config parse
// check, and the project GC TTL posture. Exits 1 on the first failing check
// so CI can gate on it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProjectConfig, loadRegistry, registryDir } from "../engine.js";
import { auditSkillTools, filterToolsByPolicy, listSkillTools, resolveToolRun } from "../ai-tools.js";
import { planGc } from "./tools.js";

export function cmdDoctor(args = {}) {
  const reg = registryDir(args.registry);
  const checks = [];
  let failed = 0;
  const fail = (name, detail) => {
    checks.push({ check: name, ok: false, detail });
    failed++;
  };
  const ok = (name, detail) => checks.push({ check: name, ok: true, detail });

  // 1. Registry loads and every skill is spec-valid.
  let payload;
  try {
    payload = loadRegistry(reg, args.dirs, args.force);
    const bad = payload.skills.filter((s) => !s.spec_ok);
    if (bad.length) fail("spec", `${bad.length} skill(s) with spec issues: ${bad.map((s) => s.name).join(", ")}`);
    else ok("spec", `${payload.skills.length} skill(s) spec-valid`);
  } catch (err) {
    fail("registry", String(err.message ?? err));
    payload = { skills: [] };
  }

  // 2. Tools readiness: scripts exist, policy does not block everything, schemas are sane.
  const policy = args.tools ?? null;
  const tools = filterToolsByPolicy(listSkillTools(payload), policy);
  let missing = 0;
  let policyBlocked = 0;
  for (const tool of tools) {
    try {
      resolveToolRun(payload, tool.name, "", { policy });
    } catch (err) {
      if (err.code === "TOOL_DENIED" || err.code === "TOOL_NOT_ALLOWED") policyBlocked++;
      else if (err.code !== "MISSING_FILE") {
        fail("tools", `${tool.name}: ${err.message ?? err}`);
      } else missing++;
    }
  }
  if (missing) fail("tools", `${missing} tool script(s) missing from disk`);
  else if (!tools.length) ok("tools", "no callable tools discovered (nothing to check)");
  else if (policyBlocked) ok("tools", `${tools.length} tools ready (${policyBlocked} policy-blocked)`);
  else ok("tools", `${tools.length} tools ready`);

  // 3. Static risk audit: baseline diff when one exists, else a plain gate.
  const baselineFile = join(reg, "tool-audit-baseline.json");
  if (existsSync(baselineFile)) {
    let baseline = {};
    try {
      baseline = JSON.parse(readFileSync(baselineFile, "utf-8")).tools ?? {};
    } catch (err) {
      fail("audit", `baseline unreadable: ${err.message}`);
    }
    const audits = auditSkillTools(payload);
    const levels = ["low", "medium", "high"];
    const regressions = audits.filter((entry) => levels.indexOf(entry.risk) > levels.indexOf(baseline[entry.name] ?? "low"));
    if (regressions.length) fail("audit", `${regressions.length} regression(s): ${regressions.map((r) => `${r.name}->${r.risk}`).join(", ")}`);
    else ok("audit", `${audits.length} tools match the persisted baseline`);
  } else {
    const audits = auditSkillTools(payload);
    const high = audits.filter((entry) => entry.risk === "high");
    if (high.length) fail("audit", `${high.length} high-risk tool(s) and no baseline: ${high.map((h) => h.name).join(", ")} (tools audit --write-baseline to approve)`);
    else ok("audit", `${audits.length} tools audited, none high-risk`);
  }

  // 4. Project config parses when present.
  const project = loadProjectConfig();
  if (project) ok("config", `project config loaded: ${project._path}`);
  else ok("config", "no project config present");

  // 5. Project GC TTL posture: when a gc policy exists, dry-run it and report
  // how many stale artifacts a prune would remove. Informational unless the
  // policy declares `auto: true` (safe to run unattended) — then stale
  // artifacts mean the scheduled cleanup has not happened, which is a failing
  // check so CI catches a missed TTL sweep.
  const gcPolicy = args.gc && typeof args.gc === "object" && !Array.isArray(args.gc) ? args.gc : null;
  if (gcPolicy && (Number.isFinite(gcPolicy.ageDays) || Number.isFinite(gcPolicy.keep))) {
    const { totals } = planGc(reg, { ageDays: gcPolicy.ageDays, keep: gcPolicy.keep, dryRun: true });
    const stale = totals.agent_files + totals.ledger_entries;
    if (gcPolicy.auto === true && stale) fail("gc", `${stale} stale artifact(s) under the auto gc policy; run tools gc to clear`);
    else ok("gc", stale ? `${stale} stale artifact(s) under the gc policy (age ${gcPolicy.ageDays ?? "-"}d, keep ${gcPolicy.keep ?? "-"}); run tools gc` : "no stale artifacts under the gc policy");
  } else {
    ok("gc", "no gc TTL policy configured (parasite-skill.json \"gc\": { \"ageDays\": N, \"keep\": N })");
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: failed === 0, failed, checks }, null, 2));
  } else {
    console.log("parasite-skill doctor:");
    for (const check of checks) {
      console.log(`  [${check.ok ? "ok" : "FAIL"}] ${check.check} — ${check.detail}`);
    }
    if (failed) console.log(`${failed} check(s) failed`);
    else console.log("all checks passed");
  }
  return failed ? 1 : 0;
}
