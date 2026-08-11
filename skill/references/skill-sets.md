# Skill-Sets

Named bundles. One word activates many skills. Set membership matches `scripts/conductor.py` (SETS) and `scripts/router.ts` (SETS). Load order matters: dependencies first, verification last.

## The Sets

| Set | Use for | Load order |
|---|---|---|
| `thinking` | Decompose, reason, doubt | tractatus-thinking, sequential-thinking, 7-scared-circle-clarity, debug-thinking, doubt-driven-development |
| `research` | Verify against real sources | deepwiki, context7, find-docs, web-reader, research, gitingest, source-driven-development |
| `planning` | Idea -> spec -> tasks | interview-me, brainstorming, idea-refine, spec-driven-development, writing-plans, planning-and-task-breakdown, story-quality |
| `build` | Implement in slices | incremental-implementation, api-and-interface-design, system-connector, mcp-builder, tdd, test-driven-development, autonomous-implementation-pattern |
| `docs` | Write + keep docs honest | documentation-writer, documentation-and-adrs, readme-skill, api-docs-skill, internal-comms, stop-slop, docx, pdf, pptx |
| `review` | Gate before merge | code-review-and-quality, code-review-graph, code-simplification, verification-before-completion |
| `frontend` | UI that actually works | frontend-design, frontend-ui-engineering, theme-factory, artifacts-builder, favicon, browser-testing-with-devtools, webapp-testing, playwright-cli, agent-browser |
| `ops` | Ship safely | git-workflow-and-versioning, using-git-worktrees, ci-cd-and-automation, github-actions-docs, shipping-and-launch, observability-and-instrumentation, security-and-hardening |
| `intelligence` | Understand the codebase | ix, understand, code-review-graph, graphify, improve-codebase-architecture, knip |
| `all` | Everything | all skills found in registry.json |

## Combining Sets

Sets compose. Use the multiplicative pattern (per tractatus-thinking): an outcome is a product of skills — missing any factor fails the outcome.

- Specification task: `planning` x `thinking` x `docs`
- Feature implementation: `planning` x `research` x `build` x `review`
- Frontend feature: `planning` x `frontend` x `build` x `review`
- Debugging session: `thinking` x `intelligence` x `review`
- Release: `build` x `ops` x `review`

## Applying a Set

```
python scripts/conductor.py --sets --apply planning
bun scripts/router.ts --sets --apply planning
```

`--apply` prints the ordered load sequence. The agent then loads each via the `skill` tool in that order and applies the always-on cadence (references/always-on.md) around execution.
