# Always-On Cadence

Thinking skills are re-invoked throughout execution — not once at the start. Skills are read fresh from disk on every `skill` tool load, so re-invocation always re-reads current content.

## The Three Phases

### START — before any tool use

Run in order:

1. `tractatus-thinking` — decompose the request into atomic propositions. If you cannot write the request as a proposition tree, you do not understand it yet.
2. `sequential-thinking` — build a thought chain: observation -> analysis -> decomposition -> synthesis -> conclusion, with honest confidence.
3. Research the domain: `deepwiki` (repo Q&A) or `context7`/`find-docs` (library docs) for any framework, API, or service involved. Do not trust training memory for API details.

Output: a 3-line plan statement (what, why, how) before the first tool call.

### BETWEEN — before and after each tool call

- **Before a non-trivial decision:** re-invoke `doubt-driven-development`. If the decision adds branching logic, crosses a boundary, or asserts something the type system can't check, run a doubt cycle (CLAIM -> EXTRACT -> DOUBT -> RECONCILE -> STOP).
- **When a tool fails or returns unexpected output:** re-invoke `debug-thinking` to record the hypothesis, then `debugging-and-error-recovery` to reproduce -> localize -> fix -> guard.
- **When the conversation drifts or quality drops:** re-invoke `context-engineering`; re-anchor on the rules/spec/source hierarchy.
- **Before any prose block (summary, docs, explanation):** re-invoke `stop-slop`; score directness/rhythm/trust/authenticity/density; revise below 35/50.
- **Before every edit:** verify context is current (`--force` re-loads the always-on set).

### AFTER — at each milestone

1. `verification-before-completion` — the Iron Law: no completion claim without fresh evidence. Run the actual command; read the output; only then claim.
2. `code-review-and-quality` — five-axis review of changed artifacts.
3. If decisions were made: `documentation-and-adrs` to record the why.

## Cadence Rules

| Rule | Behavior |
|---|---|
| R1 | Thinking skills load at START; never start executing without the decomposition |
| R2 | Between tool calls, re-invoke the relevant thinking skill — do not continue on stale reasoning |
| R3 | `--force` mid-session re-loads: tractatus-thinking, sequential-thinking, doubt-driven-development, debug-thinking, stop-slop, verification-before-completion |
| R4 | Every milestone ends with verification; every final message ends with the AFTER set |
| R5 | If the user invokes `/parasite-skill`, the cadence applies to the routed task too |

## Token Budget

Every `skill` tool load injects that skill's full document into the session, so blind re-invocation is the biggest token cost in this cadence. Rules:

| Rule | Behavior |
|---|---|
| T1 | Load each thinking skill **once per phase**. Between tool calls, *apply* the already-loaded method; do not re-load the same doc. |
| T2 | Extract only the section the current step needs (e.g. the doubt cycle, not the full 243-line document). Never re-inject a doc you already hold in context. |
| T3 | Re-load only on phase change, local source change, or explicit `--force`. |
| T4 | If a thinking skill's body is longer than ~120 lines, summarize its method into one or two sentences after the first load and keep working from that. |
| T5 | The final summary states the outcome, not the cadence. Do not narrate which skills were loaded. |

This is not a license to skip thinking — it caps the cost of loading it.

## Why

Context degrades. Assumptions silently become facts. Applying thinking skills between tool calls re-grounds the session and catches wrong directions while course-correction is cheap (per doubt-driven-development and context-engineering).
