---
name: skill-router
description: Routes any request to the right skills and skill-sets, scans the whole skill ecosystem, validates skills against the official spec, generates refs/wikis with adaptive links, and enforces an always-on thinking-skill cadence before, between, and after every tool call. Use when the user asks which skills to use, wants a skill execution plan, wants a skill-set activated, wants the ecosystem analyzed or refs/wikis generated, or invokes /skill-router with flags like --route, --plan, --scan, --validate, --refs, --wikis, --sets, --trace, --link, --force.
metadata:
  version: 1.0.0
  registry: ~/.agents/skills/.skill-router/
  languages: python, typescript
---

# Skill Router

One entry point for the whole skill ecosystem. Instead of manually typing each skill, invoke this skill and let the engine (plus your judgment) choose, order, and re-activate skills during execution.

## When to Use

- User asks "which skills should I use for X?"
- User wants a routed execution plan for a request
- User wants a skill-set activated (planning + docs, thinking + research, ...)
- User wants the ecosystem re-analyzed, validated, or documented (refs/wikis)
- User wants skills linked so every skill dir points at its refs/wikis
- User wants a trace of which skills a session actually used

## Invocation and Flags

Run the engine: `python scripts/conductor.py <command> [flags]` (Python twin) or the package CLI `skill-router <command>` (Bun/Node, via `bunx skill-router` / `npx skill-router`). Both share the same `registry.json`.

