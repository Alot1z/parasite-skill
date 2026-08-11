import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { registryDir, loadRegistry } from "../engine.js";
import { smallLogo } from "../logo.js";

const SKILLS_HOME = () => join(process.env.PARASITE_SKILL_HOME || process.env.HOME || process.env.USERPROFILE, ".agents", "skills");
const GIT = () => (process.platform === "win32" ? "git.exe" : "git");

function git(args, cwd) {
  try {
    return execFileSync(GIT(), args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const msg = e.stderr?.toString()?.trim() || e.message;
    throw new Error(msg);
  }
}

/**
 * Best-effort read-only snapshot of the sync repo state (no git writes, no
 * remote contact). Used by `export` so the ecosystem inventory also knows the
 * backup posture. Never throws: returns { repo: false } when unavailable.
 */
export function syncState() {
  const root = SKILLS_HOME();
  if (!existsSync(join(root, ".git"))) return { repo: false, root };
  try {
    let branch = "main";
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
    } catch {
      /* unborn HEAD */
    }
    let remote = null;
    try {
      const remotes = git(["remote", "-v"], root);
      remote = remotes.split("\n")[0]?.trim() || null;
    } catch {
      /* no remote */
    }
    let changes = 0;
    try {
      const dirty = git(["status", "--porcelain"], root);
      changes = dirty ? dirty.split("\n").filter(Boolean).length : 0;
    } catch {
      /* unreadable */
    }
    return { repo: true, root, branch, remote, changes };
  } catch {
    return { repo: false, root };
  }
}

/**
 * Cloud sync: backs up the whole skills tree (registry + all installed skills)
 * to a git remote. `sync --init <repo-url>` sets it up; `--push` and `--pull`
 * sync. GitHub Actions template in template/ gives users a ready repo.
 */
