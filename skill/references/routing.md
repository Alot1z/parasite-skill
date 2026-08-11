# Routing

Deterministic scoring plus an AI judgment layer. The engine produces ranked hypotheses; the agent produces the decision.

## Scoring Algorithm (deterministic)

1. **Tokenize** the idea text: lowercase, split on non-alphanumerics, drop stopwords, drop 1-char tokens.
2. **Index** each skill: keyword set = name tokens + description tokens + tag words, plus body tokens from the SKILL.md content after the frontmatter (3+ chars only).
3. **Score** each skill for the idea: sum over idea tokens of IDF weight if the token is in the skill's keyword set; body-only tokens score at half weight (0.5 × (1 + IDF(t))). IDF(t) = 1 + log(N / (1 + df(t))) where N = number of skills and df(t) = number of skills containing t (body tokens included in df). Rare, distinctive tokens weigh more; common tokens weigh less. A skill with a thin description but a rich body still ranks — just below a description match for the same token.
4. **Bonus** small weight for idea tokens matching the skill *name*.
5. **Skill-set score** = sum of member scores. The best set is the strongest bundle for the idea.

## Tags

Each skill is auto-tagged by keyword rules over name + description: `security`, `performance`, `frontend`, `browser`, `testing`, `debugging`, `research`, `api`, `git`, `planning`, `docs`, `automation`, `data`, `thinking`, `codebase`. Tags drive `--wikis` Categories pages.

## Project-Override Precedence

Per the official spec: project-level skills (`.agents/skills/`, `.claude/skills/` in cwd) override user-level skills (`~/.agents/skills/`, `~/.claude/skills/`) with the same name. The registry stores the winning entry per name. Scan order is deterministic and later dirs win: `~/.claude/skills` > `~/.agents/skills` (user scope), then project `.claude/skills` > project `.agents/skills`.

## Adaptive Composition

`route` is the compatibility/debugging view. For execution, use `compose` so the runtime selects a small grounded payload instead of injecting every installed skill document:

```bash
parasite-skill compose "implement a secure API" --json
parasite-skill plan "implement a secure API"
```

The composer combines deterministic scores with explicit skill-name matches, request modes, tag overlap, project allowlists/blacklists, and asset relevance. It returns selected skills, a best skill-set, bounded excerpts, and manifests for references, templates, scripts, hooks, tools, examples, and docs. Full contents remain local and load on demand. It excludes absolute paths, environment values, credentials, unselected documents, and unselected asset contents.

The composer is a selector and payload builder, not an LLM. An AI host or MCP client uses the grounded payload to make the semantic decision and execute the selected procedures. Without an LLM host, deterministic routing remains the safe fallback.

## Manual Overrides

The scorer is intentionally naive. Known overrides applied by the AI layer:

| Situation | Action |
|---|---|
| Request mentions a library/framework | Route to `research`/`find-docs` regardless of score |
| Request is about *writing* | Route to `docs` set, apply `stop-slop` before prose |
| Request involves the browser | Route to `browser-testing-with-devtools` even if score is low |
| Request is a question about the codebase | Route to `intelligence` set (ix, understand) |
| User names a skill explicitly | Honor the explicit name first, always |

## The AI Layer (judgment upgrade)

1. Scores are ranked hypotheses, not verdicts.
2. Verify candidates exist in `registry.json`; project overrides applied.
3. Classify request type (analysis / implementation / research / writing / debugging / shipping) and weight skill-sets by type.
4. Present the final plan with rationale; execute with the always-on cadence.