| Flag | What it does |
|---|---|
| `--scan` | Re-analyze all skills (user + Claude Code + project dirs), rebuild registry |
| `--validate` | Check every skill against the official spec (name=dirname, description 1-1024 chars, name format) |
| `--route "<idea>"` | Score every skill against the idea text, return top-N + best skill-set |
| `--route "<idea>" --set <name>` | Route within a specific skill-set only (filters results to members of that set) |
| `--sets [--apply NAME]` | List skill-sets, or print the exact load order for one set |
| `--plan "<request>"` | Route + best set -> phased execution plan with verification gates |
| `--refs [--per-skill]` | Generate ref docs (central; `--per-skill` also copies into each skill dir) |
| `--wikis` | Generate the wiki: Home, Categories, Skills, SkillSets, MultiplicativePairs, graph |
| `--trace [file]` | Count skill usage in a session transcript |
| `--link [--unlink]` | Create adaptive links (junction/symlink + `.skill-router.links.json` manifest) so each skill dir points at its refs/wikis. Add `--no-default` to touch only `--dirs` paths (safe for sandbox tests) |
| `--dirs a,b` | Scan extra directories (e.g. a project's `.agents/skills`) |
| `--json` | Machine-readable output for the AI layer |
| `--force` | Force a rescan / force re-loading always-on skills mid-session |
| `--graph [--dot|--mmd]` | Emit a skill-relatedness graph (Jaccard over keywords; DOT or Mermaid) |
| `--sets --new NAME --members a,b` | Create a custom skill-set (persisted to sets.custom.json) |
| `--sets --add NAME:member` | Add a skill to a custom set |
| `--sets --remove NAME:member` | Remove a skill from a custom set |
| `--sets --delete NAME` | Delete a custom set (built-ins cannot be deleted) |
| `--mcp add/remove/list` | Auto-register the skill-router MCP server in client configs — no manual config |
| `--sync --init/--push/--pull` | Cloud-sync the skills tree to a git remote (backup + restore across machines) |
| `--refresh` | Update all installed copies with the latest SKILL.md |
| `--agents` | Generate AGENTS.md for the current project from the registry |
| `--bundle` | Build a tarball + install.json for GitHub Pages (no-npm distribution) |
| `parasite --status/--add/--toggle/--remove` | Manage runtime extensions that enhance skills, agents, hooks, and MCP servers **without modifying their source** (extension folders + manifest; fully toggleable and removable) |

## The Routing Process

Follow these steps in order whenever routing is requested:

1. **SCAN** — Run `--scan` (or reuse a fresh registry). Know the full inventory before choosing.
2. **DECOMPOSE** — Apply `tractatus-thinking`: break the request into atomic propositions ("What is X?"). Decompose first, route second.
3. **ROUTE** — Run `--route "<idea>"`. Take the deterministic top-N as a *hypothesis*, not a verdict.
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
| `all` | Everything | all registered skills |

## Routing Within a Set

Use `--set <name>` to constrain routing to a specific skill-set. This is useful when you know which category of skills you need:

```bash
# Route within the 'build' set only
skill-router route "implement user authentication" --set build

# Route within the 'frontend' set only
skill-router route "create a responsive dashboard" --set frontend
```

The `--set <name>` flag filters the results to only include skills that are members of the specified set. This is different from `--sets --apply NAME` which just prints the load order.

## Custom Skill-Sets

Create your own skill-sets for project-specific workflows. Custom sets are persisted to `sets.custom.json` in the registry directory.

```bash
# Create a new custom set
skill-router sets --new my-project --members "brainstorming,spec-driven-development,incremental-implementation" --desc "My project workflow"

# Add a skill to an existing set
skill-router sets --add my-project:code-review-and-quality

# Remove a skill from a set
skill-router sets --remove my-project:code-review-and-quality

# Delete a custom set
skill-router sets --delete my-project
```

Custom sets appear with a `*` marker in the sets listing. Built-in sets cannot be deleted, but you can create copies with `--new` and modify those.

Project sets (from `skill-router.json`) appear with a `(project)` marker. They override any same-named set (built-in or custom) while the config is present, are never written to `sets.custom.json`, and are edited by changing the config file — not the `--new/--add/--remove/--delete` editor.

## Project Configuration

Each project can define its own defaults via a `skill-router.json` (or `.skill-router.json`) file in the project root. The config is loaded automatically and merged with CLI flags (CLI flags take precedence).

### Config File Location

The CLI walks up the directory tree from the current working directory to find a config file. This means you can put it in your project root and it will be found from any subdirectory.

### Config File Format

```json
{
  "registry": "./.skill-router/registry.json",
  "dirs": ["./skills", "./.agents/skills"],
  "defaultSet": "build",
  "force": false,
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
|---|---|---|---|
| `registry` | Path to the registry directory (overrides default) | `"./.skill-router"` |
| `dirs` | Comma-separated scan directories | `"./skills,./.agents/skills"` |
| `defaultSet` | Default skill-set to use for routing | `"build"` |
| `force` | Force rescan on every run | `true` |
| `sets` | Project-defined skill-sets, merged into routing/planning/sets (override any same-named set — built-in or custom; marked `(project)` in listings) | `{"proj-qa": {"desc": "...", "members": ["..."]}}` |

### Example: Project-Specific Workflow

Create `skill-router.json` in your project root:

```json
{
  "dirs": ["./.agents/skills", "./skills"],
  "defaultSet": "build"
}
```

Now `skill-router route "implement auth"` will automatically use the `build` set and scan your project's skill directories.

### Environment Variable

`SKILL_ROUTER_HOME` overrides the home base for the registry, installs, sync, MCP, and every command — full environment isolation for sandboxes and tests:

```bash
SKILL_ROUTER_HOME=/tmp/sandbox skill-router scan   # everything stays in /tmp/sandbox
SKILL_ROUTER_HOME=/tmp/sandbox skill-router route "idea"
```

Set `SKILL_ROUTER_VERBOSE=1` to see which config file is being loaded:

```bash
SKILL_ROUTER_VERBOSE=1 skill-router route "implement auth"
# Output: Using project config from: /path/to/project/skill-router.json
```

## Refreshing Installed Copies

When you update the source `skill/SKILL.md` (e.g., to add new documentation), use `--refresh` to update all installed copies across your AI clients:

```bash
# Refresh all installed instances
skill-router refresh

# Refresh with verbose output
SKILL_ROUTER_VERBOSE=1 skill-router refresh
```

This updates every installed instance with the latest SKILL.md without requiring you to remember which clients you installed to. The command:
- Finds all installed instances (both user-level and project-level)
- Overwrites them with the latest source
- Preserves the original install mode (copy or link)
- Verifies each update succeeded

Use `--agent <ids>` to refresh only specific clients:

```bash
skill-router refresh --agent claude-code,cursor
```

## Parasite Extension System

The parasite system enables runtime injection without modifying source code. It creates extension folders for each client and provides build-time hooks, server wrappers, and traceability protection.

### Core Concepts

- **Runtime Injection**: Add enhancements that run at startup without touching original files
- **Extension Folders**: Each client gets a `.skill-router-extensions/` directory
- **Build-time Hooks**: Generate Vite/webpack plugins for build-time injection
- **Server Wrapping**: Wrap upstream servers with enhancement layers
- **Traceability Protection**: Obfuscate extracted code to prevent tracing

### Commands

```bash
# Show injection status for all clients
skill-router parasite --status

# Add a runtime injection
skill-router parasite --add --agent claude-code --type hook --code "console.log('active')"

# Toggle an injection on/off
skill-router parasite --toggle injection-1234567890 --enable

# Remove an injection
skill-router parasite --remove injection-1234567890

# Generate Vite build hook
skill-router parasite --hook vite --out vite-plugin.js

# Generate webpack build hook
skill-router parasite --hook webpack --out webpack-plugin.js

# Generate server wrapper
skill-router parasite --wrap --server ./upstream-server.js --out wrapped-server.js

# Protect code traceability
skill-router parasite --protect --file input.js --level medium --out protected.js
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

The deterministic scorer is keyword/IDF-based. It cannot read intent. After `--route` output:

1. Treat scores as ranked hypotheses. A skill missing from the list may still be right.
2. Verify each candidate: exists in registry, project-override rules applied, description actually matches the request's semantics.
3. Reason about the *type* of request (analysis vs implementation vs research vs writing) and weight skill-sets accordingly.
4. Present the final plan with rationale: "using `thinking` + `docs` because the request is a specification task".
5. Execute with the cadence, re-invoking thinking skills between tool calls, not only at the start.

## Registry, Refs, Wikis, Links

- **Registry:** `~/.agents/skills/.skill-router/registry.json` — single source of truth, shared by Python and TypeScript engines.
- **Refs:** `refs/index.md` + `refs/<skill>/index.md` (generated from templates/ref-skill.md).
- **Wikis:** `wikis/Home.md`, `wikis/Categories.md`, `wikis/Skills.md`, `wikis/SkillSets.md`, `wikis/MultiplicativePairs.md`, `wikis/graph.dot`, `wikis/graph.mmd`.
- **Links:** `--link` creates, per skill dir, a `refs` and `wiki` junction/symlink into the central registry plus a `.skill-router.links.json` manifest (the portable fallback). This gives every skill dir live pointers without hardcoding content into vendor skills.

## Verification

- [ ] Registry scanned from all configured dirs; project skills override user skills
- [ ] Route output verified against the request semantics, not copied blindly
- [ ] Chosen skills exist in the registry
- [ ] Cadence followed: thinking skills re-invoked START / BETWEEN / AFTER, not once
- [ ] Refs/wikis generated or explicitly not requested
- [ ] `--validate` issues (name mismatch, missing description) surfaced to the user