export function cmdSync(args) {
  const root = SKILLS_HOME();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });

  const action = args.init ? "init" : args.push ? "push" : args.pull ? "pull" : args.status ? "status" : null;
  if (!action) {
    console.error("usage: sync --init <repo-url> | --push | --pull | --status [--dry-run]");
    return 1;
  }
  const dryRun = args.dryRun === true;
  if (dryRun && action !== "push" && action !== "pull") {
    console.error("--dry-run only applies to sync --push / sync --pull");
    return 1;
  }

  if (action === "init") {
    const url = args.repo || (Array.isArray(args._) ? args._[1] : undefined);
    if (!url) {
      console.error("usage: sync --init <repo-url> (e.g. https://github.com/you/parasite-skill-sync.git)");
      return 1;
    }
    if (existsSync(join(root, ".git"))) {
      console.log(`${smallLogo()} already a git repo at ${root}`);
      const remotes = git(["remote", "-v"], root);
      if (!remotes.includes(url)) {
        git(["remote", "add", "origin", url], root);
        console.log(`  added remote: ${url}`);
      }
      return 0;
    }
    git(["init", "-b", "main"], root);
    git(["config", "user.name", "parasite-skill-sync"], root);
    git(["config", "user.email", "parasite-skill-sync@local"], root);
    git(["remote", "add", "origin", url], root);
    console.log(`${smallLogo()} git repo initialized at ${root}`);
    console.log(`  remote: ${url}`);
    console.log("  run: parasite-skill sync --push   (first backup)");
    return 0;
  }

  if (action === "push") {
    if (dryRun) {
      // Preview only: report exactly what a push would stage/commit, without
      // touching the index, creating a commit, or contacting the remote.
      try {
        const staged = git(["add", "-A", "--dry-run"], root);
        const changed = git(["status", "--porcelain"], root);
        if (!changed) {
          console.log(`${smallLogo()} push dry-run: nothing to push — skills tree unchanged`);
          return 0;
        }
        console.log(`${smallLogo()} push dry-run: ${changed.split("\n").length} file(s) would be committed and pushed`);
        for (const line of staged.split("\n").filter(Boolean)) console.log(`  ${line}`);
        console.log("  (nothing staged, committed, or pushed — dry-run)");
        return 0;
      } catch (e) {
        console.error(`push dry-run failed: ${e.message}`);
        console.error("  (is this directory a sync repo? run: parasite-skill sync --init <repo-url>)");
        return 1;
      }
    }
    git(["add", "-A"], root);
    const changed = git(["status", "--porcelain"], root);
    if (!changed) {
      console.log(`${smallLogo()} nothing to push — skills tree unchanged`);
      return 0;
    }
    git(["commit", "-m", "sync: update skills"], root);
    let branch = "main";
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
    } catch {
      /* fresh repo with no commits yet — fall back to main */
    }
    try {
      git(["push", "-u", "origin", branch], root);
      console.log(`${smallLogo()} pushed ${changed.split("\n").length} change(s) to origin/${branch}`);
    } catch (e) {
      console.error(`push failed: ${e.message}`);
      console.error("  (set a remote first: parasite-skill sync --init <repo-url>)");
      return 1;
    }
    return 0;
  }

  if (action === "pull") {
    try {
      let branch = "main";
      try {
        branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
      } catch {
        /* unborn HEAD */
      }
      if (dryRun) {
        // `git fetch --dry-run` contacts the remote read-only and reports what
        // a pull would bring in, without updating refs or the working tree.
        const out = git(["fetch", "--dry-run", "origin", branch], root);
        if (!out.trim()) {
          console.log(`${smallLogo()} pull dry-run: up to date with origin/${branch}`);
        } else {
          console.log(`${smallLogo()} pull dry-run: changes would be fetched from origin/${branch}`);
          for (const line of out.split("\n").filter(Boolean)) console.log(`  ${line}`);
        }
        console.log("  (no refs or files changed — dry-run)");
        return 0;
      }
      const out = git(["pull", "origin", branch], root);
      console.log(`${smallLogo()} pulled: ${out.split("\n").pop()}`);
      return 0;
    } catch (e) {
      console.error(`pull ${dryRun ? "dry-run " : ""}failed: ${e.message}`);
      return 1;
    }
  }

  if (action === "status") {
    const isRepo = existsSync(join(root, ".git"));
    if (!isRepo) {
      console.log(`${smallLogo()} no sync repo yet at ${root}`);
      console.log("  run: parasite-skill sync --init <repo-url>");
      return 1;
    }
    const remotes = git(["remote", "-v"], root);
    let branch = "main";
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
    } catch {
      /* unborn HEAD */
    }
    const dirty = git(["status", "--porcelain"], root);
    console.log(`${smallLogo()} sync repo: ${root}`);
    console.log(`  branch: ${branch}`);
    console.log(remotes ? `  remote: ${remotes.split("\n")[0]}` : "  remote: none");
    console.log(dirty ? `  changes: ${dirty.split("\n").length} file(s) uncommitted` : "  changes: clean");
    return 0;
  }
  return 0;
}

/**
 * Generates an AGENTS.md in the current project that tells any coding agent
 * which skills exist and how to route requests through parasite-skill.
 */
export function cmdAgents(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const out = args.out || join(process.cwd(), "AGENTS.md");
  const skills = payload.skills.slice().sort((a, b) => a.name.localeCompare(b.name));

  const lines = [];
  lines.push("# AGENTS.md — generated by parasite-skill");
  lines.push("");
  lines.push("This project is wired to the parasite-skill skill ecosystem.");
  lines.push("When you need a capability, route the request instead of guessing:");
  lines.push("");
  lines.push("```");
  lines.push("/parasite-skill --route \"<what you need>\"   # top skills + best skill-set");
  lines.push("/parasite-skill --plan \"<request>\"           # routed execution plan");
  lines.push("```");
  lines.push("");
  lines.push(`## Available skills (${skills.length})`);
  lines.push("");
  for (const s of skills) {
    lines.push(`- **${s.name}** — ${s.description}`);
  }
  lines.push("");
  lines.push("## Always-on cadence");
  lines.push("");
  lines.push("1. **start**: tractatus-thinking → sequential-thinking (decompose the request)");
  lines.push("2. **between tool calls**: doubt-driven-development before non-trivial decisions");
  lines.push("3. **on failure**: debug-thinking / debugging-and-error-recovery");
  lines.push("4. **before prose**: stop-slop");
  lines.push("5. **after milestones**: verification-before-completion + code-review-and-quality");

  writeFileSync(out, lines.join("\n") + "\n", "utf-8");
  console.log(`${smallLogo()} AGENTS.md generated -> ${out}`);
  console.log(`  ${skills.length} skills indexed from ${reg}`);
  return 0;
}
