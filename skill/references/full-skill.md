---
name: parasite-skill
description: Routes any request to the right skills and skill-sets, scans the whole skill ecosystem, validates skills against the official spec, generates refs/wikis with adaptive links, and enforces an always-on thinking-skill cadence before, between, and after every tool call. Use when the user asks which skills to use, wants a skill execution plan, wants a skill-set activated, wants the ecosystem analyzed or refs/wikis generated, or invokes /parasite-skill with flags like --route, --plan, --scan, --validate, --refs, --wikis, --sets, --trace, --link, --force.
metadata:
  version: 1.0.0
  registry: ~/.agents/skills/.parasite-skill/
  languages: python, typescript
---

# Parasite Skill

One entry point for the whole skill ecosystem. Instead of manually typing each skill, invoke this skill and let the engine (plus your judgment) choose, order, and re-activate skills during execution.

## When to Use

- User asks "which skills should I use for X?"
- User wants a routed execution plan for a request
- User wants a skill-set activated (planning + docs, thinking + research, ...)
- User wants the ecosystem re-analyzed, validated, or documented (refs/wikis)
- User wants skills linked so every skill dir points at its refs/wikis
- User wants a trace of which skills a session actually used

## Invocation and Flags

Run the engine: `python scripts/conductor.py <command> [flags]` (Python twin) or the package CLI `parasite-skill <command>` (Bun/Node, via `bunx parasite-skill` / `npx parasite-skill`). Both share the same `registry.json`.

