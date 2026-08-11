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
| `--sets [--apply NAME]` | List skill-sets, or print the exact load order for one set |
| `--plan "<request>"` | Route + best set -> phased execution plan with verification gates |
| `--refs [--per-skill]` | Generate ref docs (central; `--per-skill` also copies into each skill dir) |
| `--wikis` | Generate the wiki: Home, Categories, Skills, SkillSets, MultiplicativePairs, graph |
| `--trace [file]` | Count skill usage in a session transcript |
| `--link [--unlink]` | Create adaptive links (junction/symlink + `.skill-router.links.json` manifest) so each skill dir points at its refs/wikis. Add `--no-default` to touch only `--dirs` paths (safe for sandbox tests) |
| `--dirs a,b` | Scan extra directories (e.g. a project's `.agents/skills`) |
| `--json` | Machine-readable output for the AI layer |
| `--force` | Force a rescan / force re-loading always-on skills mid-session |

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
