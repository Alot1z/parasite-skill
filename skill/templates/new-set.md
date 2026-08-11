# New Skill-Set Template

Use this checklist to design a new skill-set. A set is a *routed workflow*, not a
folder of skills: every member should earn its place by covering a distinct phase
of the outcome the set is named after.

## 1. Pick an outcome (not a pile)

A good set name is an outcome: `plan-execute`, `research-deep`, `safe-launch`.
Weak names are piles: `misc`, `helpers`, `useful-things`.

## 2. Cover the phases in order

Each member should map to one phase. Common phases:

| Phase | Typical skills |
|---|---|
| Understand the request | interview-me, brainstorming, 7-scared-circle-clarity |
| Reason about it | tractatus-thinking, sequential-thinking, doubt-driven-development |
| Verify with real sources | deepwiki, context7, find-docs, source-driven-development |
| Turn it into a plan | spec-driven-development, writing-plans, planning-and-task-breakdown |
| Execute in slices | incremental-implementation, test-driven-development, tdd |
| Review + gate | code-review-and-quality, verification-before-completion |
| Ship + monitor | shipping-and-launch, observability-and-instrumentation |

## 3. Size rules

- 3–8 members. Fewer is fine; more than 8 means it is really two sets.
- Every member must be an *installed* skill or a real one you intend to install.
- No duplicates with an existing set unless the phase genuinely differs.

## 4. Define it

Add to `src/data/sets.js` (single source of truth — engine, CLI, and MCP all
read it):

```js
your-set-name: {
  desc: "Outcome this set produces",
  members: ["skill-a", "skill-b", "skill-c"],
},
```

Then regenerate: `parasite-skill scan` (or `--force`) and `parasite-skill wikis`.

## 5. Validate

```bash
parasite-skill sets                 # shows your set + install coverage
parasite-skill route "a task for your set" --set your-set-name
parasite-skill wikis                # rebuilds the wiki with the new set
```

## Starter sets worth copying

- `brainstorm-max` — interview-me, brainstorming, idea-refine, 7-scared-circle-clarity, doubt-driven-development
- `plan-execute` — writing-plans, planning-and-task-breakdown, spec-driven-development, incremental-implementation, autonomous-implementation-pattern, test-driven-development
- `research-deep` — deepwiki, context7, find-docs, web-reader, source-driven-development, gitingest
- `thinking-max` — tractatus-thinking, sequential-thinking, doubt-driven-development, debug-thinking, verification-before-completion
- `mega-injector` — system-connector, mcp-builder, api-and-interface-design, security-and-hardening, cli-anything, computer-use
- `token-saver` — agent-token-optimizer, context-engineering, prompt-optimizer, stop-slop, workspace-memory