| Flag | What it does |
|---|---|
| `--scan` | Re-analyze all skills (user + Claude Code + project dirs), rebuild registry |
| `--validate` | Check every skill against the official spec (name=dirname, description 1-1024 chars, name format) |
| `--route "<idea>"` | Score every skill against the idea text (name + description keywords at full weight, SKILL.md body keywords at half weight), return top-N + best skill-set |
| `--route "<idea>" --set <name>` | Route within a specific skill-set only (filters results to members of that set) |
| `--sets [--apply NAME]` | List skill-sets, or print the exact load order for one set |
| `--plan "<request>"` | Route + best set -> phased execution plan with verification gates |
| `--refs [--per-skill]` | Generate ref docs (central; `--per-skill` also copies into each skill dir) |
| `--wikis` | Generate the wiki: Home, Categories, Skills, SkillSets, MultiplicativePairs, graph |
| `--trace [file]` | Count skill usage in a session transcript |
| `--link [--unlink]` | Create adaptive links (junction/symlink + `.parasite-skill.links.json` manifest) so each skill dir points at its refs/wikis. Add `--no-default` to touch only `--dirs` paths (safe for sandbox tests) |
| `--dirs a,b` | Scan extra directories (e.g. a project's `.agents/skills`) |
| `--json` | Machine-readable output for the AI layer |
| `--force` | Force a rescan / force re-loading always-on skills mid-session |
| `--graph [--dot|--mmd]` | Emit a skill-relatedness graph (Jaccard over keywords; DOT or Mermaid) |
| `--sets --new NAME --members a,b` | Create a custom skill-set (persisted to sets.custom.json) |
| `--sets --add NAME:member` | Add a skill to a custom set |
| `--sets --remove NAME:member` | Remove a skill from a custom set |
| `--sets --delete NAME` | Delete a custom set (built-ins cannot be deleted) |
| `--mcp add/remove/list` | Auto-register the parasite-skill MCP server in client configs — no manual config |
| `--sync --init/--push/--pull` | Cloud-sync the skills tree to a git remote (backup + restore across machines) |
| `--refresh` | Update all installed copies with the latest SKILL.md |
| `--agents` | Generate AGENTS.md for the current project from the registry |
| `--bundle` | Build a tarball + install.json for GitHub Pages (no-npm distribution) |
| `parasite --status/--add/--toggle/--remove` | Manage runtime extensions that enhance skills, agents, hooks, and MCP servers **without modifying their source** (extension folders + manifest; fully toggleable and removable) |
| `export` | Inventory the whole ecosystem (skills, sets, clients, parasite extensions, MCP, rules) into `ECOSYSTEM.md` (human-ready) + `ecosystem.json` (LLM-ready) — know everything installed without rescanning. Paths/names only, no contents |
| `--sets --template` | Print the new-set design template (phases, sizing rules, starter sets) |

## The Routing Process

Follow these steps in order whenever routing is requested:

1. **SCAN** — Run `--scan` (or reuse a fresh registry). Know the full inventory before choosing.
2. **DECOMPOSE** — Apply `tractatus-thinking`: break the request into atomic propositions ("What is X?"). Decompose first, route second.
3. **ROUTE** — Run `--route "<idea>"`. The scorer matches name + description keywords at full weight and SKILL.md body keywords at half weight, so a skill with a thin description but a rich body still surfaces. Take the deterministic top-N as a *hypothesis*, not a verdict.
4. **JUDGE** — Apply the AI layer (below). Adjust the selection with semantic reasoning, then confirm the chosen skills exist in `registry.json` (project skills override user skills with the same name).
5. **PLAN + EXECUTE** — Run `--plan "<request>"` for the skeleton, then execute the plan while following the always-on cadence from `references/always-on.md`.

## Always-On Cadence (Thinking Multiple Times Per Request)

Thinking skills are not used once at the start. They are re-invoked throughout. The cadence is mandatory, full detail in `references/always-on.md`:

- **START (before tool use):** `tractatus-thinking` (decompose) -> `sequential-thinking` (chain) -> `deepwiki`/`context7` (verify domain facts)
- **BETWEEN tool calls:** `doubt-driven-development` before every non-trivial decision; `debug-thinking` when a step fails; `context-engineering` when context drifts; `stop-slop` before any prose
- **AFTER each milestone:** `verification-before-completion` (evidence before claims) -> `code-review-and-quality` on changed artifacts
- **`--force`** re-invokes the `skill` tool for the always-on set at the current phase — skills are read fresh from disk each load, so re-invocation re-reads them.

## Skill-Sets

Named bundles so one word activates many skills. Full table in `references/skill-sets.md`; quick list:

| Set | Use for | Core members |
|---|---|---|
| `thinking` | Decompose + reason + doubt | tractatus-thinking, sequential-thinking, doubt-driven-development, debug-thinking |
| `research` | Verify against real sources | deepwiki, context7, find-docs, web-reader, source-driven-development |
| `planning` | Idea -> spec -> tasks | brainstorming, spec-driven-development, writing-plans, planning-and-task-breakdown |
| `build` | Implement in slices | incremental-implementation, api-and-interface-design, system-connector, tdd |
| `docs` | Write + keep docs honest | documentation-writer, readme-skill, stop-slop, documentation-and-adrs |
| `review` | Gate before merge | code-review-and-quality, verification-before-completion, code-simplification |
| `frontend` | UI that actually works | frontend-ui-engineering, frontend-design, browser-testing-with-devtools |
| `ops` | Ship safely | ci-cd-and-automation, shipping-and-launch, observability-and-instrumentation |
| `intelligence` | Understand the codebase | ix, understand, code-review-graph, knip |
| `brainstorm-max` | Interview -> diverge -> converge -> doubt | interview-me, brainstorming, idea-refine, 7-scared-circle-clarity, doubt-driven-development |
| `plan-execute` | Spec -> plan -> slice -> test -> land | writing-plans, planning-and-task-breakdown, spec-driven-development, incremental-implementation, test-driven-development |
| `research-deep` | Live docs + source-grounded verification | deepwiki, context7, find-docs, web-reader, source-driven-development |
| `thinking-max` | Full before/during/after thinking cadence | tractatus-thinking, sequential-thinking, doubt-driven-development, debug-thinking, verification-before-completion |
| `mega-injector` | Connect, wrap, inject, extend anything | system-connector, mcp-builder, api-and-interface-design, security-and-hardening, cli-anything, computer-use |
| `token-saver` | Max token + context efficiency | agent-token-optimizer, context-engineering, prompt-optimizer, stop-slop |
| `all` | Everything | all registered skills |

## Routing Within a Set

Use `--set <name>` to constrain routing to a specific skill-set. This is useful when you know which category of skills you need:

```bash
# Route within the 'build' set only
parasite-skill route "implement user authentication" --set build

# Route within the 'frontend' set only
parasite-skill route "create a responsive dashboard" --set frontend
```

The `--set <name>` flag filters the results to only include skills that are members of the specified set. This is different from `--sets --apply NAME` which just prints the load order.

## Custom Skill-Sets

Create your own skill-sets for project-specific workflows. Custom sets are persisted to `sets.custom.json` in the registry directory.

```bash
# Create a new custom set
parasite-skill sets --new my-project --members "brainstorming,spec-driven-development,incremental-implementation" --desc "My project workflow"

# Add a skill to an existing set
parasite-skill sets --add my-project:code-review-and-quality

# Remove a skill from a set
parasite-skill sets --remove my-project:code-review-and-quality

# Delete a custom set
parasite-skill sets --delete my-project
```

Custom sets appear with a `*` marker in the sets listing. Built-in sets cannot be deleted, but you can create copies with `--new` and modify those.

Project sets (from `parasite-skill.json`) appear with a `(project)` marker. They override any same-named set (built-in or custom) while the config is present, are never written to `sets.custom.json`, and are edited by changing the config file — not the `--new/--add/--remove/--delete` editor.

## Project Configuration

Each project can define its own defaults via a `parasite-skill.json` (or `.parasite-skill.json`) file in the project root. The config is loaded automatically and merged with CLI flags (CLI flags take precedence).

### Config File Location

The CLI walks up the directory tree from the current working directory to find a config file. This means you can put it in your project root and it will be found from any subdirectory.

### Config File Format

```json
{
  "registry": "./.parasite-skill/registry.json",
  "dirs": ["./skills", "./.agents/skills"],
  "defaultSet": "build",
  "force": false,
  "enabledSets": ["build", "review"],
  "excludeSkills": ["skill-i-never-want"],
  "route": { "top": 8, "minScore": 0 },
  "env": { "GSM_API_URL": "http://localhost:3000" },
  "parasite": { "enabled": true, "clients": ["claude-code", "cursor"] },
  "clients": ["claude-code", "cursor"],
  "sets": {
    "proj-qa": {
      "desc": "project QA workflow",
      "members": ["verification-before-completion", "code-review-and-quality"]
    }
  }
}
```

### Config Options

| Option | Description | Example |
|---|---|---|
| `registry` | Path to the registry directory (overrides default) | `"./.parasite-skill"` |
| `dirs` | Scan directories (array or comma-separated string) | `["./skills", "./.agents/skills"]` |
| `defaultSet` | Default skill-set to use for routing (same as `--set NAME`) | `"build"` |
| `force` | Force rescan on every run | `true` |
| `sets` | Project-defined skill-sets, merged into routing/planning/sets (override any same-named set — built-in or custom; marked `(project)` in listings; edited only via the config file, never the `--new/--add/--remove/--delete` editor) | `{"proj-qa": {"desc": "...", "members": ["..."]}}` |
| `enabledSets` | **Route-within-set at the project level**: routing only considers members of these sets (union) | `["build", "review"]` |
| `excludeSkills` | Skills that are never routed to in this project (blacklist) | `["skill-i-never-want"]` |
| `route` | Default scoring knobs: `top` (default top-N) and `minScore` (drop scores below the floor). CLI `--top` wins | `{"top": 8, "minScore": 0}` |
| `env` | **Per-project env isolation**: key/value pairs exposed as `ctx.env` and baked into generated parasite hooks/wrappers. Never mutates your shell; for full sandbox isolation of the whole package use `PARASITE_SKILL_HOME` | `{"GSM_API_URL": "http://localhost:3000"}` |
| `parasite` | **Per-project toggle for the enhancement layer**: `false` disables runtime injections in this project ("able not to use it"); `{ "enabled": true, "clients": [...] }` restricts which clients are touched | `{ "enabled": true, "clients": ["claude-code", "cursor"] }` |
| `clients` | Project-wide client allowlist: only these clients are managed by install/refresh/parasite/export in this project | `["claude-code", "cursor"]` |

CLI flags always take precedence over config values. The config is found by walking up from the current directory, so one file in the project root covers every subdirectory. `export` records the active project config (sets, enabledSets, excludeSkills, parasite state, env key names, client allowlist) in `ECOSYSTEM.md` + `ecosystem.json` — paths and key names only, never values of `env` entries.

### Example: Project-Specific Workflow

Create `parasite-skill.json` in your project root:

```json
{
  "dirs": ["./.agents/skills", "./skills"],
  "defaultSet": "build",
  "enabledSets": ["build", "review"],
  "excludeSkills": ["obsolete-skill"],
  "parasite": false
}
```

Now `parasite-skill route "implement auth"` will automatically use the `build` set, only ever route within `build` ∪ `review`, never suggest `obsolete-skill`, scan your project's skill directories — and the runtime enhancement layer is fully off for this project. Flip `"parasite": true` to re-enable it without touching any other project's setup.

### Environment Variable

`PARASITE_SKILL_HOME` overrides the home base for the registry, installs, sync, MCP, and every command — full environment isolation for sandboxes and tests:

```bash
PARASITE_SKILL_HOME=/tmp/sandbox parasite-skill scan   # everything stays in /tmp/sandbox
PARASITE_SKILL_HOME=/tmp/sandbox parasite-skill route "idea"
```

Set `PARASITE_SKILL_VERBOSE=1` to see which config file is being loaded:

```bash
PARASITE_SKILL_VERBOSE=1 parasite-skill route "implement auth"
# Output: Using project config from: /path/to/project/parasite-skill.json
```

## Refreshing Installed Copies

When you update the source `skill/SKILL.md` (e.g., to add new documentation), use `--refresh` to update all installed copies across your AI clients:

```bash
# Refresh all installed instances
parasite-skill refresh

# Refresh with verbose output
PARASITE_SKILL_VERBOSE=1 parasite-skill refresh
```

This updates every installed instance with the latest SKILL.md without requiring you to remember which clients you installed to. The command:
- Finds all installed instances (both user-level and project-level)
- Overwrites them with the latest source
- Preserves the original install mode (copy or link)
- Verifies each update succeeded

Use `--agent <ids>` to refresh only specific clients:

```bash
parasite-skill refresh --agent claude-code,cursor
```

## Parasite Extension System

The parasite system enables runtime injection without modifying source code. It creates extension folders for each client and provides build-time hooks, server wrappers, and traceability protection.

### Core Concepts

- **Runtime Injection**: Add enhancements that run at startup without touching original files
- **Extension Folders**: Each client gets a `.parasite-skill-extensions/` directory
- **Build-time Hooks**: Generate Vite/webpack plugins for build-time injection
- **Server Wrapping**: Wrap upstream servers with enhancement layers
- **Traceability Protection**: Obfuscate extracted code to prevent tracing

### Commands

```bash
# Show injection status for all clients
parasite-skill parasite --status

# Add a runtime injection
parasite-skill parasite --add --agent claude-code --type hook --code "console.log('active')"

# Toggle an injection on/off
parasite-skill parasite --toggle injection-1234567890 --enable

# Remove an injection
parasite-skill parasite --remove injection-1234567890

# Generate Vite build hook
parasite-skill parasite --hook vite --out vite-plugin.js

# Generate webpack build hook
parasite-skill parasite --hook webpack --out webpack-plugin.js

# Generate server wrapper
parasite-skill parasite --wrap --server ./upstream-server.js --out wrapped-server.js

# Protect code traceability
parasite-skill parasite --protect --file input.js --level medium --out protected.js
```

### Injection Types

| Type | Description |
|---|---|
| `pre-init` | Runs before client initialization |
| `post-init` | Runs after client initialization |
| `middleware` | Adds HTTP middleware |
| `hook` | Wraps existing functions |

### Traceability Protection Levels

| Level | Description |
|---|---|
| `light` | Remove comments, minify whitespace |
| `medium` | Rename variables, add dead code |
| `heavy` | Full obfuscation with control flow flattening |

### How It Works

1. **Extension folders** are created in each client's skills directory
2. **Injections** are stored as separate files, never modifying originals
3. **Manifests** track all injections and their state
4. **Build hooks** generate plugin code for Vite/webpack
5. **Server wrappers** create enhancement layers around upstream servers
6. **Traceability protection** obfuscates extracted code

### Data Privacy

- All injections are stored locally
- No data is shared externally
- Extensions are toggleable and removable
- Original source code is never modified

## The AI Layer (Your Judgment)

The deterministic scorer is keyword/IDF-based over two signal layers: name + description keywords (full weight) and SKILL.md body keywords (half weight, 3+ char tokens only). A thin description no longer hides a rich skill. It still cannot read intent. After `--route` output:

1. Treat scores as ranked hypotheses. A skill missing from the list may still be right.
2. Verify each candidate: exists in registry, project-override rules applied, description actually matches the request's semantics.
3. Reason about the *type* of request (analysis vs implementation vs research vs writing) and weight skill-sets accordingly.
4. Present the final plan with rationale: "using `thinking` + `docs` because the request is a specification task".
5. Execute with the cadence, re-invoking thinking skills between tool calls, not only at the start.

## Current Command Surface

The SKILL.md injection carries only the 5 core commands. The full surface:

```bash
parasite-skill scan [--dirs a,b] [--force]
parasite-skill compose "<request>" [--top N] [--json]
parasite-skill route "<idea>" [--top N] [--set NAME] [--json]
parasite-skill plan "<request>" [--top N] [--json]
parasite-skill validate | doctor [--json]
parasite-skill refs [--per-skill] | wikis | export [--public] [--json]
parasite-skill link [--unlink] | mcp add|remove|list | sync --push|--pull [--dry-run]
parasite-skill tools list|run|run-batch|verify|audit|docs|policy|history|ledger|gc
parasite-skill agents list|show <profile> | agents run <profile> "<request>" [--dry-run] [--strict] [--json]
parasite-skill llm "<request>" [--tool-dry-run] [--json]
parasite-skill site build [--out public] | site validate
```

- `tools` exposes skill scripts as callable AI tools (MCP: `skill_tools_list/run/audit`). Tools execute only on explicit invocation — never from routing alone. Policy gate: `parasite-skill.json` `tools` block (`allow`/`deny`/`env`/`timeoutMs`, `scoped` per `profile:`/`sets:`); skills can declare `tools:` frontmatter with `argsSchema`; `--json-args` validates before running (exit 3 on invalid).
- `tools gc` prunes stale reports/ledger by age/keep; project `gc` TTL policy (`ageDays`, `keep`, `ledger`, `auto`, `intervalDays`) is the default; `tools gc --status` shows posture; `tools ledger --stats|--export|--purge` manages the audit ledger (corrupt lines exit 2).
- `doctor` runs the CI gates locally: spec, tool readiness, baseline, config parse, MCP registration, ledger integrity, registry freshness.
- `agents run` executes a profile workflow, writes a report; `--dry-run` previews, `--strict` fails on blocked tools, `--min-tools N` gates on success count.
- `llm` does bounded native tool-calling against an external OpenAI-compatible endpoint (opt-in, HTTPS, `--allow-remote`), `--tool-dry-run` previews, `--json` returns a `tool_calls` trace.
- `export` records the tool inventory, gc posture, and sync backup state; `--public` strips filesystem paths.
- `site build` generates the static docs site (skills/tools/agents/clients/mcp/hooks + guides/reference/changelog + wiki), with search, `llms.txt`/`llms-full.txt`, sitemap/robots, route manifest, and link validation; `site validate` gates a build.

## Registry, Refs, Wikis, Links

- **Registry:** `~/.agents/skills/.parasite-skill/registry.json` — single source of truth, shared by Python and TypeScript engines.
- **Refs:** `refs/index.md` + `refs/<skill>/index.md` (generated from templates/ref-skill.md).
- **Wikis:** `wikis/Home.md`, `wikis/Categories.md`, `wikis/Skills.md`, `wikis/SkillSets.md`, `wikis/MultiplicativePairs.md`, `wikis/graph.dot`, `wikis/graph.mmd`.
- **Links:** `--link` creates, per skill dir, a `refs` and `wiki` junction/symlink into the central registry plus a `.parasite-skill.links.json` manifest (the portable fallback). This gives every skill dir live pointers without hardcoding content into vendor skills.

## Verification

- [ ] Registry scanned from all configured dirs; project skills override user skills
- [ ] Route output verified against the request semantics, not copied blindly
- [ ] Chosen skills exist in the registry
- [ ] Cadence followed: thinking skills re-invoked START / BETWEEN / AFTER, not once
- [ ] Refs/wikis generated or explicitly not requested
- [ ] `--validate` issues (name mismatch, missing description) surfaced to the user
